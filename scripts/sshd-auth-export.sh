#!/usr/bin/env bash
# /usr/local/sbin/sshd-auth-export.sh
# Exports new sshd journal entries to a flat file the dashboard container
# can read via the `adm` group, since this host has no /var/log/auth.log.
set -euo pipefail

OUT_FILE="/var/log/sshd-auth.log"
CURSOR_FILE="/var/lib/sshd-auth-export.cursor"

touch "$OUT_FILE"
chown root:adm "$OUT_FILE"
chmod 640 "$OUT_FILE"

if [[ -f "$CURSOR_FILE" ]]; then
  journalctl _COMM=sshd -o short-iso --show-cursor \
    --after-cursor="$(cat "$CURSOR_FILE")" \
    >> /tmp/sshd-auth-export.tmp
else
  journalctl _COMM=sshd -o short-iso --show-cursor --since "5 minutes ago" \
    >> /tmp/sshd-auth-export.tmp
fi

# the last line is "-- cursor: s=...", strip it out before appending and
# save it separately as the new cursor position
grep -v '^-- cursor:' /tmp/sshd-auth-export.tmp >> "$OUT_FILE" || true
grep '^-- cursor:' /tmp/sshd-auth-export.tmp | tail -1 | sed 's/^-- cursor: //' > "$CURSOR_FILE" || true
rm -f /tmp/sshd-auth-export.tmp
