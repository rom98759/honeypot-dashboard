#!/usr/bin/env bash
# /usr/local/sbin/fban-queue-worker.sh
# Processes ban/unban/status requests the honeypot-dashboard container writes
# into QUEUE_DIR (bind-mounted RW at /queue in the container, this path on the
# host). Every request is strictly validated before fail2ban-client is ever
# invoked, and only these lines are accepted:
#   ban manual|manual-all <ip>   ban in the dashboard's own jails (scripts/fail2ban/honeypot.local.tmpl)
#   unban all <ip>               lift the IP from every jail
#   status all <ip>              "banned <jail>,<jail>" or "not_banned"
# where <ip> must match a simple IPv4/IPv6-shaped pattern. Anything else is logged and
# dropped, unexecuted. Triggered by fban-queue-worker.path on any change to
# QUEUE_DIR; safe to run by hand or re-run (idempotent: only unprocessed
# req-* files are touched).
set -euo pipefail

QUEUE_DIR="/opt/honeypot/fban-queue"
# Must match the dashboard container's user (Dockerfile: `useradd --uid 1000 dashboard`)
# so the container can create req-* files and read res-* files in this bind mount.
DASHBOARD_UID=1000
DASHBOARD_GID=1000
IP_RE='(([0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-fA-F:]+)'
LINE_RE="^(ban (manual|manual-all)|(unban|status) all) $IP_RE\$"
# One IP or CIDR per line (# comments allowed): addresses that must never be banned,
# checked here as well as in the dashboard so a request that bypasses the app is refused too.
NEVER_BAN_FILE="/etc/honeypot/never-ban"

is_protected() {
  [[ -f "$NEVER_BAN_FILE" ]] || return 1
  python3 -I -c '
import ipaddress, sys
ip = ipaddress.ip_address(sys.argv[1])
for line in open(sys.argv[2]):
    entry = line.split("#", 1)[0].strip()
    if not entry:
        continue
    try:
        if ip in ipaddress.ip_network(entry, strict=False):
            sys.exit(0)
    except ValueError:
        continue
sys.exit(1)
' "$1" "$NEVER_BAN_FILE"
}

# Self-provision the queue directory (mirrors sshd-auth-export.sh provisioning its own
# output file) so deployment doesn't depend on a manual mkdir/chown step. Idempotent.
install -d -m 0770 -o "$DASHBOARD_UID" -g "$DASHBOARD_GID" "$QUEUE_DIR"

shopt -s nullglob

# Clean up response/temp files nobody ever picked up (e.g. the client timed
# out before we finished writing res-<id>). 10 minutes is generous relative
# to the client's timeout, which is measured in seconds.
find "$QUEUE_DIR" -maxdepth 1 -name 'res-*' -mmin +10 -delete 2>/dev/null || true
find "$QUEUE_DIR" -maxdepth 1 -name '.req-*.tmp' -mmin +10 -delete 2>/dev/null || true

for req in "$QUEUE_DIR"/req-*; do
  id="${req#"$QUEUE_DIR"/req-}"
  res="$QUEUE_DIR/res-$id"
  line="$(head -n1 "$req" || true)"

  if [[ ! "$line" =~ $LINE_RE ]]; then
    logger -t fban-queue-worker "rejected malformed request in $req: $line" || true
    rm -f "$req" || true
    continue
  fi

  read -r action jail ip <<<"$line"

  case "$action" in
    ban)
      if is_protected "$ip"; then
        logger -t fban-queue-worker "refused to ban protected IP $ip" || true
        echo "error: $ip is listed in $NEVER_BAN_FILE" > "$res.tmp" && mv "$res.tmp" "$res"
      elif fail2ban-client set "$jail" banip "$ip" >/dev/null 2>&1; then
        echo "ok" > "$res.tmp" && mv "$res.tmp" "$res"
      else
        echo "error: fail2ban-client set $jail banip $ip failed" > "$res.tmp" && mv "$res.tmp" "$res"
      fi
      ;;
    unban)
      if fail2ban-client unban "$ip" >/dev/null 2>&1; then
        echo "ok" > "$res.tmp" && mv "$res.tmp" "$res"
      else
        echo "error: fail2ban-client unban $ip failed" > "$res.tmp" && mv "$res.tmp" "$res"
      fi
      ;;
    status)
      # `banned <ip>` answers with the jails holding it, e.g. [['sshd', 'cowrie']].
      if ! banned_out="$(fail2ban-client banned "$ip" 2>/dev/null)"; then
        echo "error: fail2ban-client banned $ip failed" > "$res.tmp" && mv "$res.tmp" "$res"
      else
        jails="$(grep -oE "'[a-z0-9-]+'" <<<"$banned_out" | tr -d "'" | paste -sd, - || true)"
        if [[ -n "$jails" ]]; then
          echo "banned $jails" > "$res.tmp" && mv "$res.tmp" "$res"
        else
          echo "not_banned" > "$res.tmp" && mv "$res.tmp" "$res"
        fi
      fi
      ;;
  esac

  rm -f "$req" || true
done
