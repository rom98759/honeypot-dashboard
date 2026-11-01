import time

from fastapi import APIRouter, Request

router = APIRouter()
STALL_AFTER_SECONDS = 60

# (app.state ingester attribute, table, column holding the newest event time)
_SOURCES = (
    ("cowrie_ingester", "sessions", "connect_time"),
    ("fail2ban_ingester", "fail2ban_events", "timestamp"),
    ("sshd_auth_ingester", "sshd_auth_events", "timestamp"),
)


def _source_health(db, tailer, table: str, column: str) -> dict:
    """
    `lag_bytes` is what the tailer has not read yet. A file that kept the same
    path but got a new inode (rotation) counts as fully unread: that is exactly
    the state a stale bind mount or a stuck tailer leaves behind, and a quiet
    source (no new events for days) still reports 0 here, so this separates
    "nothing happened" from "we stopped reading".
    """
    row = db.execute(
        "SELECT inode, offset FROM ingest_offsets WHERE source = ?", (tailer.source_name,)
    ).fetchone()
    try:
        stat = tailer.path.stat()
    except FileNotFoundError:
        stat = None

    if stat is None:
        lag = None
    elif row is None or row["inode"] != stat.st_ino:
        lag = stat.st_size
    else:
        lag = max(stat.st_size - row["offset"], 0)

    last_event = db.execute(f"SELECT MAX({column}) AS t FROM {table}").fetchone()["t"]
    # The poll loop reads every few seconds, so unread bytes are normal right
    # after a write; only data left unread past this delay means ingestion stopped.
    stalled = stat is None or (lag > 0 and time.time() - stat.st_mtime > STALL_AFTER_SECONDS)
    return {
        "stalled": stalled,
        "source": tailer.source_name,
        "path": str(tailer.path),
        "file_present": stat is not None,
        "file_size": stat.st_size if stat else None,
        "ingested_offset": row["offset"] if row else None,
        "lag_bytes": lag,
        "last_event": last_event,
    }


@router.get("/api/health")
async def get_health(request: Request):
    state = request.app.state
    return {
        "sources": [
            _source_health(state.db, getattr(state, attr).tailer, table, column)
            for attr, table, column in _SOURCES
        ]
    }
