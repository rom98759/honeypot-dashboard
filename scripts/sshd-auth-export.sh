#!/usr/bin/env bash
# /usr/local/sbin/sshd-auth-export.sh
# Exports new sshd journal entries to a flat file the dashboard container
# can read via the `adm` group, since this host has no /var/log/auth.log.
# The file lives in a directory (not mounted as a single file) so the
# container still sees the new file after logrotate replaces it.
set -euo pipefail

OUT_DIR="/var/log/honeypot-export"
OUT_FILE="$OUT_DIR/sshd-auth.log"
CURSOR_FILE="/var/lib/sshd-auth-export.cursor"

install -d -m 750 -o root -g adm "$OUT_DIR"
touch "$OUT_FILE"
chown root:adm "$OUT_FILE"
chmod 640 "$OUT_FILE"

TMP_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE"' EXIT

if [[ -f "$CURSOR_FILE" ]]; then
  journalctl _COMM=sshd -o short-iso --show-cursor \
    --after-cursor="$(cat "$CURSOR_FILE")" >> "$TMP_FILE"
else
  journalctl _COMM=sshd -o short-iso --show-cursor --since "5 minutes ago" >> "$TMP_FILE"
fi

# the last line is "-- cursor: s=...", strip it out before appending and
# save it separately as the new cursor position
grep -v '^-- cursor:' "$TMP_FILE" >> "$OUT_FILE" || true
grep '^-- cursor:' "$TMP_FILE" | tail -1 | sed 's/^-- cursor: //' > "$CURSOR_FILE" || true
