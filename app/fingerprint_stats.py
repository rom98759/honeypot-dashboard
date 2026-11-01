"""
Counters per ttylog fingerprint (sessions, first/last seen, sample session, IPs,
sessions per day), updated as each ttylog is ingested. Campaign families are
still derived at read time from these ~1k rows, so changing a normalization
rule never requires touching stored data.
"""

import sqlite3


def record_ttylog(db: sqlite3.Connection, session_id: str, ttylog_path: str) -> None:
    """Call before inserting the ttylog row: a line ingested twice must not count twice."""
    already = db.execute(
        "SELECT 1 FROM ttylogs WHERE session_id = ? AND ttylog_path = ?", (session_id, ttylog_path)
    ).fetchone()
    session = db.execute(
        "SELECT src_ip, connect_time FROM sessions WHERE session_id = ?", (session_id,)
    ).fetchone()
    if already or session is None:
        return
    seen = session["connect_time"]
    # SET expressions all read the pre-update row, so the sample switch compares
    # against the old last_seen.
    db.execute(
        "INSERT INTO fingerprint_stats (ttylog_path, sessions, first_seen, last_seen, sample_session_id) "
        "VALUES (?, 1, ?, ?, ?) ON CONFLICT(ttylog_path) DO UPDATE SET "
        "sessions = sessions + 1, "
        "first_seen = MIN(first_seen, excluded.first_seen), "
        "sample_session_id = CASE WHEN excluded.last_seen > last_seen "
        "  THEN excluded.sample_session_id ELSE sample_session_id END, "
        "last_seen = MAX(last_seen, excluded.last_seen)",
        (ttylog_path, seen, seen, session_id),
    )
    db.execute(
        "INSERT INTO fingerprint_ips (ttylog_path, ip, sessions) VALUES (?, ?, 1) "
        "ON CONFLICT(ttylog_path, ip) DO UPDATE SET sessions = sessions + 1",
        (ttylog_path, session["src_ip"]),
    )
    db.execute(
        "INSERT INTO fingerprint_days (ttylog_path, day, sessions) VALUES (?, ?, 1) "
        "ON CONFLICT(ttylog_path, day) DO UPDATE SET sessions = sessions + 1",
        (ttylog_path, seen[:10]),
    )


def rebuild_fingerprint_stats(db: sqlite3.Connection) -> None:
    """Recompute every counter from ttylogs and sessions (one full scan)."""
    with db:
        db.execute("DELETE FROM fingerprint_stats")
        db.execute("DELETE FROM fingerprint_ips")
        db.execute("DELETE FROM fingerprint_days")
        # SQLite returns the bare session_id from the row holding MAX(connect_time).
        db.execute(
            "INSERT INTO fingerprint_stats (ttylog_path, sessions, first_seen, last_seen, sample_session_id) "
            "SELECT t.ttylog_path, COUNT(DISTINCT t.session_id), MIN(s.connect_time), "
            "MAX(s.connect_time), t.session_id "
            "FROM ttylogs t JOIN sessions s ON s.session_id = t.session_id GROUP BY t.ttylog_path"
        )
        db.execute(
            "INSERT INTO fingerprint_ips (ttylog_path, ip, sessions) "
            "SELECT t.ttylog_path, s.src_ip, COUNT(DISTINCT t.session_id) "
            "FROM ttylogs t JOIN sessions s ON s.session_id = t.session_id GROUP BY t.ttylog_path, s.src_ip"
        )
        db.execute(
            "INSERT INTO fingerprint_days (ttylog_path, day, sessions) "
            "SELECT t.ttylog_path, substr(s.connect_time, 1, 10), COUNT(DISTINCT t.session_id) "
            "FROM ttylogs t JOIN sessions s ON s.session_id = t.session_id "
            "GROUP BY t.ttylog_path, substr(s.connect_time, 1, 10)"
        )


def ensure_fingerprint_stats(db: sqlite3.Connection) -> bool:
    """Backfill once (first start after this table appeared, or a test DB filled by hand)."""
    empty = db.execute("SELECT NOT EXISTS (SELECT 1 FROM fingerprint_stats) AS e").fetchone()["e"]
    has_ttylogs = db.execute("SELECT EXISTS (SELECT 1 FROM ttylogs) AS e").fetchone()["e"]
    if empty and has_ttylogs:
        rebuild_fingerprint_stats(db)
        return True
    return False
