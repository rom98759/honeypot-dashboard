#!/usr/bin/env bash
# Installs the host side of honeypot-dashboard: log exporters, DOCKER-USER firewall,
# GeoIP refresh, logrotate, fail2ban jails (real sshd, Cowrie, recidive, manual bans),
# read access to Cowrie's captured files, and (optionally) the ban worker.
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
JAIL_FILE="$ROOT/etc/fail2ban/jail.d/honeypot.local"
# Written by older versions, which only knew the real sshd jail.
LEGACY_JAIL_FILE="$ROOT/etc/fail2ban/jail.d/honeypot-sshd.conf"
F2B_ACTION="$ROOT/etc/fail2ban/action.d/honeypot-block.conf"
F2B_FILTERS=(honeypot-cowrie.conf honeypot-manual.conf)
NEVER_BAN="$ROOT/etc/honeypot/never-ban"
EXPORT_DIR="$ROOT/var/log/honeypot-export"
QUEUE_DIR="$ROOT/opt/honeypot/fban-queue"
# Must match the dashboard image user (Dockerfile: useradd --uid 1000).
DASHBOARD_UID=1000

CORE_SCRIPTS=(fail2ban-export.sh sshd-auth-export.sh docker-user-firewall.sh geoip-update.sh honeypot-ban.sh honeypot-never-ban.sh cowrie-downloads-perms.py)
CORE_UNITS=(
  fail2ban-export.service fail2ban-export.timer
  sshd-auth-export.service sshd-auth-export.timer
  docker-user-firewall.service docker-user-firewall.timer
  geoip-update.service geoip-update.timer
)
CORE_ENABLE=(fail2ban-export.timer sshd-auth-export.timer docker-user-firewall.service docker-user-firewall.timer geoip-update.timer)
# Generated from scripts/*.tmpl: they name the Docker volume's real path.
PERMS_UNITS=(cowrie-downloads-perms.service cowrie-downloads-perms.path)
PERMS_ENABLE=(cowrie-downloads-perms.path)
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
  local conf listen
  conf="$(sshd -T 2>/dev/null || true)"
  # ListenAddress entries carry their own port and override Port.
  listen="$(awk '/^listenaddress /{n = split($2, a, ":"); print a[n]}' <<<"$conf")"
  {
    if [[ -n "$listen" ]]; then echo "$listen"; else awk '/^port /{print $2}' <<<"$conf"; fi
    ss -ltnpH 2>/dev/null | awk '/"sshd"/{n = split($4, a, ":"); print a[n]}'
    # Socket activation (ssh.socket): systemd holds the listener, so ss never names sshd.
    if systemctl is-active --quiet ssh.socket 2>/dev/null; then
      systemctl show ssh.socket -p Listen --value 2>/dev/null | awk '{n = split($1, a, ":"); print a[n]}'
    fi
  } | grep -E '^[0-9]+$' | sort -un || true
}

# Reads `ufw status` output. Returns 0 when an ALLOW/LIMIT rule opens $2/tcp, 3 when no
# rule does but some rules use application profiles (ports unknown here), 1 otherwise.
ufw_allows_port() {
  local port="$1" line action i spec proto ports item apps=0
  local -a words to
  while IFS= read -r line; do
    read -ra words <<<"$line"
    action=""
    to=()
    for ((i = 0; i < ${#words[@]}; i++)); do
      case "${words[i]}" in
        ALLOW|LIMIT|DENY|REJECT) action="${words[i]}"; break ;;
        *) to+=("${words[i]}") ;;
      esac
    done
    [[ "$action" == ALLOW || "$action" == LIMIT ]] || continue
    # Drop the "(v6)" marker and an "on <iface>" suffix: "50022/tcp (v6) on eth0".
    for ((i = ${#to[@]} - 1; i >= 0; i--)); do
      if [[ "${to[i]}" == "(v6)" ]]; then unset 'to[i]'; fi
    done
    to=("${to[@]}")
    if (( ${#to[@]} >= 2 )) && [[ "${to[${#to[@]} - 2]}" == on ]]; then
      to=("${to[@]:0:${#to[@]} - 2}")
    fi
    (( ${#to[@]} > 0 )) || continue
    spec="${to[${#to[@]} - 1]}"
    [[ "$spec" == Anywhere ]] && return 0
    proto=""
    [[ "$spec" == */* ]] && proto="${spec#*/}"
    ports="${spec%%/*}"
    if ! [[ "$ports" =~ ^[0-9][0-9,:]*$ ]]; then
      apps=1
      continue
    fi
    [[ -z "$proto" || "$proto" == tcp ]] || continue
    IFS=, read -ra words <<<"$ports"
    for item in "${words[@]}"; do
      if [[ "$item" == *:* ]]; then
        (( port >= ${item%%:*} && port <= ${item##*:} )) && return 0
      elif [[ "$item" == "$port" ]]; then
        return 0
      fi
    done
  done <<<"$2"
  (( apps )) && return 3
  return 1
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
    local ufw_rc=0
    ufw_allows_port "$SSHD_PORT" "$ufw_status" || ufw_rc=$?
    case "$ufw_rc" in
      0) log "ufw allows $SSHD_PORT/tcp" ;;
      3) warn "ufw rules use application profiles (e.g. OpenSSH) whose ports are not checked here:" \
           "make sure one of them opens $SSHD_PORT/tcp (ufw app info <name>)." ;;
      *)
        echo "[install-host] ufw is active but no ALLOW/LIMIT rule opens port $SSHD_PORT/tcp."
        echo "[install-host] Run: ufw allow ${SSHD_PORT}/tcp   then rerun this installer."
        exit 2
        ;;
    esac
  else
    warn "ufw is not active. Make sure your provider firewall allows $SSHD_PORT/tcp and 22/tcp."
  fi

  # The firewall unit hooks into docker.service: without Docker, enabling it fails halfway.
  local docker_cmd="docker compose version && systemctl cat docker.service"
  [[ -n "$ROOT" ]] && docker_cmd="${DOCKER_CHECK_CMD:-true}"
  if ! bash -c "$docker_cmd" >/dev/null 2>&1; then
    fail "Docker Engine with the compose plugin is required (docker compose version, docker.service): install it first (docs/install.md, step 1)."
  fi
  # The egress block matches HONEYPOT_SUBNET from host.env; compose creates the network
  # from the one in .env. If they differ, the honeypot can reach the Internet unnoticed.
  local host_subnet="${HONEYPOT_SUBNET:-172.21.0.0/16}" env_subnet=""
  if [[ -f "$REPO_DIR/.env" ]]; then
    env_subnet="$(sed -n 's/^HONEYPOT_SUBNET=//p' "$REPO_DIR/.env" | tail -n1 | tr -d "\"'")"
  fi
  env_subnet="${env_subnet:-172.21.0.0/16}"
  if [[ "$env_subnet" != "$host_subnet" ]]; then
    fail "HONEYPOT_SUBNET is $host_subnet in $HOST_ENV but $env_subnet in $REPO_DIR/.env: set the same value in both (the egress block would miss the honeypot)."
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

# Space-separated never-ban entries for fail2ban's ignoreip (comments and blanks dropped).
never_ban_entries() {
  [[ -f "$NEVER_BAN" ]] || return 0
  sed 's/#.*//' "$NEVER_BAN" | tr -s ' \t' '\n' | grep -E '^[0-9a-fA-F:.]+(/[0-9]{1,3})?$' | tr '\n' ' ' | sed 's/ $//'
}

# Cowrie writes its JSON log into a named Docker volume; fail2ban reads it from the host.
cowrie_json_path() {
  if [[ -n "${COWRIE_JSON:-}" ]]; then
    echo "$COWRIE_JSON"
    return
  fi
  local volume=""
  if [[ -f "$REPO_DIR/.env" ]]; then
    volume="$(sed -n 's/^COWRIE_VAR_VOLUME=//p' "$REPO_DIR/.env" | tail -n1)"
  fi
  echo "/var/lib/docker/volumes/${volume:-honeypot-cowrie-var}/_data/log/cowrie/cowrie.json"
}

# Cowrie keeps captured files next to its logs: <var>/lib/cowrie/downloads.
cowrie_downloads_dir() {
  local json
  json="$(cowrie_json_path)"
  case "$json" in
    */log/cowrie/cowrie.json) echo "${json%/log/cowrie/cowrie.json}/lib/cowrie/downloads" ;;
    *) echo "" ;;
  esac
}

# Returns 0 when the units are in place (to enable), 1 when skipped.
install_downloads_perms() {
  local dir tmp f
  dir="$(cowrie_downloads_dir)"
  if [[ -z "$dir" ]]; then
    warn "COWRIE_JSON does not end in /log/cowrie/cowrie.json: cannot locate Cowrie's downloads," \
      "so the dashboard cannot zip captured files."
    for f in "${PERMS_ENABLE[@]}"; do
      [[ -e "$UNITS/$f" ]] && systemctl_do disable --now "$f"
    done
    for f in "${PERMS_UNITS[@]}"; do remove_file "$UNITS/$f"; done
    return 1
  fi
  tmp="$(mktemp)"
  for f in "${PERMS_UNITS[@]}"; do
    sed "s|@DOWNLOADS_DIR@|$dir|g" "$REPO_SCRIPTS/$f.tmpl" >"$tmp"
    install_file 0644 "$tmp" "$UNITS/$f"
  done
  rm -f "$tmp"
  return 0
}

install_jail() {
  local cowrie_json cowrie_enabled=true changed=0
  cowrie_json="$(cowrie_json_path)"
  if [[ ! -f "$ROOT$cowrie_json" ]]; then
    # fail2ban refuses to start at all when a jail's log file is missing.
    warn "Cowrie log $cowrie_json not found: cowrie jail disabled. Start Cowrie, then rerun this installer."
    cowrie_enabled=false
  fi

  local src dest pair
  for pair in "action.d/honeypot-block.conf" "${F2B_FILTERS[@]/#/filter.d/}"; do
    src="$REPO_SCRIPTS/fail2ban/$pair"
    dest="$ROOT/etc/fail2ban/$pair"
    cmp -s "$src" "$dest" 2>/dev/null || changed=1
    install_file 0644 "$src" "$dest"
  done

  local tmp backup="" jail_differs=1
  tmp="$(mktemp)"
  sed -e "s|@SSHD_PORT@|$SSHD_PORT|" \
      -e "s|@HONEYPOT_SUBNET@|${HONEYPOT_SUBNET:-172.21.0.0/16}|" \
      -e "s|@NEVER_BAN@|$(never_ban_entries)|" \
      -e "s|@COWRIE_JSON@|$cowrie_json|" \
      -e "s|@COWRIE_ENABLED@|$cowrie_enabled|" \
      "$REPO_SCRIPTS/fail2ban/honeypot.local.tmpl" >"$tmp"
  [[ -f "$JAIL_FILE" ]] && cmp -s "$tmp" "$JAIL_FILE" && jail_differs=0
  if [[ "$jail_differs" == 1 ]]; then
    changed=1
    if [[ -f "$JAIL_FILE" && "$DRY_RUN" == 0 ]]; then
      backup="$(mktemp)"
      cp "$JAIL_FILE" "$backup"
    fi
    install_file 0644 "$tmp" "$JAIL_FILE"
  fi
  rm -f "$tmp"
  if [[ -e "$LEGACY_JAIL_FILE" ]]; then
    remove_file "$LEGACY_JAIL_FILE"
    changed=1
  fi

  # A broken jail file stops fail2ban entirely: check it before any reload.
  if [[ "$changed" == 1 && -z "$ROOT" && "$DRY_RUN" == 0 ]] && command -v fail2ban-client >/dev/null; then
    if ! fail2ban-client -t >/dev/null 2>&1; then
      if [[ -n "$backup" ]]; then cp "$backup" "$JAIL_FILE"; else rm -f "$JAIL_FILE"; fi
      rm -f "$backup"
      fail "fail2ban rejected $JAIL_FILE (restored the previous one): run fail2ban-client -t"
    fi
  fi
  rm -f "$backup"
  [[ "$changed" == 1 ]]
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

  local jail_changed=0 perms=0
  if install_jail; then jail_changed=1; fi
  if install_downloads_perms; then perms=1; fi

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
  if [[ "$perms" == 1 ]]; then
    systemctl_do enable --now "${PERMS_ENABLE[@]}"
    # The path unit only reacts to new files: fix the ones already captured.
    [[ -d "$ROOT$(cowrie_downloads_dir)" ]] && systemctl_do start cowrie-downloads-perms.service
  fi
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
  local all_enable=("${CORE_ENABLE[@]}" "${PERMS_ENABLE[@]}" "${FBAN_ENABLE[@]}")
  for f in "${all_enable[@]}"; do
    [[ -e "$UNITS/$f" ]] && systemctl_do disable --now "$f"
  done
  # Timers are stopped above, so nothing re-adds the rules once cleared.
  if [[ -n "$ROOT" ]]; then
    log "skip (no iptables under --root): docker-user-firewall.sh --clear"
  else
    run bash "$REPO_SCRIPTS/docker-user-firewall.sh" --clear \
      || warn "could not clear DOCKER-USER: run $REPO_SCRIPTS/docker-user-firewall.sh --clear"
  fi
  for f in "${CORE_UNITS[@]}" "${PERMS_UNITS[@]}" "${FBAN_UNITS[@]}"; do remove_file "$UNITS/$f"; done
  for f in "${CORE_SCRIPTS[@]}" "${FBAN_SCRIPTS[@]}"; do remove_file "$SBIN/$f"; done
  remove_file "$ROOT/etc/logrotate.d/honeypot-export"
  if [[ -e "$JAIL_FILE" || -e "$LEGACY_JAIL_FILE" ]]; then
    remove_file "$JAIL_FILE"
    remove_file "$LEGACY_JAIL_FILE"
    systemctl_do reload-or-restart fail2ban
  fi
  remove_file "$F2B_ACTION"
  for f in "${F2B_FILTERS[@]}"; do remove_file "$ROOT/etc/fail2ban/filter.d/$f"; done
  systemctl_do daemon-reload
  log "removed. Kept: $EXPORT_DIR, $NEVER_BAN, $HOST_ENV, Docker volumes."
}

if [[ "$MODE" == uninstall ]]; then
  do_uninstall
else
  do_install
fi
