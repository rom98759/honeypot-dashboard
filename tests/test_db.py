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
