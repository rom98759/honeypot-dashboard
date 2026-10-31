from app.db import connect
from app.geoip import GeoLookup


class _FakeLocation:
    def __init__(self, latitude, longitude):
        self.latitude = latitude
        self.longitude = longitude


class _FakeCityResponse:
    def __init__(self, country, city, latitude=None, longitude=None):
        self.country = type("C", (), {"name": country, "iso_code": "US" if country else None})()
        self.city = type("C", (), {"name": city})()
        self.location = _FakeLocation(latitude, longitude)


class _StubReader:
    def __init__(self):
        self.calls = 0

    def city(self, ip):
        self.calls += 1
        if ip == "8.8.8.8":
            return _FakeCityResponse("United States", "Mountain View", 37.4056, -122.0775)
        raise ValueError("address not found in database")


def test_looks_up_and_returns_country_and_city(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    lookup = GeoLookup(db, _StubReader())

    result = lookup.lookup("8.8.8.8")
    assert result.country == "United States"
    assert result.city == "Mountain View"


def test_looks_up_and_returns_latitude_and_longitude(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    lookup = GeoLookup(db, _StubReader())

    result = lookup.lookup("8.8.8.8")
    assert result.latitude == 37.4056
    assert result.longitude == -122.0775


def test_caches_result_and_does_not_call_reader_twice(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    reader = _StubReader()
    lookup = GeoLookup(db, reader)

    lookup.lookup("8.8.8.8")
    lookup.lookup("8.8.8.8")
    assert reader.calls == 1


def test_cached_result_includes_latitude_and_longitude(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    lookup = GeoLookup(db, _StubReader())

    lookup.lookup("8.8.8.8")
    cached_result = lookup.lookup("8.8.8.8")  # second call reads geo_cache, not the reader
    assert cached_result.latitude == 37.4056
    assert cached_result.longitude == -122.0775


def test_unresolvable_ip_returns_none_fields_without_raising(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    lookup = GeoLookup(db, _StubReader())

    result = lookup.lookup("172.21.0.1")  # private IP, not in any GeoIP database
    assert result.country is None
    assert result.city is None
    assert result.latitude is None
    assert result.longitude is None


def test_missing_reader_returns_none_fields(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    lookup = GeoLookup(db, reader=None)

    result = lookup.lookup("8.8.8.8")
    assert result.country is None
    assert result.city is None
    assert result.latitude is None
    assert result.longitude is None


def test_stores_iso_country_code(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    GeoLookup(db, _StubReader()).lookup("8.8.8.8")

    row = db.execute("SELECT country_code FROM geo_cache WHERE ip = '8.8.8.8'").fetchone()
    assert row["country_code"] == "US"
