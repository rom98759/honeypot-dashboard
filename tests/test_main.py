from app.db import connect
from app.geoip import GeoLookup
from app.main import _backfill_geo_cache


class _StubReader:
    def city(self, ip):
        if ip == "8.8.8.8":
            return type(
                "R",
                (),
                {
                    "country": type("C", (), {"name": "United States"})(),
                    "city": type("C", (), {"name": "Mountain View"})(),
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
        "INSERT INTO geo_cache (ip, country, city, looked_up_at) VALUES ('8.8.8.8', 'Cached', NULL, 't')"
    )
    db.commit()

    class _ExplodingReader:
        def city(self, ip):
            raise AssertionError("should not be called for an already-cached IP")

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
