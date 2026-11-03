#!/usr/bin/env bash
# Installs the host side of honeypot-dashboard: log exporters, DOCKER-USER firewall,
# GeoIP refresh, logrotate, fail2ban sshd jail and (optionally) the ban worker.
# Idempotent: run it again after `git pull` to update the installed copies.
#
# It NEVER edits sshd, ufw or the INPUT chain. Cowrie takes port 22, so the real
# sshd must already have been moved by you (docs/install.md, step 0); the
# preflight refuses to continue otherwise.
#
# Usage: sudo scripts/install-host.sh [--dry-run] [--uninstall] [--root DIR]
#   --dry-run    run the checks and print every action, change nothing
#   --uninstall  disable and remove what this script installed (keeps data, logs, never-ban, host.env)
#   --root DIR   install under DIR instead of / (tests); systemctl is skipped unless SYSTEMCTL is set
set -euo pipefail

REPO_SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT=""
MODE=install
DRY_RUN=0

usage() {
  sed -n '/^# Usage:/,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'
}

log() { echo "[install-host] $*"; }
warn() { echo "[install-host] WARNING: $*"; }
fail() { echo "[install-host] ERROR: $*" >&2; exit 1; }

run() {
  if [[ "$DRY_RUN" == 1 ]]; then
    log "would: $*"
  else
    log "$*"
    "$@"
  fi
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --uninstall) MODE=uninstall ;;
    --root) ROOT="__next__" ;;
    -h|--help) usage; exit 0 ;;
    *)
      if [[ "$ROOT" == "__next__" ]]; then
        ROOT="${arg%/}"
      else
        usage >&2
        fail "unknown argument: $arg"
      fi
      ;;
  esac
done
[[ "$ROOT" == "__next__" ]] && fail "--root needs a directory"

HOST_ENV="${HONEYPOT_HOST_ENV:-$ROOT/etc/honeypot-dashboard/host.env}"
[[ -r "$HOST_ENV" ]] || fail "$HOST_ENV not found: copy scripts/host.env.example there (chmod 600) and fill it"
# Sourced as root here and by the installed timers: a file others can write is a root shell.
read -r env_owner env_mode < <(stat -c '%u %a' "$HOST_ENV")
if [[ "$env_owner" != 0 && "$env_owner" != "$(id -u)" ]] || (( 8#$env_mode & 8#022 )); then
  fail "$HOST_ENV must be owned by root and not group/world-writable (chown root: and chmod 600)"
fi
# shellcheck source=/dev/null
source "$HOST_ENV"
SSHD_PORT="${SSHD_PORT:-}"
REPO_DIR="${REPO_DIR:-$(dirname "$REPO_SCRIPTS")}"
FBAN_ENABLED="${FBAN_ENABLED:-0}"

if [[ -n "$ROOT" ]]; then
  SYSTEMCTL="${SYSTEMCTL:-}"
else
  SYSTEMCTL="${SYSTEMCTL:-systemctl}"
  if [[ "$DRY_RUN" == 0 && "$(id -u)" -ne 0 ]]; then
    fail "must run as root (or use --dry-run)"
  fi
fi

SBIN="$ROOT/usr/local/sbin"
UNITS="$ROOT/etc/systemd/system"
JAIL_FILE="$ROOT/etc/fail2ban/jail.d/honeypot-sshd.conf"
NEVER_BAN="$ROOT/etc/honeypot/never-ban"
EXPORT_DIR="$ROOT/var/log/honeypot-export"
QUEUE_DIR="$ROOT/opt/honeypot/fban-queue"
# Must match the dashboard image user (Dockerfile: useradd --uid 1000).
DASHBOARD_UID=1000

CORE_SCRIPTS=(fail2ban-export.sh sshd-auth-export.sh docker-user-firewall.sh geoip-update.sh)
CORE_UNITS=(
  fail2ban-export.service fail2ban-export.timer
  sshd-auth-export.service sshd-auth-export.timer
  docker-user-firewall.service docker-user-firewall.timer
  geoip-update.service geoip-update.timer
)
CORE_ENABLE=(fail2ban-export.timer sshd-auth-export.timer docker-user-firewall.service docker-user-firewall.timer geoip-update.timer)
FBAN_SCRIPTS=(fban-queue-worker.sh)
FBAN_UNITS=(fban-queue-worker.service fban-queue-worker.path)
FBAN_ENABLE=(fban-queue-worker.path)

systemctl_do() {
  if [[ -z "$SYSTEMCTL" ]]; then
    log "skip (no systemctl under --root): systemctl $*"
    return 0
  fi
  run "$SYSTEMCTL" "$@"
}

lockout_help() {
  local port="${SSHD_PORT:-50022}"
  [[ "$port" == 22 ]] && port=50022
  cat <<EOF

==================================================================
  SSH LOCKOUT RISK: nothing was changed.
==================================================================
Cowrie publishes port 22. Your real sshd must listen ONLY on another
port (SSHD_PORT in $HOST_ENV, e.g. $port) before installing.
Do it yourself, in this order:

  1) Keep your current SSH session open until step 5 succeeds.
  2) Allow the new port everywhere first:
       ufw allow $port/tcp        (ufw limit $port/tcp also works)
     and in your hosting provider's firewall/security group, if any.
  3) Set the port and check the config:
       echo "Port $port" > /etc/ssh/sshd_config.d/10-port.conf
       sshd -t
     (remove any other "Port 22" line from /etc/ssh/sshd_config)
  4) Apply it:
       systemctl restart ssh
     If ssh.socket is active (systemctl is-active ssh.socket), it decides
     the port instead: systemctl daemon-reload && systemctl restart ssh.socket
  5) From a NEW terminal, without closing the old one:
       ssh -p $port <user>@<server>
     Only when this works, update ~/.ssh/config (Port $port).
  6) Run this installer again.

Locked out anyway? Use your provider's web console / rescue mode,
revert /etc/ssh/sshd_config.d/10-port.conf and restart ssh.
EOF
}

preflight_abort() {
  echo "[install-host] $1"
  lockout_help
  exit 2
}

# Configured ports (sshd -T) plus ports an sshd process actually listens on (ss):
# a Port change written but not yet applied shows up as a mismatch, not a pass.
detect_sshd_ports() {
  {
    sshd -T 2>/dev/null | awk '/^port /{print $2}'
    ss -ltnpH 2>/dev/null | awk '/"sshd"/{n = split($4, a, ":"); print a[n]}'
  } | sort -un
}

preflight() {
  if [[ ! -f "$REPO_DIR/docker-compose.yml" ]]; then
    fail "REPO_DIR=$REPO_DIR does not contain docker-compose.yml: set it to your clone in $HOST_ENV"
  fi
  if ! [[ "$SSHD_PORT" =~ ^[0-9]+$ ]] || (( SSHD_PORT < 1 || SSHD_PORT > 65535 )); then
    preflight_abort "SSHD_PORT is missing or invalid in $HOST_ENV."
  fi
  if [[ "$SSHD_PORT" == 22 ]]; then
    preflight_abort "SSHD_PORT is 22, the port Cowrie needs."
  fi

  local ports
  # Probe overrides exist for tests only: outside --root they could silence the lockout check.
  if [[ -n "$ROOT" && -n "${SSHD_PORTS_CMD:-}" ]]; then
    ports="$(bash -c "$SSHD_PORTS_CMD" | tr '\n' ' ')"
  else
    ports="$(detect_sshd_ports | tr '\n' ' ')"
  fi
  log "sshd listens on: ${ports:-<nothing detected>}"
  if [[ -z "${ports// /}" ]]; then
    preflight_abort "Could not detect the sshd port (sshd -T / ss)."
  fi
  if [[ " $ports " == *" 22 "* ]]; then
    preflight_abort "sshd still listens on port 22."
  fi
  if [[ " $ports " != *" $SSHD_PORT "* ]]; then
    preflight_abort "sshd listens on ${ports% } but SSHD_PORT is $SSHD_PORT: make them match."
  fi

  local ufw_status
  local ufw_cmd="ufw status 2>/dev/null || echo 'Status: inactive'"
  [[ -n "$ROOT" && -n "${UFW_STATUS_CMD:-}" ]] && ufw_cmd="$UFW_STATUS_CMD"
  ufw_status="$(bash -c "$ufw_cmd")"
  if grep -q '^Status: active' <<<"$ufw_status"; then
    if ! grep -Eq "^${SSHD_PORT}(/tcp)?[[:space:]]+(ALLOW|LIMIT)" <<<"$ufw_status"; then
      echo "[install-host] ufw is active but has no rule for port $SSHD_PORT."
      echo "[install-host] Run: ufw allow ${SSHD_PORT}/tcp   then rerun this installer."
      exit 2
    fi
    log "ufw allows $SSHD_PORT/tcp"
  else
    warn "ufw is not active. Make sure your provider firewall allows $SSHD_PORT/tcp and 22/tcp."
  fi
}

install_file() {
  local mode="$1" src="$2" dest="$3"
  if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
    return 0
  fi
  run install -D -m "$mode" "$src" "$dest"
}

remove_file() {
  [[ -e "$1" ]] && run rm -f "$1"
  return 0
}

existing_sshd_jail() {
  local f
  for f in "$ROOT/etc/fail2ban/jail.local" "$ROOT"/etc/fail2ban/jail.d/*; do
    [[ -f "$f" ]] || continue
    # Debian ships jail.d/defaults-debian.conf with a bare [sshd] enable: not a real config.
    [[ "$f" == "$JAIL_FILE" || "$(basename "$f")" == defaults-debian.conf ]] && continue
    if grep -q '^\[sshd\]' "$f"; then
      echo "$f"
      return 0
    fi
  done
  return 1
}

install_jail() {
  local existing
  if existing="$(existing_sshd_jail)"; then
    log "kept existing sshd jail in $existing (check that its port is $SSHD_PORT)"
    return 1
  fi
  local tmp
  tmp="$(mktemp)"
  sed "s/@SSHD_PORT@/$SSHD_PORT/" "$REPO_SCRIPTS/fail2ban/honeypot-sshd.conf.tmpl" >"$tmp"
  if [[ -f "$JAIL_FILE" ]] && cmp -s "$tmp" "$JAIL_FILE"; then
    rm -f "$tmp"
    return 1
  fi
  install_file 0644 "$tmp" "$JAIL_FILE"
  rm -f "$tmp"
  return 0
}

do_install() {
  preflight

  # geoip-update.sh runs from /usr/local/sbin and cannot guess where the clone is.
  if ! grep -q '^REPO_DIR=' "$HOST_ENV"; then
    if [[ "$DRY_RUN" == 1 ]]; then
      log "would: append REPO_DIR=$REPO_DIR to $HOST_ENV"
    else
      log "append REPO_DIR=$REPO_DIR to $HOST_ENV"
      printf 'REPO_DIR=%s\n' "$REPO_DIR" >>"$HOST_ENV"
    fi
  fi

  local f
  for f in "${CORE_SCRIPTS[@]}"; do install_file 0755 "$REPO_SCRIPTS/$f" "$SBIN/$f"; done
  for f in "${CORE_UNITS[@]}"; do install_file 0644 "$REPO_SCRIPTS/$f" "$UNITS/$f"; done
  install_file 0644 "$REPO_SCRIPTS/honeypot-export.logrotate" "$ROOT/etc/logrotate.d/honeypot-export"

  if [[ ! -d "$EXPORT_DIR" ]]; then
    run install -d -m 0750 "$EXPORT_DIR"
    [[ -z "$ROOT" ]] && run chown root:adm "$EXPORT_DIR"
  fi
  # Created here, before the first `docker compose up`: a bind-mount source that Docker
  # creates itself is root-owned, and the non-root dashboard (uid 1000) could never write to it.
  if [[ ! -d "$QUEUE_DIR" ]]; then
    run install -d -m 0770 "$QUEUE_DIR"
  fi
  if [[ -z "$ROOT" && "$(stat -c %u:%a "$QUEUE_DIR" 2>/dev/null)" != "$DASHBOARD_UID:770" ]]; then
    run chown "$DASHBOARD_UID:$DASHBOARD_UID" "$QUEUE_DIR"
    run chmod 0770 "$QUEUE_DIR"
  fi
  if [[ ! -e "$NEVER_BAN" ]]; then
    local tmp
    tmp="$(mktemp)"
    printf '# One IP or CIDR per line: the ban worker refuses to ban these (your own addresses).\n' >"$tmp"
    install_file 0644 "$tmp" "$NEVER_BAN"
    rm -f "$tmp"
  fi

  local jail_changed=0
  if install_jail; then jail_changed=1; fi

  if [[ "$FBAN_ENABLED" == 1 ]]; then
    for f in "${FBAN_SCRIPTS[@]}"; do install_file 0755 "$REPO_SCRIPTS/$f" "$SBIN/$f"; done
    for f in "${FBAN_UNITS[@]}"; do install_file 0644 "$REPO_SCRIPTS/$f" "$UNITS/$f"; done
  else
    for f in "${FBAN_ENABLE[@]}"; do
      [[ -e "$UNITS/$f" ]] && systemctl_do disable --now "$f"
    done
    for f in "${FBAN_UNITS[@]}"; do remove_file "$UNITS/$f"; done
    for f in "${FBAN_SCRIPTS[@]}"; do remove_file "$SBIN/$f"; done
  fi

  systemctl_do daemon-reload
  systemctl_do enable --now "${CORE_ENABLE[@]}"
  [[ "$FBAN_ENABLED" == 1 ]] && systemctl_do enable --now "${FBAN_ENABLE[@]}"
  [[ "$jail_changed" == 1 ]] && systemctl_do reload-or-restart fail2ban

  if [[ -n "${MAXMIND_ACCOUNT_ID:-}" && -n "${MAXMIND_LICENSE_KEY:-}" ]]; then
    if [[ ! -f "$REPO_DIR/geoip/GeoLite2-City.mmdb" ]]; then
      systemctl_do start geoip-update.service \
        || warn "first GeoIP download failed: journalctl -u geoip-update.service (retried monthly)"
    fi
  else
    warn "MAXMIND_ACCOUNT_ID / MAXMIND_LICENSE_KEY empty: no GeoIP (map and countries stay empty)."
  fi

  log "done. Next: docker compose up -d (see docs/install.md)."
}

do_uninstall() {
  local f
  local all_enable=("${CORE_ENABLE[@]}" "${FBAN_ENABLE[@]}")
  for f in "${all_enable[@]}"; do
    [[ -e "$UNITS/$f" ]] && systemctl_do disable --now "$f"
  done
  for f in "${CORE_UNITS[@]}" "${FBAN_UNITS[@]}"; do remove_file "$UNITS/$f"; done
  for f in "${CORE_SCRIPTS[@]}" "${FBAN_SCRIPTS[@]}"; do remove_file "$SBIN/$f"; done
  remove_file "$ROOT/etc/logrotate.d/honeypot-export"
  if [[ -e "$JAIL_FILE" ]]; then
    remove_file "$JAIL_FILE"
    systemctl_do reload-or-restart fail2ban
  fi
  systemctl_do daemon-reload
  log "removed. Kept: $EXPORT_DIR, $NEVER_BAN, $HOST_ENV, Docker volumes."
  log "DOCKER-USER rules stay until the next Docker restart (systemctl restart docker clears them)."
}

if [[ "$MODE" == uninstall ]]; then
  do_uninstall
else
  do_install
fi
