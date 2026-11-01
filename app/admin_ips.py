import ipaddress


def is_admin_ip(app, ip: str) -> bool:
    """True when `ip` falls in ADMIN_IPS (the owner's own addresses)."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in network for network in getattr(app.state, "admin_networks", []))
