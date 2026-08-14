#!/bin/bash
# Reconstruit la chain DOCKER-USER (vidée par Docker a chaque redemarrage du
# daemon) : restriction Cloudflare-only sur 80/443, blocage du port 81 (admin
# NPM), et blocage de toute sortie du honeypot. Lance par le service systemd
# docker-user-firewall.service (au boot + a chaque restart de docker.service
# via PartOf=), et periodiquement par docker-user-firewall.timer en filet de
# securite.
#
# Les regles Cloudflare-only et le blocage du port 81 sont scopees a
# "-i $WAN_IFACE" (interface WAN reelle du VPS) : elles ne doivent filtrer
# que le trafic ENTRANT depuis Internet vers un port publie par un
# container, pas le trafic SORTANT d'un container vers Internet (ex: pip
# install, apt-get). Sans ce -i, le DROP matchait par port de destination
# seul et bloquait aussi bien l'entrant non-Cloudflare que tout trafic
# client sortant d'un container vers un service externe en 80/443/81.
#
# Le blocage d'egress du honeypot matche par SOUS-RESEAU FIXE
# ($HONEYPOT_SUBNET_V4), pas par nom d'interface bridge. Le nom du bridge
# Docker (br-<network-id>) change a chaque fois que le reseau
# honeypot_honeypot-net est recree (ex: `docker compose down && up` sur la
# stack honeypot, sans toucher au daemon Docker) - une regle basee sur le
# nom d'interface se retrouve alors a pointer vers un bridge qui n'existe
# plus, et le blocage d'egress disparait silencieusement. Le sous-reseau,
# lui, ne change pas tant qu'il reste fige explicitement cote compose.
# IMPORTANT: $HONEYPOT_SUBNET_V4 DOIT rester synchronise avec
# networks.honeypot-net.ipam.config.subnet dans
# /home/user/honeypot/docker-compose.yml. Si l'un change, changer l'autre.
#
# Pas de regle IPv6 equivalente pour l'egress honeypot : EnableIPv6 est
# `false` sur honeypot-net (confirme en prod), donc aucune adresse v6 n'est
# possible sur ce reseau. Si IPv6 y est active un jour, ajouter une regle
# miroir ici avec le sous-reseau v6 alors choisi.
#
# Application atomique : le ruleset est construit dans un dump complet de
# la table filter (iptables-save), puis applique via iptables-restore, qui
# remplace la table en une seule operation noyau. Contrairement a un
# flush+ajout ligne par ligne, un crash du script avant ce point laisse les
# regles ACTUELLEMENT ACTIVES en place (fail-closed) plutot que de laisser
# la chain vide ou partielle (fail-open).
#
# Rafraichir la liste d'IPs Cloudflare (statique, a mettre a jour a la main
# de temps en temps) :
#   curl -s https://www.cloudflare.com/ips-v4
#   curl -s https://www.cloudflare.com/ips-v6
# Derniere mise a jour de la liste ci-dessous : 2026-08-12.
set -euo pipefail

WAN_IFACE="eth0"
HONEYPOT_SUBNET_V4="172.21.0.0/16"
LOCKFILE="/run/docker-user-firewall.lock"

CF_V4="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13"
CF_V6="2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29"

DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: docker-user-firewall.sh [--dry-run]

  --dry-run   Construit le ruleset et le valide (iptables-restore --test)
              sans l'appliquer. Affiche les regles qui seraient posees.
EOF
}

log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $*"
  logger -t docker-user-firewall "$*" 2>/dev/null || true
}

err() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] ERREUR: $*" >&2
  logger -t docker-user-firewall "ERREUR: $*" 2>/dev/null || true
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    err "doit etre execute en root (sudo)."
    exit 1
  fi
}

require_cmds() {
  local missing=() c
  for c in iptables iptables-save iptables-restore ip6tables ip6tables-save ip6tables-restore ip flock; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    err "commandes manquantes: ${missing[*]}"
    exit 1
  fi
}

require_wan_iface() {
  if ! ip link show "$WAN_IFACE" >/dev/null 2>&1; then
    err "interface WAN '$WAN_IFACE' introuvable sur cet hote (renommage d'interface, rescue mode OVH, etc.). Verifier la constante WAN_IFACE en tete de script avant de continuer - sinon les regles Cloudflare-only et le blocage du port 81 ne matcheraient plus rien, et tout passerait en clair sur 80/443/81."
    exit 1
  fi
}

acquire_lock() {
  exec 200>"$LOCKFILE"
  if ! flock -n 200; then
    err "une autre execution est deja en cours (lock $LOCKFILE), abandon."
    exit 1
  fi
}

# Assure que la chain DOCKER-USER existe dans le dump avant d'y inserer des
# regles (cas normalement couvert par Docker au demarrage du daemon, mais
# garde-fou explicite plutot que de supposer).
ensure_chain_decl() {
  local dump="$1"
  if printf '%s\n' "$dump" | grep -q '^:DOCKER-USER '; then
    printf '%s\n' "$dump"
  else
    printf '%s\n' "$dump" | awk '
      !inserted && /^-A / { print ":DOCKER-USER - [0:0]"; inserted=1 }
      { print }
    '
  fi
}

build_rules_v4() {
  local out=""
  out+="-A DOCKER-USER -i lo -j RETURN"$'\n'
  out+="-A DOCKER-USER -s ${HONEYPOT_SUBNET_V4} -m conntrack --ctstate NEW -m comment --comment \"honeypot: no egress\" -j DROP"$'\n'
  local r
  for r in $CF_V4; do
    out+="-A DOCKER-USER -i ${WAN_IFACE} -s ${r} -p tcp -m multiport --dports 80,443 -j RETURN"$'\n'
  done
  out+="-A DOCKER-USER -i ${WAN_IFACE} -p tcp -m multiport --dports 80,443 -j DROP"$'\n'
  out+="-A DOCKER-USER -i ${WAN_IFACE} -p tcp -m tcp --dport 81 -j DROP"$'\n'
  out+="-A DOCKER-USER -j RETURN"
  printf '%s' "$out"
}

build_rules_v6() {
  local out=""
  out+="-A DOCKER-USER -i lo -j RETURN"$'\n'
  local r
  for r in $CF_V6; do
    out+="-A DOCKER-USER -i ${WAN_IFACE} -s ${r} -p tcp -m multiport --dports 80,443 -j RETURN"$'\n'
  done
  out+="-A DOCKER-USER -i ${WAN_IFACE} -p tcp -m multiport --dports 80,443 -j DROP"$'\n'
  out+="-A DOCKER-USER -i ${WAN_IFACE} -p tcp -m tcp --dport 81 -j DROP"$'\n'
  out+="-A DOCKER-USER -j RETURN"
  printf '%s' "$out"
}

# Construit le nouveau dump de la table filter (chain DOCKER-USER remplacee,
# tout le reste - INPUT/FORWARD/OUTPUT, chains Docker, chains ufw - inchange)
# et l'applique (ou le valide en --dry-run) de facon atomique.
apply_table() {
  local family="$1" save_bin restore_bin new_rules base without_old new_dump

  if [ "$family" = v4 ]; then
    save_bin="iptables-save"
    restore_bin="iptables-restore"
    new_rules="$(build_rules_v4)"
  else
    save_bin="ip6tables-save"
    restore_bin="ip6tables-restore"
    new_rules="$(build_rules_v6)"
  fi

  base="$("$save_bin" -t filter)"
  without_old="$(printf '%s\n' "$base" | grep -v '^-A DOCKER-USER ' || true)"
  without_old="$(ensure_chain_decl "$without_old")"
  new_dump="$(printf '%s\n' "$without_old" | awk -v rules="$new_rules" '
    !done && /^COMMIT$/ { print rules; done=1 }
    { print }
  ')"

  if [ "$DRY_RUN" -eq 1 ]; then
    if printf '%s\n' "$new_dump" | "$restore_bin" --test; then
      log "[$family] dry-run OK. Regles DOCKER-USER qui seraient appliquees :"
      printf '%s\n' "$new_rules" | while IFS= read -r line; do log "  $line"; done
    else
      err "[$family] dry-run: validation du ruleset echouee"
      return 1
    fi
  else
    printf '%s\n' "$new_dump" | "$restore_bin"
    log "[$family] DOCKER-USER reconstruite avec succes (application atomique via $restore_bin)"
  fi
}

main() {
  for arg in "$@"; do
    case "$arg" in
      --dry-run) DRY_RUN=1 ;;
      -h|--help) usage; exit 0 ;;
      *) err "argument inconnu: $arg"; usage >&2; exit 1 ;;
    esac
  done

  require_root
  require_cmds
  require_wan_iface
  acquire_lock

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Dry-run (aucune modification appliquee). Sous-reseau honeypot: ${HONEYPOT_SUBNET_V4}"
  else
    log "Application du ruleset DOCKER-USER (v4+v6). Sous-reseau honeypot: ${HONEYPOT_SUBNET_V4}"
  fi

  apply_table v4
  apply_table v6

  if [ "$DRY_RUN" -eq 0 ]; then
    log "DOCKER-USER (v4+v6) reconstruite avec succes"
  fi
}

main "$@"
