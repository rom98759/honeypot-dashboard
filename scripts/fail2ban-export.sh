#!/usr/bin/env bash
# /usr/local/sbin/fail2ban-export.sh
# Copies new lines of /var/log/fail2ban.log into /var/log/honeypot-export/,
# a directory the dashboard container bind-mounts. Mounting the log file
# itself pins the inode present at container start, so after a logrotate the
# container kept reading the old file and silently stopped ingesting.
#
# Usage: fail2ban-export.sh [--backfill] [--dry-run]
#   --backfill  first run only: also export the rotated files still on disk
#               (fail2ban.log.N.gz ... fail2ban.log.1), oldest first
#   --dry-run   print what would be exported, change nothing
set -euo pipefail

# Overridable only so the script can be exercised against a scratch directory.
SRC="${FAIL2BAN_EXPORT_SRC:-/var/log/fail2ban.log}"
OUT_DIR="${FAIL2BAN_EXPORT_OUT_DIR:-/var/log/honeypot-export}"
OUT_FILE="$OUT_DIR/fail2ban.log"
STATE_FILE="${FAIL2BAN_EXPORT_STATE:-/var/lib/honeypot-export/fail2ban.state}" # "<inode> <offset>"

BACKFILL=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --backfill) BACKFILL=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log() { echo "fail2ban-export: $*" >&2; }

# Appends bytes [offset, size) of $1 to the output file.
copy_range() {
  local file=$1 offset=$2 size=$3
  if (( size <= offset )); then
    return
  fi
  log "copy $file bytes $offset..$size"
  if (( DRY_RUN )); then
    return
  fi
  dd if="$file" iflag=skip_bytes,count_bytes skip="$offset" count="$((size - offset))" \
    bs=1M status=none >> "$OUT_FILE"
}

if (( ! DRY_RUN )); then
  install -d -m 750 "$OUT_DIR"
  install -d -m 700 "$(dirname "$STATE_FILE")"
  touch "$OUT_FILE"
  chmod 640 "$OUT_FILE"
  if (( EUID == 0 )); then
    chown root:adm "$OUT_DIR" "$OUT_FILE"
  fi
fi

[[ -f "$SRC" ]] || { log "$SRC missing, nothing to do"; exit 0; }
cur_inode=$(stat -c %i "$SRC")
cur_size=$(stat -c %s "$SRC")

if [[ ! -f "$STATE_FILE" ]]; then
  if (( BACKFILL )); then
    # Oldest first so the exported file stays in chronological order.
    mapfile -t rotated < <(compgen -G "$SRC.*.gz" | sort -t. -k3,3nr)
    for gz in "${rotated[@]}"; do
      log "backfill $gz"
      (( DRY_RUN )) || zcat "$gz" >> "$OUT_FILE"
    done
    if [[ -f "$SRC.1" ]]; then
      copy_range "$SRC.1" 0 "$(stat -c %s "$SRC.1")"
    fi
    offset=0
  else
    offset=$cur_size # start from now: history before the first run is not exported
  fi
else
  read -r prev_inode offset < "$STATE_FILE"
  if [[ "$prev_inode" != "$cur_inode" ]]; then
    # Rotated since last run: finish the old file (still plain thanks to
    # delaycompress) before starting the new one from the top.
    if [[ -f "$SRC.1" && "$(stat -c %i "$SRC.1")" == "$prev_inode" ]]; then
      copy_range "$SRC.1" "$offset" "$(stat -c %s "$SRC.1")"
    else
      log "previous file (inode $prev_inode) not found as $SRC.1, its tail is lost"
    fi
    offset=0
  elif (( cur_size < offset )); then
    log "$SRC shrank (truncated), restarting from the top"
    offset=0
  fi
fi

copy_range "$SRC" "$offset" "$cur_size"

if (( ! DRY_RUN )); then
  echo "$cur_inode $cur_size" > "$STATE_FILE"
fi
