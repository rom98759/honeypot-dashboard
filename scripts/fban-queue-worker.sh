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
# Must match the dashboard container's user (Dockerfile: `useradd --uid 1000 dashboard`)
# so the container can create req-* files and read res-* files in this bind mount.
DASHBOARD_UID=1000
DASHBOARD_GID=1000
LINE_RE='^(ban|unban|status) (sshd) (([0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-fA-F:]+)$'

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

  action="${BASH_REMATCH[1]}"
  jail="${BASH_REMATCH[2]}"
  ip="${BASH_REMATCH[3]}"

  case "$action" in
    ban)
      if fail2ban-client set "$jail" banip "$ip" >/dev/null 2>&1; then
        echo "ok" > "$res.tmp" && mv "$res.tmp" "$res"
      else
        echo "error: fail2ban-client set $jail banip $ip failed" > "$res.tmp" && mv "$res.tmp" "$res"
      fi
      ;;
    unban)
      if fail2ban-client set "$jail" unbanip "$ip" >/dev/null 2>&1; then
        echo "ok" > "$res.tmp" && mv "$res.tmp" "$res"
      else
        echo "error: fail2ban-client set $jail unbanip $ip failed" > "$res.tmp" && mv "$res.tmp" "$res"
      fi
      ;;
    status)
      status_out="$(fail2ban-client status "$jail" 2>/dev/null || true)"
      if grep -qE "Banned IP list.*(^|[^0-9A-Fa-f.:])$ip([^0-9A-Fa-f.:]|$)" <<<"$status_out"; then
        echo "banned" > "$res.tmp" && mv "$res.tmp" "$res"
      else
        echo "not_banned" > "$res.tmp" && mv "$res.tmp" "$res"
      fi
      ;;
  esac

  rm -f "$req" || true
done
