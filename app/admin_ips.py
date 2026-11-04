"""
The owner's own addresses: never banned. They come from the ADMIN_IPS env var
(read-only, `app.state.admin_networks`) plus the `admin_networks` table edited
from the settings page.
"""

import ipaddress
import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

# Read by the host's honeypot-never-ban.sh (fail2ban ignorecommand and ban worker),
# so the settings page also protects these addresses from automatic bans.
HOST_FILE_NAME = "admin-networks"

# A wider range would make most of the internet unbannable; refuse it outright.
MIN_PREFIX = {4: 16, 6: 48}


def validate_network(raw: str):
    network = ipaddress.ip_network(raw.strip(), strict=False)
    if network.prefixlen < MIN_PREFIX[network.version]:
        raise ValueError(f"range wider than /{MIN_PREFIX[network.version]}")
    return network


def list_admin_networks(db: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in db.execute("SELECT cidr, note, created_at FROM admin_networks ORDER BY created_at")]


def add_admin_network(db: sqlite3.Connection, raw: str, note: str | None) -> str:
    """Returns the normalized CIDR; raises ValueError (invalid) or sqlite3.IntegrityError (duplicate)."""
    cidr = str(validate_network(raw))
    with db:
        db.execute(
            "INSERT INTO admin_networks (cidr, note, created_at) VALUES (?, ?, ?)",
            (cidr, (note or "").strip() or None, datetime.now(timezone.utc).isoformat()),
        )
    return cidr


def remove_admin_network(db: sqlite3.Connection, cidr: str) -> bool:
    with db:
        return db.execute("DELETE FROM admin_networks WHERE cidr = ?", (cidr,)).rowcount > 0


def admin_networks(app) -> list:
    stored = []
    for row in app.state.db.execute("SELECT cidr FROM admin_networks"):
        try:
            stored.append(ipaddress.ip_network(row["cidr"], strict=False))
        except ValueError:
            continue
    return [*getattr(app.state, "admin_networks", []), *stored]


def export_admin_networks(app) -> None:
    """Write every protected network into the ban queue directory shared with the host.
    Best effort: without the host side, the list still guards the Ban button."""
    queue = getattr(app.state, "fban_queue_path", None)
    if queue is None:
        return
    lines = [
        "# Written by honeypot-dashboard (ADMIN_IPS + settings page). Do not edit: changes are overwritten.",
        *sorted({str(n) for n in admin_networks(app)}),
    ]
    target = Path(queue) / HOST_FILE_NAME
    tmp = target.with_name(f".{HOST_FILE_NAME}.tmp")
    try:
        tmp.write_text("\n".join(lines) + "\n")
        os.replace(tmp, target)  # atomic: the host never reads half a list
    except OSError as exc:
        log.warning("could not write %s: %s", target, exc)


def is_admin_ip(app, ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in network for network in admin_networks(app))
