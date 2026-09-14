#!/usr/bin/env bash
# /usr/local/sbin/fban-queue-worker.sh
# Processes ban/unban/status requests the honeypot-dashboard container writes
# into QUEUE_DIR (bind-mounted RW at /queue in the container, this path on the
# host). Every request is strictly validated before fail2ban-client is ever
# invoked: verb must be ban/unban/status, jail must be exactly "sshd", and the
# IP must match a simple IPv4/IPv6-shaped pattern. Anything else is logged and
# dropped, unexecuted. Triggered by fban-queue-worker.path on any change to
# QUEUE_DIR; safe to run by hand or re-run (idempotent: only unprocessed
# req-* files are touched).
set -euo pipefail

QUEUE_DIR="/opt/honeypot/fban-queue"
LINE_RE='^(ban|unban|status) (sshd) (([0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-fA-F:]+)$'

shopt -s nullglob
for req in "$QUEUE_DIR"/req-*; do
  id="${req#"$QUEUE_DIR"/req-}"
  res="$QUEUE_DIR/res-$id"
  line="$(head -n1 "$req" || true)"

  if [[ ! "$line" =~ $LINE_RE ]]; then
    logger -t fban-queue-worker "rejected malformed request in $req: $line" || true
    rm -f "$req" || true
    continue
  fi

  action="${BASH_REMATCH[1]}"
  jail="${BASH_REMATCH[2]}"
  ip="${BASH_REMATCH[3]}"

  case "$action" in
    ban)
      if fail2ban-client set "$jail" banip "$ip" >/dev/null 2>&1; then
        echo "ok" > "$res"
      else
        echo "error: fail2ban-client set $jail banip $ip failed" > "$res"
      fi
      ;;
    unban)
      if fail2ban-client set "$jail" unbanip "$ip" >/dev/null 2>&1; then
        echo "ok" > "$res"
      else
        echo "error: fail2ban-client set $jail unbanip $ip failed" > "$res"
      fi
      ;;
    status)
      if fail2ban-client status "$jail" 2>/dev/null | grep -qE "Banned IP list.*(^|[^0-9A-Fa-f.:])$ip([^0-9A-Fa-f.:]|$)"; then
        echo "banned" > "$res"
      else
        echo "not_banned" > "$res"
      fi
      ;;
  esac

  rm -f "$req" || true
done
