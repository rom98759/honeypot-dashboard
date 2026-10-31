import sqlite3

from app.db import connect


def test_connect_creates_all_expected_tables(tmp_path):
    db = connect(tmp_path / "test.sqlite3")

    tables = {
        row["name"]
        for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }

    assert {
        "sessions",
        "commands",
        "ttylogs",
        "geo_cache",
        "fail2ban_events",
        "sshd_auth_events",
        "ingest_offsets",
    }.issubset(tables)
    assert isinstance(db, sqlite3.Connection)
    assert db.row_factory is sqlite3.Row


def test_connect_enables_wal_mode(tmp_path):
    db = connect(tmp_path / "test.sqlite3")
    mode = db.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode.lower() == "wal"


def test_connect_adds_geo_cache_coordinate_columns(tmp_path):
    db = connect(tmp_path / "test.sqlite3")
    columns = {row["name"] for row in db.execute("PRAGMA table_info(geo_cache)").fetchall()}
    assert {"latitude", "longitude"}.issubset(columns)


def test_connect_migration_is_idempotent_on_existing_db(tmp_path):
    db_path = tmp_path / "test.sqlite3"
    connect(db_path).close()
    db = connect(db_path)  # second connect() on the same file must not raise
    columns = {row["name"] for row in db.execute("PRAGMA table_info(geo_cache)").fetchall()}
    assert {"latitude", "longitude"}.issubset(columns)


def test_connect_adds_commands_session_id_index(tmp_path):
    db = connect(tmp_path / "test.sqlite3")
    indexes = {row["name"] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'index'").fetchall()}
    assert "idx_commands_session_id" in indexes


def test_connect_adds_connect_time_and_timestamp_indexes(tmp_path):
    db = connect(tmp_path / "test.sqlite3")
    indexes = {row["name"] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'index'").fetchall()}
    assert "idx_sessions_connect_time" in indexes
    assert "idx_fail2ban_events_timestamp" in indexes


def test_ip_enrichment_table_exists(tmp_path):
    db = connect(tmp_path / "test.sqlite3")
    columns = {row["name"] for row in db.execute("PRAGMA table_info(ip_enrichment)").fetchall()}
    assert columns == {
        "ip", "asn", "asn_org", "reverse_dns",
        "abuseipdb_score", "abuseipdb_total_reports", "abuseipdb_last_reported_at",
        "status", "looked_up_at",
    }


def test_ip_enrichment_status_defaults_to_pending(tmp_path):
    db = connect(tmp_path / "test.sqlite3")
    db.execute("INSERT INTO ip_enrichment (ip) VALUES ('1.2.3.4')")
    db.commit()
    row = db.execute("SELECT status FROM ip_enrichment WHERE ip = '1.2.3.4'").fetchone()
    assert row["status"] == "pending"


def test_connect_adds_ttylogs_session_id_index(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    indexes = {row["name"] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'index'").fetchall()}
    assert "idx_ttylogs_session_id" in indexes
