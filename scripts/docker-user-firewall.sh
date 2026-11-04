#!/usr/bin/env bash
# /usr/local/sbin/docker-user-firewall.sh
# Rebuilds the iptables DOCKER-USER chain, which Docker empties on every daemon
# restart. Run by docker-user-firewall.service (at boot and on every
# docker.service restart through PartOf=) and by docker-user-firewall.timer as
# a safety net.
#
# Rules, all in DOCKER-USER (traffic to/from containers only; the host's INPUT
# chain, hence the real sshd, is never touched):
#   - always: the honeypot subnet may not open any new outbound connection, so a
#     compromised Cowrie cannot be used to attack anyone else;
#   - CLOUDFLARE_ONLY=1: published 80/443 only reachable from Cloudflare ranges;
#   - BLOCK_PORTS: published container ports dropped when coming from the WAN
#     (e.g. a reverse proxy admin UI);
#   - fail2ban bans: a jump to each hp-<jail> chain kept by honeypot-ban.sh.
# Docker-published ports bypass ufw entirely, which is why this lives here.
#
# WAN-scoped rules use "-i $WAN_IFACE": they must filter inbound traffic from
# the Internet to a published port, not outbound container traffic to an
# external service on 80/443 (pip install, apt-get...).
#
# The egress rule matches the subnet, not the bridge name: recreating the
# network (`docker compose down && up`) changes the bridge name, and a rule
# bound to it would silently stop matching. The subnet is pinned in compose.
# HONEYPOT_SUBNET here MUST equal HONEYPOT_SUBNET in the repo's .env.
#
# No IPv6 egress rule: honeypot-net has IPv6 disabled, so no v6 address can
# exist on it. If IPv6 is ever enabled there, add a mirror rule.
#
# Atomic apply: the new DOCKER-USER is fed to `iptables-restore --noflush` as
# one transaction. With --noflush only the declared chain (DOCKER-USER) is
# flushed; INPUT, FORWARD, ufw and fail2ban chains are not even part of the
# payload, so rules other tools add meanwhile are never lost. A failure leaves
# the CURRENT rules in place (fail-closed) instead of an empty chain.
#
# Cloudflare ranges are static; refresh by hand from
#   https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
# Last refreshed: 2026-08-12.
#
# Usage: docker-user-firewall.sh [--dry-run | --print-rules | --print-restore]
#   --dry-run        validate the ruleset against the live tables (iptables-restore --test), apply nothing
#   --print-rules    print the DOCKER-USER rules from the config, no root, no iptables
#   --print-restore  print the exact iptables-restore payload (IPv4), no root
set -euo pipefail

HOST_ENV="${HONEYPOT_HOST_ENV:-/etc/honeypot-dashboard/host.env}"
if [[ -r "$HOST_ENV" ]]; then
  # Sourced as root by a systemd timer: a file others can write would be a root shell.
  read -r env_owner env_mode < <(stat -c '%u %a' "$HOST_ENV")
  if [[ "$env_owner" != 0 && "$env_owner" != "$(id -u)" ]] || (( 8#$env_mode & 8#022 )); then
    echo "$HOST_ENV must be owned by root and not group/world-writable" >&2
    exit 1
  fi
  # shellcheck source=/dev/null
  source "$HOST_ENV"
fi

HONEYPOT_SUBNET="${HONEYPOT_SUBNET:-172.21.0.0/16}"
CLOUDFLARE_ONLY="${CLOUDFLARE_ONLY:-0}"
BLOCK_PORTS="${BLOCK_PORTS:-}"
LOCKFILE="/run/docker-user-firewall.lock"

CF_V4="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13"
CF_V6="2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29"

MODE=apply

usage() {
  sed -n '/^# Usage:/,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'
}

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  logger -t docker-user-firewall "$*" 2>/dev/null || true
}

err() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
  logger -t docker-user-firewall "ERROR: $*" 2>/dev/null || true
}

default_wan_iface() {
  ip route show default 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit }}'
}

validate_config() {
  local p
  for p in $BLOCK_PORTS; do
    if ! [[ "$p" =~ ^[0-9]+$ ]] || (( p < 1 || p > 65535 )); then
      err "BLOCK_PORTS: '$p' is not a TCP port"
      exit 1
    fi
  done
  if ! [[ "$HONEYPOT_SUBNET" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]]; then
    err "HONEYPOT_SUBNET: '$HONEYPOT_SUBNET' is not an IPv4 CIDR"
    exit 1
  fi
  if [[ "$CLOUDFLARE_ONLY" != 0 && "$CLOUDFLARE_ONLY" != 1 ]]; then
    err "CLOUDFLARE_ONLY must be 0 or 1"
    exit 1
  fi
  if [[ -z "$WAN_IFACE" ]]; then
    err "WAN_IFACE is empty and no default route was found: set it in $HOST_ENV"
    exit 1
  fi
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    err "must run as root"
    exit 1
  fi
}

require_cmds() {
  local missing=() c
  for c in iptables-restore ip6tables-restore ip flock; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    err "missing commands: ${missing[*]}"
    exit 1
  fi
}

require_wan_iface() {
  if ! ip link show "$WAN_IFACE" >/dev/null 2>&1; then
    # Applying anyway would make the WAN rules match nothing: everything would pass.
    err "WAN interface '$WAN_IFACE' not found (renamed interface, rescue mode...). Fix WAN_IFACE in $HOST_ENV."
    exit 1
  fi
}

acquire_lock() {
  exec 200>"$LOCKFILE"
  if ! flock -n 200; then
    err "another run holds $LOCKFILE, giving up"
    exit 1
  fi
}

wan_rules() {
  local cf_ranges="$1" r p
  if [[ "$CLOUDFLARE_ONLY" == 1 ]]; then
    for r in $cf_ranges; do
      echo "-A DOCKER-USER -i ${WAN_IFACE} -s ${r} -p tcp -m multiport --dports 80,443 -j RETURN"
    done
    echo "-A DOCKER-USER -i ${WAN_IFACE} -p tcp -m multiport --dports 80,443 -j DROP"
  fi
  for p in $BLOCK_PORTS; do
    echo "-A DOCKER-USER -i ${WAN_IFACE} -p tcp -m tcp --dport ${p} -j DROP"
  done
}

# Jumps to the fail2ban ban chains (hp-<jail>, see honeypot-ban.sh): this script
# empties DOCKER-USER, so without them every ban would stop covering containers.
ban_rules() {
  local helper
  helper="$(dirname "$0")/honeypot-ban.sh"
  [[ -x "$helper" ]] || return 0
  "$helper" docker-user-rules "$1" "$WAN_IFACE"
}

build_rules_v4() {
  echo "-A DOCKER-USER -i lo -j RETURN"
  ban_rules v4
  echo "-A DOCKER-USER -s ${HONEYPOT_SUBNET} -m conntrack --ctstate NEW -m comment --comment \"honeypot: no egress\" -j DROP"
  wan_rules "$CF_V4"
  echo "-A DOCKER-USER -j RETURN"
}

build_rules_v6() {
  echo "-A DOCKER-USER -i lo -j RETURN"
  ban_rules v6
  wan_rules "$CF_V6"
  echo "-A DOCKER-USER -j RETURN"
}

restore_payload() {
  local family="$1"
  echo "*filter"
  echo ":DOCKER-USER - [0:0]"
  if [[ "$family" == v4 ]]; then build_rules_v4; else build_rules_v6; fi
  echo "COMMIT"
}

apply_table() {
  local family="$1" restore_bin
  if [[ "$family" == v4 ]]; then restore_bin="iptables-restore"; else restore_bin="ip6tables-restore"; fi

  if [[ "$MODE" == dry-run ]]; then
    if restore_payload "$family" | "$restore_bin" --noflush --test; then
      log "[$family] dry-run OK. DOCKER-USER rules that would be applied:"
      restore_payload "$family" | grep '^-A' | while IFS= read -r line; do log "  $line"; done
    else
      err "[$family] dry-run: ruleset validation failed"
      return 1
    fi
  else
    restore_payload "$family" | "$restore_bin" --noflush
    log "[$family] DOCKER-USER rebuilt (atomic, --noflush: other chains untouched)"
  fi
}

main() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --dry-run) MODE=dry-run ;;
      --print-rules) MODE=print ;;
      --print-restore) MODE=print-restore ;;
      -h|--help) usage; exit 0 ;;
      *) err "unknown argument: $arg"; usage >&2; exit 1 ;;
    esac
  done

  WAN_IFACE="${WAN_IFACE:-$(default_wan_iface)}"
  validate_config

  if [[ "$MODE" == print-restore ]]; then
    restore_payload v4
    exit 0
  fi
  if [[ "$MODE" == print ]]; then
    echo "# IPv4"
    build_rules_v4
    echo "# IPv6"
    build_rules_v6
    exit 0
  fi

  require_root
  require_cmds
  require_wan_iface
  acquire_lock

  log "Mode $MODE, WAN $WAN_IFACE, honeypot subnet $HONEYPOT_SUBNET, cloudflare-only $CLOUDFLARE_ONLY, blocked ports: ${BLOCK_PORTS:-none}"
  apply_table v4
  apply_table v6
}

main "$@"
