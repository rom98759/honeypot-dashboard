"""
Files attackers fetched (wget/curl), wrote through a shell redirection, or uploaded
(SFTP/scp). Rows come from Cowrie's file events; the content itself stays in Cowrie's
volume under lib/cowrie/downloads/<sha256>, read on demand.
"""

import gzip
import json
import logging
import os
import re
import sqlite3
import stat
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.cowrie_parser import FileTransfer, parse_event
from app.proxied_ip import PROXIED_SOURCE_IP

log = logging.getLogger(__name__)

SHA256_RE = re.compile(r"[0-9a-f]{64}")  # always used with fullmatch: "$" would accept a trailing newline
BACKFILL_NAME = "session_files"
SORT_KEYS = {"sessions", "ips", "first_seen", "last_seen"}


def record_file_transfer(db: sqlite3.Connection, record: FileTransfer) -> None:
    # A line seen by both the startup backfill and the live tailer must count once.
    db.execute(
        "INSERT OR IGNORE INTO session_files (session_id, timestamp, kind, shasum, url, filename) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (record.session_id, record.timestamp, record.kind, record.shasum, record.url, record.filename),
    )


def _log_files(cowrie_json_path: Path) -> list[Path]:
    """Rotated logs oldest first (cowrie.json.YYYY-MM-DD sorts by date), then the live one."""
    rotated = sorted(p for p in cowrie_json_path.parent.glob(cowrie_json_path.name + ".*") if p.is_file())
    return rotated + ([cowrie_json_path] if cowrie_json_path.is_file() else [])


def backfill_session_files(db: sqlite3.Connection, cowrie_json_path: Path) -> int:
    """Once per database: import the file events of every Cowrie log still on disk, which
    the tailer read before this table existed."""
    if db.execute("SELECT 1 FROM backfills WHERE name = ?", (BACKFILL_NAME,)).fetchone():
        return 0
    started = time.monotonic()
    inserted = 0
    for path in _log_files(cowrie_json_path):
        opener = gzip.open if path.suffix == ".gz" else open
        try:
            with opener(path, "rb") as fh:
                for line in fh:
                    # Cheap pre-filter: the logs weigh GBs, file events are a few thousand lines.
                    if b"cowrie.session.file" not in line:
                        continue
                    try:
                        record = parse_event(json.loads(line))
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        continue
                    if isinstance(record, FileTransfer):
                        before = db.total_changes
                        record_file_transfer(db, record)
                        inserted += db.total_changes - before
        except OSError as exc:
            log.warning("file events backfill: skipped %s: %s", path, exc)
    db.execute(
        "INSERT INTO backfills (name, done_at) VALUES (?, ?)",
        (BACKFILL_NAME, datetime.now(timezone.utc).isoformat()),
    )
    db.commit()
    if inserted:
        log.info("file events backfill: %d rows in %.1f s", inserted, time.monotonic() - started)
    return inserted


def downloads_dir(app) -> Path:
    return Path(app.state.cowrie_var_path) / "lib" / "cowrie" / "downloads"


def stored_size(directory: Path, shasum: str) -> int | None:
    """Size of the stored copy, or None when Cowrie did not keep one."""
    base = os.path.normpath(directory)
    path = os.path.normpath(os.path.join(base, shasum))
    # Only a bare SHA-256 resolving inside the downloads directory reaches the disk.
    if not SHA256_RE.fullmatch(shasum) or not path.startswith(base + os.sep):
        return None
    try:
        st = os.lstat(path)
    except OSError:
        return None
    return st.st_size if stat.S_ISREG(st.st_mode) else None


def read_stored(directory: Path, shasum: str, max_bytes: int) -> bytes:
    """Raises FileNotFoundError (absent), PermissionError (not readable yet) or ValueError (too big)."""
    base = os.path.normpath(directory)
    path = os.path.normpath(os.path.join(base, shasum))
    if not SHA256_RE.fullmatch(shasum) or not path.startswith(base + os.sep):
        raise FileNotFoundError(shasum)
    # Cowrie's container can write this directory: never follow a link it planted.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as fh:
        st = os.fstat(fh.fileno())
        if not stat.S_ISREG(st.st_mode):
            raise FileNotFoundError(shasum)
        if st.st_size > max_bytes:
            raise ValueError(st.st_size)
        return fh.read(max_bytes + 1)


def _label(url: str, filename: str) -> str:
    return url or filename


def session_files(db: sqlite3.Connection, directory: Path, session_id: str) -> list[dict]:
    rows = db.execute(
        "SELECT timestamp, kind, shasum, url, filename FROM session_files "
        "WHERE session_id = ? ORDER BY timestamp, id",
        (session_id,),
    ).fetchall()
    files = []
    for r in rows:
        item = dict(r)
        item["size"] = stored_size(directory, r["shasum"]) if r["shasum"] else None
        files.append(item)
    return files


def _aggregate(db: sqlite3.Connection) -> list[dict]:
    rows = db.execute(
        "SELECT f.shasum, COUNT(*) AS events, COUNT(DISTINCT f.session_id) AS sessions, "
        "COUNT(DISTINCT s.src_ip) AS ips, MIN(f.timestamp) AS first_seen, MAX(f.timestamp) AS last_seen, "
        "GROUP_CONCAT(DISTINCT f.kind) AS kinds "
        "FROM session_files f LEFT JOIN sessions s ON s.session_id = f.session_id "
        "WHERE f.shasum != '' GROUP BY f.shasum"
    ).fetchall()
    # The most frequent URL or path names the file in the list.
    names: dict[str, tuple[int, str]] = {}
    for r in db.execute(
        "SELECT shasum, url, filename, COUNT(*) AS n FROM session_files WHERE shasum != '' "
        "GROUP BY shasum, url, filename"
    ):
        label = _label(r["url"], r["filename"])
        if r["shasum"] not in names or r["n"] > names[r["shasum"]][0]:
            names[r["shasum"]] = (r["n"], label)
    items = []
    for r in rows:
        item = dict(r)
        item["kinds"] = sorted((r["kinds"] or "").split(","))
        item["name"] = names.get(r["shasum"], (0, ""))[1]
        items.append(item)
    return items


def files_page(db: sqlite3.Connection, directory: Path, sort: str, limit: int, offset: int) -> dict:
    items = _aggregate(db)
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S")
    totals = {
        "files": len(items),
        "events": sum(i["events"] for i in items),
        "new_7d": sum(1 for i in items if i["first_seen"] >= week_ago),
        "failed": db.execute("SELECT COUNT(*) AS n FROM session_files WHERE kind = 'failed'").fetchone()["n"],
    }
    items.sort(key=lambda i: (i[sort], i["last_seen"]), reverse=True)
    page = items[offset : offset + limit]
    for item in page:
        item["size"] = stored_size(directory, item["shasum"])
    return {"items": page, "total": len(items), "totals": totals}


def file_detail(db: sqlite3.Connection, directory: Path, shasum: str) -> dict | None:
    if not SHA256_RE.fullmatch(shasum):
        return None
    summary = db.execute(
        "SELECT COUNT(*) AS events, COUNT(DISTINCT f.session_id) AS sessions, "
        "COUNT(DISTINCT s.src_ip) AS ips, MIN(f.timestamp) AS first_seen, MAX(f.timestamp) AS last_seen "
        "FROM session_files f LEFT JOIN sessions s ON s.session_id = f.session_id WHERE f.shasum = ?",
        (shasum,),
    ).fetchone()
    if not summary["events"]:
        return None
    sources = [
        dict(r)
        for r in db.execute(
            "SELECT kind, url, filename, COUNT(*) AS events FROM session_files WHERE shasum = ? "
            "GROUP BY kind, url, filename ORDER BY events DESC LIMIT 50",
            (shasum,),
        )
    ]
    events = [
        dict(r)
        for r in db.execute(
            "SELECT f.session_id, s.src_ip, f.timestamp, f.kind, f.url, f.filename "
            "FROM session_files f LEFT JOIN sessions s ON s.session_id = f.session_id "
            "WHERE f.shasum = ? ORDER BY f.timestamp DESC LIMIT 100",
            (shasum,),
        )
    ]
    top_ips = [
        dict(r)
        for r in db.execute(
            "SELECT s.src_ip AS ip, COUNT(DISTINCT f.session_id) AS sessions "
            "FROM session_files f JOIN sessions s ON s.session_id = f.session_id "
            "WHERE f.shasum = ? AND s.src_ip != ? GROUP BY s.src_ip ORDER BY sessions DESC LIMIT 10",
            (shasum, PROXIED_SOURCE_IP or ""),
        )
    ]
    return {
        "shasum": shasum,
        "size": stored_size(directory, shasum),
        **dict(summary),
        "kinds": [
            r["kind"]
            for r in db.execute(
                "SELECT DISTINCT kind FROM session_files WHERE shasum = ? ORDER BY kind", (shasum,)
            )
        ],
        "sources": sources,
        "recent_events": events,
        "top_ips": top_ips,
    }
