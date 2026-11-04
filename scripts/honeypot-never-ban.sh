#!/usr/bin/env bash
# /usr/local/sbin/honeypot-never-ban.sh
# Exit 0 when IP must never be banned, 1 otherwise (2 = usage). Used as
# fail2ban's ignorecommand (scripts/fail2ban/honeypot.local.tmpl) and by
# fban-queue-worker.sh, so every jail and the dashboard Ban button agree.
#
# Two lists, read on every call so a change applies without reloading fail2ban:
#   - /etc/honeypot/never-ban: the owner's file, any IP or CIDR;
#   - the queue directory's admin-networks: what the dashboard settings page
#     (plus ADMIN_IPS) writes. The container can write there, so entries wider
#     than /16 (IPv4) or /48 (IPv6) are ignored: a compromised dashboard could
#     otherwise whitelist most of the Internet.
#
# Usage: honeypot-never-ban.sh IP
set -euo pipefail

NEVER_BAN_FILE="${HONEYPOT_NEVER_BAN:-/etc/honeypot/never-ban}"
DASHBOARD_FILE="${HONEYPOT_DASHBOARD_NETWORKS:-/opt/honeypot/fban-queue/admin-networks}"

if [[ $# != 1 ]]; then
  sed -n '/^# Usage:/,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//' >&2
  exit 2
fi

exec python3 -I -c '
import ipaddress, os, sys

MIN_PREFIX = {4: 16, 6: 48}
MAX_DASHBOARD_BYTES = 64 * 1024

try:
    ip = ipaddress.ip_address(sys.argv[1])
except ValueError:
    sys.exit(1)

def entries(path, trusted):
    # The dashboard file sits in a directory the container can write: no symlink
    # (it could point at any root-readable file), bounded size.
    if not os.path.isfile(path) or (not trusted and os.path.islink(path)):
        return
    if not trusted and os.path.getsize(path) > MAX_DASHBOARD_BYTES:
        return
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            entry = line.split("#", 1)[0].strip()
            if not entry:
                continue
            try:
                network = ipaddress.ip_network(entry, strict=False)
            except ValueError:
                continue
            if not trusted and network.prefixlen < MIN_PREFIX[network.version]:
                continue
            yield network

for path, trusted in ((sys.argv[2], True), (sys.argv[3], False)):
    if any(ip in network for network in entries(path, trusted)):
        sys.exit(0)
sys.exit(1)
' "$1" "$NEVER_BAN_FILE" "$DASHBOARD_FILE"
