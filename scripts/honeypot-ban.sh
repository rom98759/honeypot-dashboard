#!/usr/bin/env bash
# /usr/local/sbin/honeypot-ban.sh
# Firewall side of the honeypot fail2ban jails, called by the honeypot-block
# action (scripts/fail2ban/action.d/honeypot-block.conf) and by
# docker-user-firewall.sh.
#
# Each jail owns one chain, hp-<jail>, in iptables and ip6tables, holding one
# "-s <ip> -j DROP" per banned address. The chain is reached from:
#   - INPUT: the host itself (real sshd, and every Docker port published
#     through docker-proxy, which is how IPv6 reaches containers here);
#   - DOCKER-USER: IPv4 traffic forwarded to containers (NPM 80/443, Cowrie).
# Two scopes:
#   - services: everything EXCEPT the honeypot. The chain starts with a RETURN
#     for tcp/COWRIE_PORT (host side) and DOCKER-USER only jumps for traffic
#     NOT going to HONEYPOT_SUBNET, so a banned bot keeps reaching Cowrie and
#     we keep observing it, while the real sshd and the sites are closed to it.
#   - all: everything, Cowrie included.
#
# docker-user-firewall.sh rebuilds DOCKER-USER from scratch, so it asks this
# script for the jump lines (docker-user-rules) instead of losing them.
#
# Usage: honeypot-ban.sh [--dry-run] start JAIL SCOPE | stop JAIL | ban JAIL IP | unban JAIL IP
#        honeypot-ban.sh docker-user-rules v4|v6 WAN_IFACE
#   --dry-run  print the iptables commands instead of running them
set -euo pipefail

HOST_ENV="${HONEYPOT_HOST_ENV:-/etc/honeypot-dashboard/host.env}"
STATE_DIR="${HONEYPOT_BAN_STATE_DIR:-/run/honeypot-ban}"
DRY_RUN=0

if [[ -r "$HOST_ENV" ]]; then
  # Sourced as root by fail2ban: a file others can write would be a root shell.
  read -r env_owner env_mode < <(stat -c '%u %a' "$HOST_ENV")
  if [[ "$env_owner" != 0 && "$env_owner" != "$(id -u)" ]] || (( 8#$env_mode & 8#022 )); then
    echo "$HOST_ENV must be owned by root and not group/world-writable" >&2
    exit 1
  fi
  # shellcheck source=/dev/null
  source "$HOST_ENV"
fi
HONEYPOT_SUBNET="${HONEYPOT_SUBNET:-172.21.0.0/16}"
COWRIE_PORT="${COWRIE_PORT:-22}"

usage() {
  sed -n '/^# Usage:/,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'
}

log() { logger -t honeypot-ban "$*" 2>/dev/null || true; }
die() { echo "honeypot-ban: $*" >&2; log "ERROR: $*"; exit 1; }

ipt() {
  local family="$1"; shift
  local bin=iptables
  [[ "$family" == v6 ]] && bin=ip6tables
  if [[ "$DRY_RUN" == 1 ]]; then
    echo "$bin -w $*"
    return 0
  fi
  "$bin" -w "$@"
}

# Read-only probe: never printed in dry-run, so the output stays the list of changes.
has() {
  local family="$1"; shift
  [[ "$DRY_RUN" == 1 ]] && return 1
  local bin=iptables
  [[ "$family" == v6 ]] && bin=ip6tables
  "$bin" -w "$@" >/dev/null 2>&1
}

check_jail() {
  [[ "$1" =~ ^[a-z0-9-]{1,24}$ ]] || die "invalid jail name: $1"
}

family_of() {
  if [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$ ]]; then
    echo v4
  elif [[ "$1" =~ ^[0-9a-fA-F:]+(/[0-9]{1,3})?$ && "$1" == *:* ]]; then
    echo v6
  else
    die "invalid IP: $1"
  fi
}

# The DOCKER-USER match for a scope; HONEYPOT_SUBNET is IPv4 only (honeypot-net has no IPv6).
docker_match() {
  local family="$1" scope="$2"
  if [[ "$scope" == services && "$family" == v4 ]]; then
    echo "! -d $HONEYPOT_SUBNET"
  fi
}

start() {
  local jail="$1" scope="$2" chain="hp-$1" family match
  [[ "$scope" == services || "$scope" == all ]] || die "invalid scope: $scope"
  for family in v4 v6; do
    has "$family" -n -L "$chain" || ipt "$family" -N "$chain"
    ipt "$family" -F "$chain"
    if [[ "$scope" == services ]]; then
      ipt "$family" -A "$chain" -p tcp --dport "$COWRIE_PORT" -j RETURN
    fi
    has "$family" -C INPUT -j "$chain" || ipt "$family" -I INPUT 1 -j "$chain"
    # DOCKER-USER exists only once Docker runs; docker-user-firewall.sh adds the jump later.
    if has "$family" -n -L DOCKER-USER; then
      match="$(docker_match "$family" "$scope")"
      # shellcheck disable=SC2086
      has "$family" -C DOCKER-USER $match -j "$chain" || ipt "$family" -I DOCKER-USER 1 $match -j "$chain"
    fi
  done
  if [[ "$DRY_RUN" == 0 ]]; then
    install -d -m 0755 "$STATE_DIR"
    echo "$scope" >"$STATE_DIR/$jail"
  fi
  log "started $chain ($scope)"
}

stop() {
  local jail="$1" chain="hp-$1" family scope match
  scope="$(cat "$STATE_DIR/$jail" 2>/dev/null || echo services)"
  for family in v4 v6; do
    while has "$family" -C INPUT -j "$chain"; do ipt "$family" -D INPUT -j "$chain"; done
    match="$(docker_match "$family" "$scope")"
    # shellcheck disable=SC2086
    while has "$family" -C DOCKER-USER $match -j "$chain"; do ipt "$family" -D DOCKER-USER $match -j "$chain"; done
    if has "$family" -n -L "$chain"; then
      ipt "$family" -F "$chain"
      ipt "$family" -X "$chain"
    fi
  done
  [[ "$DRY_RUN" == 0 ]] && rm -f "$STATE_DIR/$jail"
  log "stopped $chain"
}

ban() {
  local jail="$1" ip="$2" family
  family="$(family_of "$ip")"
  has "$family" -C "hp-$jail" -s "$ip" -j DROP || ipt "$family" -A "hp-$jail" -s "$ip" -j DROP
  log "ban $ip in hp-$jail"
}

unban() {
  local jail="$1" ip="$2" family
  family="$(family_of "$ip")"
  while has "$family" -C "hp-$jail" -s "$ip" -j DROP; do ipt "$family" -D "hp-$jail" -s "$ip" -j DROP; done
  if [[ "$DRY_RUN" == 1 ]]; then ipt "$family" -D "hp-$jail" -s "$ip" -j DROP; fi
  log "unban $ip from hp-$jail"
}

# iptables-restore lines for docker-user-firewall.sh, one jump per running jail.
docker_user_rules() {
  local family="$1" wan="$2" state jail scope match
  [[ "$family" == v4 || "$family" == v6 ]] || die "family must be v4 or v6"
  [[ -d "$STATE_DIR" ]] || return 0
  for state in "$STATE_DIR"/*; do
    [[ -f "$state" ]] || continue
    jail="$(basename "$state")"
    [[ "$jail" =~ ^[a-z0-9-]{1,24}$ ]] || continue
    scope="$(cat "$state")"
    [[ "$scope" == services || "$scope" == all ]] || continue
    # A jump to a missing chain would make the whole restore fail (fail-closed, but pointless).
    if [[ "$DRY_RUN" == 0 ]] && ! has "$family" -n -L "hp-$jail"; then continue; fi
    match="$(docker_match "$family" "$scope")"
    echo "-A DOCKER-USER -i $wan ${match:+$match }-j hp-$jail"
  done
}

[[ "${1:-}" == --dry-run ]] && { DRY_RUN=1; shift; }
cmd="${1:-}"
case "$cmd" in
  start) [[ $# == 3 ]] || { usage >&2; exit 1; }; check_jail "$2"; start "$2" "$3" ;;
  stop) [[ $# == 2 ]] || { usage >&2; exit 1; }; check_jail "$2"; stop "$2" ;;
  ban) [[ $# == 3 ]] || { usage >&2; exit 1; }; check_jail "$2"; ban "$2" "$3" ;;
  unban) [[ $# == 3 ]] || { usage >&2; exit 1; }; check_jail "$2"; unban "$2" "$3" ;;
  docker-user-rules) [[ $# == 3 ]] || { usage >&2; exit 1; }; docker_user_rules "$2" "$3" ;;
  -h|--help) usage ;;
  *) usage >&2; exit 1 ;;
esac
