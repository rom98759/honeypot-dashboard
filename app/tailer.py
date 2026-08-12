import sqlite3
from pathlib import Path


class LogTailer:
    """Incrementally read new lines appended to a file, surviving rotation/truncation."""

    def __init__(self, db: sqlite3.Connection, source_name: str, path: Path):
        self.db = db
        self.source_name = source_name
        self.path = path

    def read_new_lines(self) -> list[str]:
        try:
            stat = self.path.stat()
        except FileNotFoundError:
            return []

        row = self.db.execute(
            "SELECT inode, offset FROM ingest_offsets WHERE source = ?",
            (self.source_name,),
        ).fetchone()
        inode, offset = (row["inode"], row["offset"]) if row else (0, 0)

        if stat.st_ino != inode or stat.st_size < offset:
            offset = 0  # rotated or truncated: start over from the top

        # Note: rotation detection is inode+size based and does not detect
        # copytruncate-style rotation (truncate to 0 then regrow past old offset).
        # This is an accepted limitation for this project (none of our log sources
        # use copytruncate), so we don't implement full solutions like fingerprinting.

        lines = []
        try:
            with self.path.open("r", encoding="utf-8", errors="replace") as f:
                f.seek(offset)
                while True:
                    line = f.readline()
                    if not line:
                        break
                    if line.endswith("\n"):
                        lines.append(line)
                        offset = f.tell()
                    # a partial trailing line is left for the next call
        except FileNotFoundError:
            # File was deleted/rotated between stat() and open(); leave offset untouched
            return []

        self.db.execute(
            "INSERT INTO ingest_offsets (source, inode, offset) VALUES (?, ?, ?) "
            "ON CONFLICT(source) DO UPDATE SET inode = excluded.inode, offset = excluded.offset",
            (self.source_name, stat.st_ino, offset),
        )
        self.db.commit()
        return lines
