from app.db import connect
from app.geoip import GeoLookup


class _FakeCityResponse:
    def __init__(self, country, city):
        self.country = type("C", (), {"name": country})()
        self.city = type("C", (), {"name": city})()


class _StubReader:
    def __init__(self):
        self.calls = 0

    def city(self, ip):
        self.calls += 1
        if ip == "8.8.8.8":
            return _FakeCityResponse("United States", "Mountain View")
        raise ValueError("address not found in database")


def test_looks_up_and_returns_country_and_city(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    lookup = GeoLookup(db, _StubReader())

    result = lookup.lookup("8.8.8.8")
    assert result.country == "United States"
    assert result.city == "Mountain View"


def test_caches_result_and_does_not_call_reader_twice(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    reader = _StubReader()
    lookup = GeoLookup(db, reader)

    lookup.lookup("8.8.8.8")
    lookup.lookup("8.8.8.8")
    assert reader.calls == 1


def test_unresolvable_ip_returns_none_fields_without_raising(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    lookup = GeoLookup(db, _StubReader())

    result = lookup.lookup("172.21.0.1")  # private IP, not in any GeoIP database
    assert result.country is None
    assert result.city is None


def test_missing_reader_returns_none_fields(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    lookup = GeoLookup(db, reader=None)

    result = lookup.lookup("8.8.8.8")
    assert result.country is None
    assert result.city is None
