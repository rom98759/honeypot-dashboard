"""
The owner's own addresses: never banned. They come from the ADMIN_IPS env var
(read-only, `app.state.admin_networks`) plus the `admin_networks` table edited
from the settings page.
"""

import ipaddress
import sqlite3
from datetime import datetime, timezone

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


def is_admin_ip(app, ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in network for network in admin_networks(app))
