from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.ttyplayer import TTYLogError, ttylogs_to_asciicast

router = APIRouter()

SORTABLE_COLUMNS = {"src_ip", "connect_time", "duration_ms", "login_username"}


@router.get("/api/sessions")
async def list_sessions(
    request: Request,
    ip: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort: str = "connect_time",
    order: str = "desc",
):
    if sort not in SORTABLE_COLUMNS:
        raise HTTPException(status_code=400, detail=f"invalid sort column: {sort}")
    if order not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail=f"invalid order: {order}")

    db = request.app.state.db
    where_clause = " WHERE src_ip = ?" if ip else ""
    where_params: list = [ip] if ip else []

    total = db.execute(
        f"SELECT COUNT(*) AS n FROM sessions{where_clause}", where_params
    ).fetchone()["n"]

    rows = db.execute(
        f"SELECT * FROM sessions{where_clause} ORDER BY {sort} {order.upper()} LIMIT ? OFFSET ?",
        [*where_params, limit, offset],
    ).fetchall()

    return {"items": [dict(r) for r in rows], "total": total}


@router.get("/api/sessions/{session_id}")
async def get_session(request: Request, session_id: str):
    db = request.app.state.db
    session = db.execute(
        "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
    ).fetchone()
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    commands = db.execute(
        "SELECT timestamp, input_text FROM commands WHERE session_id = ? ORDER BY timestamp",
        (session_id,),
    ).fetchall()
    return {"session": dict(session), "commands": [dict(c) for c in commands]}


@router.get("/api/sessions/{session_id}/replay")
async def replay_session(request: Request, session_id: str):
    db = request.app.state.db
    ttylog_rows = db.execute(
        "SELECT ttylog_path FROM ttylogs WHERE session_id = ? ORDER BY close_time",
        (session_id,),
    ).fetchall()
    if not ttylog_rows:
        raise HTTPException(status_code=404, detail="replay unavailable for this session")

    cowrie_var = Path(request.app.state.cowrie_var_path)
    blobs = []
    for row in ttylog_rows:
        # Cowrie logs ttylog paths relative to its own root (e.g. "var/lib/cowrie/tty/..."),
        # but our mount points directly at that "var" directory, so drop the leading segment.
        ttylog_path = row["ttylog_path"]
        if ttylog_path.startswith("var/"):
            ttylog_path = ttylog_path[len("var/") :]
        try:
            blobs.append((cowrie_var / ttylog_path).read_bytes())
        except FileNotFoundError:
            continue

    try:
        cast = ttylogs_to_asciicast(blobs)
    except TTYLogError:
        raise HTTPException(status_code=404, detail="replay unavailable for this session")

    return Response(content=cast, media_type="application/x-asciicast+json")
