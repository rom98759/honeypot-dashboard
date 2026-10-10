import socket

from app.ip_enrichment import AbuseIpDbClient, AsnLookup, IpEnrichment, reverse_dns_lookup


class _FakeAsnResponse:
    def __init__(self, number, org):
        self.autonomous_system_number = number
        self.autonomous_system_organization = org


class _StubAsnReader:
    def asn(self, ip):
        if ip == "8.8.8.8":
            return _FakeAsnResponse(15169, "GOOGLE")
        raise ValueError("address not found in database")


def test_asn_lookup_resolves_number_and_org():
    lookup = AsnLookup(_StubAsnReader())
    assert lookup.lookup("8.8.8.8") == (15169, "GOOGLE")


def test_asn_lookup_none_reader_returns_none_tuple():
    lookup = AsnLookup(None)
    assert lookup.lookup("8.8.8.8") == (None, None)


def test_asn_lookup_not_found_returns_none_tuple():
    lookup = AsnLookup(_StubAsnReader())
    assert lookup.lookup("172.21.0.1") == (None, None)


def test_reverse_dns_lookup_resolves_hostname(monkeypatch):
    monkeypatch.setattr(socket, "gethostbyaddr", lambda ip: ("dns.google", [], [ip]))
    assert reverse_dns_lookup("8.8.8.8") == "dns.google"


def test_reverse_dns_lookup_no_ptr_returns_none(monkeypatch):
    def _raise(ip):
        raise socket.herror("unknown host")

    monkeypatch.setattr(socket, "gethostbyaddr", _raise)
    assert reverse_dns_lookup("172.21.0.1") is None


def test_reverse_dns_lookup_timeout_returns_none(monkeypatch):
    def _raise(ip):
        raise socket.timeout("timed out")

    monkeypatch.setattr(socket, "gethostbyaddr", _raise)
    assert reverse_dns_lookup("172.21.0.1", timeout=0.01) is None


def test_abuseipdb_no_key_makes_no_network_call(monkeypatch):
    def _exploding_get(*args, **kwargs):
        raise AssertionError("must not call AbuseIPDB without an API key")

    monkeypatch.setattr("app.ip_enrichment.requests.get", _exploding_get)
    client = AbuseIpDbClient(api_key=None)

    assert client.check("8.8.8.8") == (None, None, None)


class _FakeResponse:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        return self._body


def test_abuseipdb_resolves_score_and_reports(monkeypatch):
    def _fake_get(url, headers=None, params=None, timeout=None):
        return _FakeResponse(200, {"data": {
            "abuseConfidenceScore": 87,
            "totalReports": 12,
            "lastReportedAt": "2026-10-01T00:00:00+00:00",
        }})

    monkeypatch.setattr("app.ip_enrichment.requests.get", _fake_get)
    client = AbuseIpDbClient(api_key="fake-key")

    assert client.check("1.2.3.4") == (87, 12, "2026-10-01T00:00:00+00:00")


def test_abuseipdb_http_error_returns_none_tuple(monkeypatch):
    def _fake_get(url, headers=None, params=None, timeout=None):
        return _FakeResponse(429, {})

    monkeypatch.setattr("app.ip_enrichment.requests.get", _fake_get)
    client = AbuseIpDbClient(api_key="fake-key")

    assert client.check("1.2.3.4") == (None, None, None)


def test_abuseipdb_network_exception_returns_none_tuple(monkeypatch):
    def _fake_get(url, headers=None, params=None, timeout=None):
        raise ConnectionError("network unreachable")

    monkeypatch.setattr("app.ip_enrichment.requests.get", _fake_get)
    client = AbuseIpDbClient(api_key="fake-key")

    assert client.check("1.2.3.4") == (None, None, None)


def test_abuseipdb_quota_cap_skips_call_after_950_today(monkeypatch):
    calls = []

    def _fake_get(url, headers=None, params=None, timeout=None):
        calls.append(url)
        return _FakeResponse(200, {"data": {
            "abuseConfidenceScore": 0, "totalReports": 0, "lastReportedAt": None,
        }})

    monkeypatch.setattr("app.ip_enrichment.requests.get", _fake_get)
    client = AbuseIpDbClient(api_key="fake-key")
    import datetime
    client._count = 950
    client._date = datetime.datetime.now(datetime.timezone.utc).date()

    assert client.check("1.2.3.4") == (None, None, None)
    assert calls == []


def test_ip_enrichment_resolve_combines_all_three(monkeypatch):
    monkeypatch.setattr(socket, "gethostbyaddr", lambda ip: ("dns.google", [], [ip]))
    asn_lookup = AsnLookup(_StubAsnReader())
    abuseipdb_client = AbuseIpDbClient(api_key=None)
    enrichment = IpEnrichment(asn_lookup, abuseipdb_client)

    result = enrichment.resolve("8.8.8.8")
    assert result.asn == 15169
    assert result.asn_org == "GOOGLE"
    assert result.reverse_dns == "dns.google"
    assert result.abuseipdb_score is None
