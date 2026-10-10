#!/usr/bin/env bash
# /home/user/geoip-update.sh
# Refreshes the GeoLite2-City and GeoLite2-ASN databases used by honeypot-dashboard.
# Credentials read from /home/user/.geoip-credentials (chmod 600), never
# hardcoded here or passed on the command line (would leak into ps/crontab logs).
set -euo pipefail

source /home/user/.geoip-credentials

TARGET_DIR="/home/user/honeypot-dashboard/geoip"
TMP_FILE="$(mktemp)"

curl -sSL -u "${MAXMIND_ID}:${MAXMIND_KEY}" \
  "https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz" \
  -o "$TMP_FILE"

WORKDIR="$(mktemp -d)"
tar -xzf "$TMP_FILE" -C "$WORKDIR"
find "$WORKDIR" -name 'GeoLite2-City.mmdb' -exec mv {} "$TARGET_DIR/GeoLite2-City.mmdb" \;
rm -rf "$WORKDIR" "$TMP_FILE"

echo "$(date -Iseconds) GeoLite2-City.mmdb refreshed"

TMP_FILE="$(mktemp)"
curl -sSL -u "${MAXMIND_ID}:${MAXMIND_KEY}" \
  "https://download.maxmind.com/geoip/databases/GeoLite2-ASN/download?suffix=tar.gz" \
  -o "$TMP_FILE"

WORKDIR="$(mktemp -d)"
tar -xzf "$TMP_FILE" -C "$WORKDIR"
find "$WORKDIR" -name 'GeoLite2-ASN.mmdb' -exec mv {} "$TARGET_DIR/GeoLite2-ASN.mmdb" \;
rm -rf "$WORKDIR" "$TMP_FILE"

echo "$(date -Iseconds) GeoLite2-ASN.mmdb refreshed"
