from app.db import connect
from app.geoip import GeoLookup
from app.ip_enrichment import AsnLookup
from app.main import (
    _backfill_geo_cache,
    _backfill_ip_enrichment,
    _backfill_missing_asn,
    _open_asn_reader,
    create_app,
)


class _StubReader:
    def city(self, ip):
        if ip == "8.8.8.8":
            return type(
                "R",
                (),
                {
                    "country": type("C", (), {"name": "United States", "iso_code": "US"})(),
                    "city": type("C", (), {"name": "Mountain View"})(),
                    "location": type("L", (), {"latitude": 37.4056, "longitude": -122.0775})(),
                },
            )()
        raise ValueError("address not found in database")


def test_backfill_populates_geo_cache_for_existing_sessions(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '8.8.8.8', 't')")
    db.commit()
    geo_lookup = GeoLookup(db, _StubReader())

    _backfill_geo_cache(db, geo_lookup)

    row = db.execute("SELECT country FROM geo_cache WHERE ip = '8.8.8.8'").fetchone()
    assert row["country"] == "United States"


def test_backfill_skips_ips_already_in_geo_cache(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '8.8.8.8', 't')")
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('8.8.8.8', 'Cached', NULL, 37.4056, -122.0775, 't')"
    )
    db.execute(
        "UPDATE geo_cache SET country_code = 'US' WHERE ip = '8.8.8.8'"
    )
    db.commit()

    class _ExplodingReader:
        def city(self, ip):
            raise AssertionError("should not be called for an already-cached IP with coordinates")

    geo_lookup = GeoLookup(db, _ExplodingReader())

    _backfill_geo_cache(db, geo_lookup)

    row = db.execute("SELECT country FROM geo_cache WHERE ip = '8.8.8.8'").fetchone()
    assert row["country"] == "Cached"


def test_backfill_noop_when_no_reader(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '8.8.8.8', 't')")
    db.commit()
    geo_lookup = GeoLookup(db, reader=None)

    _backfill_geo_cache(db, geo_lookup)  # must not raise

    row = db.execute("SELECT * FROM geo_cache WHERE ip = '8.8.8.8'").fetchone()
    assert row is None


def test_backfill_adds_coordinates_to_already_cached_rows(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '8.8.8.8', 't')")
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('8.8.8.8', 'United States', 'Mountain View', NULL, NULL, 't')"
    )
    db.commit()
    geo_lookup = GeoLookup(db, _StubReader())

    _backfill_geo_cache(db, geo_lookup)

    row = db.execute("SELECT latitude, longitude FROM geo_cache WHERE ip = '8.8.8.8'").fetchone()
    assert row["latitude"] == 37.4056
    assert row["longitude"] == -122.0775


def test_backfill_does_not_retry_ips_that_never_resolved(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '172.21.0.1', 't')")
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('172.21.0.1', NULL, NULL, NULL, NULL, 't')"
    )
    db.commit()

    class _ExplodingReader:
        def city(self, ip):
            raise AssertionError("should not retry an IP that already failed to resolve")

    geo_lookup = GeoLookup(db, _ExplodingReader())

    _backfill_geo_cache(db, geo_lookup)  # must not raise


def test_backfill_preserves_existing_country_city_when_reader_fails_to_reresolve(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '9.9.9.9', 't')")
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('9.9.9.9', 'United States', 'Mountain View', NULL, NULL, 't')"
    )
    db.commit()

    class _NoLongerResolvableReader:
        def city(self, ip):
            raise ValueError("address not found in database")

    geo_lookup = GeoLookup(db, _NoLongerResolvableReader())

    _backfill_geo_cache(db, geo_lookup)

    row = db.execute("SELECT country, city, latitude FROM geo_cache WHERE ip = '9.9.9.9'").fetchone()
    assert row["country"] == "United States"
    assert row["city"] == "Mountain View"
    assert row["latitude"] is None


def test_backfill_ip_enrichment_enqueues_ips_with_no_row(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '8.8.8.8', 't')")
    db.commit()

    _backfill_ip_enrichment(db)

    row = db.execute("SELECT status FROM ip_enrichment WHERE ip = '8.8.8.8'").fetchone()
    assert row["status"] == "pending"


def test_backfill_ip_enrichment_skips_ips_that_already_have_a_row(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '8.8.8.8', 't')")
    db.execute("INSERT INTO ip_enrichment (ip, status, asn) VALUES ('8.8.8.8', 'done', 15169)")
    db.commit()

    _backfill_ip_enrichment(db)  # must not reset the existing done row

    row = db.execute("SELECT status, asn FROM ip_enrichment WHERE ip = '8.8.8.8'").fetchone()
    assert row["status"] == "done"
    assert row["asn"] == 15169


class _StubAsnReader:
    def asn(self, ip):
        if ip == "8.8.8.8":
            return type(
                "R",
                (),
                {"autonomous_system_number": 15169, "autonomous_system_organization": "Google LLC"},
            )()
        raise ValueError("address not found in database")


def test_backfill_missing_asn_fills_in_done_rows_with_null_asn(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO ip_enrichment (ip, status, asn, asn_org) VALUES ('8.8.8.8', 'done', NULL, NULL)"
    )
    db.commit()
    asn_lookup = AsnLookup(_StubAsnReader())

    _backfill_missing_asn(db, asn_lookup)

    row = db.execute("SELECT asn, asn_org, status FROM ip_enrichment WHERE ip = '8.8.8.8'").fetchone()
    assert row["asn"] == 15169
    assert row["asn_org"] == "Google LLC"
    assert row["status"] == "done"


def test_backfill_missing_asn_noop_when_no_reader(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO ip_enrichment (ip, status, asn, asn_org) VALUES ('8.8.8.8', 'done', NULL, NULL)"
    )
    db.commit()
    asn_lookup = AsnLookup(reader=None)

    _backfill_missing_asn(db, asn_lookup)  # must not raise

    row = db.execute("SELECT asn FROM ip_enrichment WHERE ip = '8.8.8.8'").fetchone()
    assert row["asn"] is None


def test_backfill_missing_asn_leaves_genuinely_unresolvable_ip_null(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO ip_enrichment (ip, status, asn, asn_org) VALUES ('172.21.0.1', 'done', NULL, NULL)"
    )
    db.commit()
    asn_lookup = AsnLookup(_StubAsnReader())

    _backfill_missing_asn(db, asn_lookup)  # must not raise

    row = db.execute("SELECT asn, status FROM ip_enrichment WHERE ip = '172.21.0.1'").fetchone()
    assert row["asn"] is None
    assert row["status"] == "done"


def test_open_asn_reader_missing_path_returns_none():
    assert _open_asn_reader(None) is None
    assert _open_asn_reader("/nonexistent/GeoLite2-ASN.mmdb") is None


def test_create_app_abuseipdb_disabled_by_default(tmp_path):
    app = create_app(db=connect(tmp_path / "db.sqlite3"), start_background_tasks=False)
    assert app.state.abuseipdb_configured is False


def test_create_app_abuseipdb_enabled_when_key_set(tmp_path, monkeypatch):
    monkeypatch.setenv("ABUSEIPDB_API_KEY", "fake-key")
    app = create_app(db=connect(tmp_path / "db.sqlite3"), start_background_tasks=False)
    assert app.state.abuseipdb_configured is True


def test_create_app_abuseipdb_disabled_when_key_is_empty_string(tmp_path, monkeypatch):
    monkeypatch.setenv("ABUSEIPDB_API_KEY", "")
    app = create_app(db=connect(tmp_path / "db.sqlite3"), start_background_tasks=False)
    assert app.state.abuseipdb_configured is False


def test_create_app_sets_up_enrichment_worker(tmp_path):
    app = create_app(db=connect(tmp_path / "db.sqlite3"), start_background_tasks=False)
    assert app.state.ip_enrichment is not None
    assert app.state.enrichment_worker is not None


def test_backfill_adds_missing_country_code(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('8.8.8.8', 'United States', NULL, 37.4056, -122.0775, 't')"
    )
    db.commit()

    _backfill_geo_cache(db, GeoLookup(db, _StubReader()))

    row = db.execute("SELECT country_code FROM geo_cache WHERE ip = '8.8.8.8'").fetchone()
    assert row["country_code"] == "US"
