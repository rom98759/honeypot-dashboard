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
