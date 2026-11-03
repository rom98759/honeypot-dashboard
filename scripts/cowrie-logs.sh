#!/usr/bin/env bash
# Reads Cowrie logs from its named volume (no host bind-mount to look at directly).
# Usage, from the repo directory:
#   scripts/cowrie-logs.sh json [N]   last N lines of the structured JSON log (default 50)
#   scripts/cowrie-logs.sh text [N]   last N lines of the human-readable log
#   scripts/cowrie-logs.sh follow     follow the container output
#   scripts/cowrie-logs.sh downloads  files uploaded/fetched by attackers (possible malware)
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-text}"
N="${2:-50}"

volume="honeypot-cowrie-var"
if [[ -f "$REPO_DIR/.env" ]]; then
  configured="$(sed -n 's/^COWRIE_VAR_VOLUME=//p' "$REPO_DIR/.env" | tail -n1)"
  volume="${configured:-$volume}"
fi

read_volume() {
  docker run --rm -v "$volume:/v:ro" alpine "$@"
}

case "$MODE" in
  json) read_volume tail -n "$N" /v/log/cowrie/cowrie.json ;;
  text) read_volume tail -n "$N" /v/log/cowrie/cowrie.log ;;
  follow) docker compose --project-directory "$REPO_DIR" logs -f cowrie ;;
  downloads)
    read_volume find /v/lib/cowrie/downloads -type f -printf '%TY-%Tm-%Td %TH:%TM  %8s  %f\n' 2>/dev/null \
      || echo "no attacker file downloaded yet"
    ;;
  *)
    echo "Usage: $0 {json|text|follow|downloads} [N]" >&2
    exit 1
    ;;
esac
