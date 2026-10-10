import concurrent.futures
import datetime
import socket
from dataclasses import dataclass

import requests

ABUSEIPDB_DAILY_CAP = 950
ABUSEIPDB_TIMEOUT_SECONDS = 5
REVERSE_DNS_TIMEOUT_SECONDS = 3.0


class AsnLookup:
    """Wraps a GeoLite2-ASN reader. No reader / IP not found -> (None,
    None), never raises — same contract as app/geoip.py's GeoLookup."""

    def __init__(self, reader):
        self.reader = reader

    def lookup(self, ip: str) -> tuple[int | None, str | None]:
        if self.reader is None:
            return None, None
        try:
            response = self.reader.asn(ip)
        except Exception:
            return None, None
        return response.autonomous_system_number, response.autonomous_system_organization


def reverse_dns_lookup(ip: str, timeout: float = REVERSE_DNS_TIMEOUT_SECONDS) -> str | None:
    """Runs socket.gethostbyaddr in a one-shot worker thread with a hard
    wall-clock timeout on the future, rather than mutating the process-wide
    socket.setdefaulttimeout — that global would affect every socket opened
    anywhere in the process during the call, and race with concurrent
    reverse_dns_lookup calls on other threads. Returns None on timeout,
    socket.herror (no PTR record), or any other failure — never raises."""
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        future = executor.submit(socket.gethostbyaddr, ip)
        hostname, _aliases, _addresses = future.result(timeout=timeout)
        return hostname
    except Exception:
        return None
    finally:
        executor.shutdown(wait=False)


class AbuseIpDbClient:
    """No API key -> every call is a no-op returning (None, None, None)
    with no network call attempted — this is what makes the feature fully
    optional. With a key: calls AbuseIPDB's /check endpoint; any
    exception/non-200 is swallowed and treated as "no data," never raised
    (one bad IP must not stop the enrichment worker from draining).
    Enforces an in-memory daily call cap as a safety margin under the free
    tier's 1000/day limit; not persisted across restarts."""

    def __init__(self, api_key: str | None):
        self.api_key = api_key
        self._date: datetime.date | None = None
        self._count = 0

    def check(self, ip: str) -> tuple[int | None, int | None, str | None]:
        if self.api_key is None:
            return None, None, None
        if not self._consume_quota():
            return None, None, None
        try:
            response = requests.get(
                "https://api.abuseipdb.com/api/v2/check",
                headers={"Key": self.api_key, "Accept": "application/json"},
                params={"ipAddress": ip, "maxAgeInDays": 90},
                timeout=ABUSEIPDB_TIMEOUT_SECONDS,
            )
            if response.status_code != 200:
                return None, None, None
            data = response.json()["data"]
            return data["abuseConfidenceScore"], data["totalReports"], data["lastReportedAt"]
        except Exception:
            return None, None, None

    def _consume_quota(self) -> bool:
        today = datetime.datetime.now(datetime.timezone.utc).date()
        if today != self._date:
            self._date = today
            self._count = 0
        if self._count >= ABUSEIPDB_DAILY_CAP:
            return False
        self._count += 1
        return True


@dataclass
class EnrichmentResult:
    asn: int | None
    asn_org: str | None
    reverse_dns: str | None
    abuseipdb_score: int | None
    abuseipdb_total_reports: int | None
    abuseipdb_last_reported_at: str | None


class IpEnrichment:
    """Orchestrates AsnLookup + reverse_dns_lookup + AbuseIpDbClient into
    one result. Call only from a worker thread (e.g. asyncio.to_thread) —
    this does blocking I/O."""

    def __init__(self, asn_lookup: AsnLookup, abuseipdb_client: AbuseIpDbClient):
        self.asn_lookup = asn_lookup
        self.abuseipdb_client = abuseipdb_client

    def resolve(self, ip: str) -> EnrichmentResult:
        asn, asn_org = self.asn_lookup.lookup(ip)
        reverse_dns = reverse_dns_lookup(ip)
        score, total_reports, last_reported_at = self.abuseipdb_client.check(ip)
        return EnrichmentResult(asn, asn_org, reverse_dns, score, total_reports, last_reported_at)
