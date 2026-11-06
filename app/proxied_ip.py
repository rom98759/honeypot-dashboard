"""Docker's userland proxy relays IPv6 clients to Cowrie from the honeypot network
gateway, so every IPv6 attacker is recorded under that one private address. The
sessions are kept, but the address is not a real attacker and must not rank as one."""

import ipaddress
import os

DEFAULT_SUBNET = "172.21.0.0/16"


def gateway_ip(subnet: str | None) -> str | None:
    try:
        network = ipaddress.ip_network((subnet or DEFAULT_SUBNET).strip(), strict=False)
    except ValueError:
        return None
    if network.num_addresses < 4:
        return None
    # Docker gives a bridge network the first host address as its gateway.
    return str(network.network_address + 1)


PROXIED_SOURCE_IP = gateway_ip(os.environ.get("HONEYPOT_SUBNET"))
