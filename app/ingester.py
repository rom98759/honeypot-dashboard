import json
import sqlite3
from pathlib import Path

from app.cowrie_parser import (
    CommandInput,
    LoginAttempt,
    SessionClosed,
    SessionConnect,
    TTYLogClosed,
    parse_event,
)
from app.tailer import LogTailer


def apply_cowrie_record(db: sqlite3.Connection, record) -> None:
    if isinstance(record, SessionConnect):
        db.execute(
            "INSERT INTO sessions (session_id, src_ip, src_port, protocol, connect_time) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO NOTHING",
            (record.session_id, record.src_ip, record.src_port, record.protocol, record.timestamp),
        )
    elif isinstance(record, LoginAttempt):
        db.execute(
            "UPDATE sessions SET login_username = ?, login_password = ?, login_success = ? "
            "WHERE session_id = ?",
            (record.username, record.password, int(record.success), record.session_id),
        )
    elif isinstance(record, CommandInput):
        db.execute(
            "INSERT INTO commands (session_id, timestamp, input_text) VALUES (?, ?, ?)",
            (record.session_id, record.timestamp, record.input_text),
        )
    elif isinstance(record, TTYLogClosed):
        db.execute(
            "INSERT INTO ttylogs (session_id, ttylog_path, close_time, size, duration_ms) "
            "VALUES (?, ?, ?, ?, ?)",
            (record.session_id, record.ttylog_path, record.timestamp, record.size, record.duration_ms),
        )
    elif isinstance(record, SessionClosed):
        db.execute(
            "UPDATE sessions SET close_time = ?, duration_ms = ? WHERE session_id = ?",
            (record.timestamp, record.duration_ms, record.session_id),
        )


class CowrieIngester:
    def __init__(self, db: sqlite3.Connection, cowrie_json_path: Path):
        self.db = db
        self.tailer = LogTailer(db, "cowrie.json", cowrie_json_path)

    def tick(self) -> int:
        """Ingest all new lines since the last tick. Returns the number of events applied.

        Commits atomically, so both the ingest_offsets update and all applied session/command/ttylog
        data persist together. If a crash occurs between returning lines and this commit,
        neither the offset update nor the applied data will be persisted.
        """
        applied = 0
        for line in self.tailer.read_new_lines():
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            record = parse_event(event)
            if record is not None:
                apply_cowrie_record(self.db, record)
                applied += 1
        self.db.commit()
        return applied
