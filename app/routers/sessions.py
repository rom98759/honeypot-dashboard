from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response

from app.ttyplayer import TTYLogError, ttylogs_to_asciicast

router = APIRouter()


@router.get("/api/sessions")
async def list_sessions(request: Request, ip: str | None = None, limit: int = 100):
    db = request.app.state.db
    query = "SELECT * FROM sessions"
    params: list = []
    if ip:
        query += " WHERE src_ip = ?"
        params.append(ip)
    query += " ORDER BY connect_time DESC LIMIT ?"
    params.append(limit)
    rows = db.execute(query, params).fetchall()
    return [dict(r) for r in rows]


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
