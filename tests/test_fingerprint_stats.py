from app.cowrie_parser import SessionConnect, TTYLogClosed
from app.db import connect
from app.fingerprint_stats import ensure_fingerprint_stats, rebuild_fingerprint_stats
from app.ingester import apply_cowrie_record

PATH = "var/lib/cowrie/tty/" + "a" * 64


def _connect(db, sid, ip, ts):
    apply_cowrie_record(db, SessionConnect(session_id=sid, src_ip=ip, src_port=1, protocol="ssh", timestamp=ts))


def _ttylog(db, sid, path=PATH):
    apply_cowrie_record(
        db, TTYLogClosed(session_id=sid, ttylog_path=path, size=1, duration_ms=1, timestamp="t")
    )


def _snapshot(db):
    return (
        [tuple(r) for r in db.execute("SELECT * FROM fingerprint_stats ORDER BY ttylog_path")],
        [tuple(r) for r in db.execute("SELECT * FROM fingerprint_ips ORDER BY ttylog_path, ip")],
        [tuple(r) for r in db.execute("SELECT * FROM fingerprint_days ORDER BY ttylog_path, day")],
    )


def test_ingesting_ttylogs_maintains_counters(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _connect(db, "s1", "1.1.1.1", "2026-10-30T10:00:00Z")
    _connect(db, "s2", "1.1.1.1", "2026-10-31T09:00:00Z")
    _connect(db, "s3", "2.2.2.2", "2026-10-29T08:00:00Z")
    for sid in ("s1", "s2", "s3"):
        _ttylog(db, sid)
    _ttylog(db, "s2")  # the same ttylog line ingested twice must not count twice

    stats, ips, days = _snapshot(db)
    assert stats == [(PATH, 3, "2026-10-29T08:00:00Z", "2026-10-31T09:00:00Z", "s2")]
    assert ips == [(PATH, "1.1.1.1", 2), (PATH, "2.2.2.2", 1)]
    assert days == [(PATH, "2026-10-29", 1), (PATH, "2026-10-30", 1), (PATH, "2026-10-31", 1)]


def test_rebuild_matches_incremental_counters(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _connect(db, "s1", "1.1.1.1", "2026-10-30T10:00:00Z")
    _connect(db, "s2", "2.2.2.2", "2026-10-31T09:00:00Z")
    _ttylog(db, "s1")
    _ttylog(db, "s2")
    _ttylog(db, "s2", path=PATH.replace("a", "b"))
    incremental = _snapshot(db)

    rebuild_fingerprint_stats(db)

    assert _snapshot(db) == incremental


def test_ensure_backfills_only_when_counters_are_empty(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.1.1.1', '2026-10-30T10:00:00Z')")
    db.execute(f"INSERT INTO ttylogs (session_id, ttylog_path, close_time) VALUES ('s1', '{PATH}', 't')")
    db.commit()

    assert ensure_fingerprint_stats(db) is True
    assert _snapshot(db)[0] == [(PATH, 1, "2026-10-30T10:00:00Z", "2026-10-30T10:00:00Z", "s1")]
    assert ensure_fingerprint_stats(db) is False
