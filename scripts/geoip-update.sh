#!/usr/bin/env bash
# /usr/local/sbin/geoip-update.sh
# Downloads GeoLite2-City and GeoLite2-ASN into $REPO_DIR/geoip (mounted read-only
# by the dashboard). Run monthly by geoip-update.timer, or once by hand after install.
# MaxMind credentials come from host.env (chmod 600), never from the command line
# where they would show up in ps output and logs.
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

for key in REPO_DIR MAXMIND_ACCOUNT_ID MAXMIND_LICENSE_KEY; do
  if [[ -z "${!key:-}" ]]; then
    echo "geoip-update: $key is not set in $HOST_ENV" >&2
    exit 1
  fi
done

TARGET_DIR="$REPO_DIR/geoip"
install -d -m 0755 "$TARGET_DIR"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fetch() {
  local edition="$1"
  curl -fsSL -u "${MAXMIND_ACCOUNT_ID}:${MAXMIND_LICENSE_KEY}" \
    "https://download.maxmind.com/geoip/databases/${edition}/download?suffix=tar.gz" \
    -o "$WORKDIR/$edition.tar.gz"
  tar -xzf "$WORKDIR/$edition.tar.gz" -C "$WORKDIR"
  local mmdb
  mmdb="$(find "$WORKDIR" -name "$edition.mmdb" -print -quit)"
  if [[ -z "$mmdb" ]]; then
    echo "geoip-update: $edition.mmdb missing from the archive" >&2
    exit 1
  fi
  # Copy then rename inside the target dir: the dashboard never sees a half-written file.
  install -m 0644 "$mmdb" "$TARGET_DIR/.$edition.mmdb.new"
  mv -f "$TARGET_DIR/.$edition.mmdb.new" "$TARGET_DIR/$edition.mmdb"
  echo "$(date -Iseconds) $edition.mmdb refreshed"
}

fetch GeoLite2-City
fetch GeoLite2-ASN
