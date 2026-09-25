import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    src_ip TEXT NOT NULL,
    src_port INTEGER,
    protocol TEXT,
    connect_time TEXT NOT NULL,
    close_time TEXT,
    duration_ms INTEGER,
    login_username TEXT,
    login_password TEXT,
    login_success INTEGER
);

CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    timestamp TEXT NOT NULL,
    input_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ttylogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    ttylog_path TEXT NOT NULL,
    close_time TEXT NOT NULL,
    size INTEGER,
    duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS geo_cache (
    ip TEXT PRIMARY KEY,
    country TEXT,
    city TEXT,
    looked_up_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fail2ban_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    action TEXT NOT NULL,
    jail TEXT NOT NULL,
    timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sshd_auth_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    result TEXT NOT NULL,
    timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_offsets (
    source TEXT PRIMARY KEY,
    inode INTEGER NOT NULL,
    offset INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_src_ip ON sessions(src_ip);
CREATE INDEX IF NOT EXISTS idx_sessions_connect_time ON sessions(connect_time);
CREATE INDEX IF NOT EXISTS idx_fail2ban_events_ip_timestamp ON fail2ban_events(ip, timestamp);
CREATE INDEX IF NOT EXISTS idx_fail2ban_events_timestamp ON fail2ban_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_sshd_auth_events_ip ON sshd_auth_events(ip);
CREATE INDEX IF NOT EXISTS idx_commands_session_id ON commands(session_id);
CREATE INDEX IF NOT EXISTS idx_commands_input_text ON commands(input_text);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript(SCHEMA)
    _migrate_geo_cache_coordinates(conn)
    conn.commit()
    return conn


def _migrate_geo_cache_coordinates(conn: sqlite3.Connection) -> None:
    """
    SQLite has no ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so check first. Runs
    on every connect() call — idempotent, and a PRAGMA plus at most two ALTER
    statements is cheap next to the 5s ingestion polling this app already does.
    """
    existing_columns = {row["name"] for row in conn.execute("PRAGMA table_info(geo_cache)").fetchall()}
    if "latitude" not in existing_columns:
        conn.execute("ALTER TABLE geo_cache ADD COLUMN latitude REAL")
    if "longitude" not in existing_columns:
        conn.execute("ALTER TABLE geo_cache ADD COLUMN longitude REAL")
