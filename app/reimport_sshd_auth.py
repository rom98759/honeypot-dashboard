"""
Re-parse rotated sshd auth logs and replace the matching rows in the database.

Usage (inside the container): python -m app.reimport_sshd_auth [--dry-run] FILE...

Rows were ingested with whatever parser was current at the time; this rebuilds
them with the current one. Only the time range covered by the given files is
replaced, so rows from periods whose raw log no longer exists are kept as-is.
Files may be plain or .gz, in any order.
"""

import argparse
import gzip
import os
import sqlite3
from pathlib import Path

from app.correlation import parse_sshd_auth_line
from app.db import connect


def _read_lines(path: Path):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as f:
        yield from f


def reimport(db: sqlite3.Connection, paths: list[Path], dry_run: bool = False) -> dict:
    events = [
        parsed
        for path in paths
        for line in _read_lines(path)
        if (parsed := parse_sshd_auth_line(line))
    ]
    if not events:
        return {"from": None, "to": None, "deleted": 0, "inserted": 0}

    # ISO timestamps with a fixed +0000 offset sort lexicographically.
    start = min(e["timestamp"] for e in events)
    end = max(e["timestamp"] for e in events)
    range_clause = "FROM sshd_auth_events WHERE timestamp BETWEEN ? AND ?"
    if dry_run:
        deleted = db.execute(f"SELECT COUNT(*) AS n {range_clause}", (start, end)).fetchone()["n"]
    else:
        with db:
            deleted = db.execute(f"DELETE {range_clause}", (start, end)).rowcount
            db.executemany(
                "INSERT INTO sshd_auth_events (ip, result, timestamp) VALUES (?, ?, ?)",
                [(e["ip"], e["result"], e["timestamp"]) for e in events],
            )
    return {"from": start, "to": end, "deleted": deleted, "inserted": len(events)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    db = connect(Path(os.environ.get("DASHBOARD_DB_PATH", "/data/dashboard.sqlite3")))
    print(reimport(db, args.files, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
