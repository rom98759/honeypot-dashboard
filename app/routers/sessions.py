import json
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.admin_ips import is_admin_ip
from app.campaigns_stats import campaign_of_paths
from app.correlation import is_currently_banned
from app.periods import VALID_PERIODS, period_cutoff
from app.search_filter import FilterError, compile_filter
from app.routers.campaigns import cached_aggregate
from app.session_files import downloads_dir, session_files
from app.ttyplayer import TTYLogError, ttylogs_to_asciicast

router = APIRouter()

SORTABLE_COLUMNS = {"src_ip", "connect_time", "duration_ms", "login_username"}


@router.get("/api/sessions")
async def list_sessions(
    request: Request,
    ip: str | None = None,
    command: str | None = None,
    protocol: str | None = None,
    country: str | None = None,
    period: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort: str = "connect_time",
    order: str = "desc",
    filter: str | None = None,
):
    if sort not in SORTABLE_COLUMNS:
        raise HTTPException(status_code=400, detail=f"invalid sort column: {sort}")
    if order not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail=f"invalid order: {order}")
    if period is not None and period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"invalid period: {period}")

    try:
        search_sql, search_params, _ = compile_filter(filter, ip=ip, protocol=protocol, country=country)
    except FilterError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db = request.app.state.db
    where_clauses = []
    where_params: list = []
    if command:
        # Links from the commands page name one exact command.
        where_clauses.append("session_id IN (SELECT session_id FROM commands WHERE input_text = ?)")
        where_params.append(command)
    if search_sql:
        where_clauses.append("1=1" + search_sql)
        where_params.extend(search_params)
    if period:
        cutoff = period_cutoff(period)
        if cutoff:
            where_clauses.append("connect_time >= ?")
            where_params.append(cutoff)
    if date_from:
        where_clauses.append("connect_time >= ?")
        where_params.append(date_from)
    if date_to:
        where_clauses.append("connect_time < ?")
        where_params.append(date_to)
    where_clause = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    total = db.execute(
        f"SELECT COUNT(*) AS n FROM sessions s{where_clause}", where_params
    ).fetchone()["n"]

    rows = db.execute(
        f"SELECT * FROM sessions s{where_clause} ORDER BY {sort} {order.upper()} LIMIT ? OFFSET ?",
        [*where_params, limit, offset],
    ).fetchall()

    return {"items": [dict(r) for r in rows], "total": total}


def _attachment(session_id: str, extension: str) -> dict:
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", session_id)
    return {"Content-Disposition": f'attachment; filename="session-{safe_id}.{extension}"'}


def _session_detail(request: Request, session_id: str) -> dict:
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
    ttylog_paths = [
        r["ttylog_path"]
        for r in db.execute(
            "SELECT ttylog_path FROM ttylogs WHERE session_id = ? ORDER BY close_time", (session_id,)
        )
    ]
    ip = session["src_ip"]
    geo = db.execute("SELECT country, country_code FROM geo_cache WHERE ip = ?", (ip,)).fetchone()
    enrichment = db.execute("SELECT asn, asn_org FROM ip_enrichment WHERE ip = ?", (ip,)).fetchone()
    ip_sessions = db.execute(
        "SELECT COUNT(*) AS n FROM sessions WHERE src_ip = ?", (ip,)
    ).fetchone()["n"]
    return {
        "session": dict(session),
        "commands": [dict(c) for c in commands],
        "ttylogs": ttylog_paths,
        "files": session_files(db, downloads_dir(request.app), session_id),
        "ip": {
            "ip": ip,
            "country": geo["country"] if geo else None,
            "country_code": geo["country_code"] if geo else None,
            "asn": enrichment["asn"] if enrichment else None,
            "asn_org": enrichment["asn_org"] if enrichment else None,
            "sessions": ip_sessions,
            # Log-derived only: asking the host worker would add up to FBAN_TIMEOUT_SECONDS
            # to every panel opening; the IP page shows the live state.
            "banned": is_currently_banned(db, ip),
            "protected": is_admin_ip(request.app, ip),
        },
        "campaign": campaign_of_paths(cached_aggregate(request.app), ttylog_paths) if ttylog_paths else None,
    }


@router.get("/api/sessions/{session_id}")
async def get_session(request: Request, session_id: str):
    return _session_detail(request, session_id)


@router.get("/api/sessions/{session_id}/export")
async def export_session(request: Request, session_id: str):
    detail = _session_detail(request, session_id)
    detail["exported_at"] = datetime.now(timezone.utc).isoformat()
    return Response(
        content=json.dumps(detail, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers=_attachment(session_id, "json"),
    )


@router.get("/api/sessions/{session_id}/replay")
async def replay_session(request: Request, session_id: str, download: bool = False):
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

    headers = _attachment(session_id, "cast") if download else None
    return Response(content=cast, media_type="application/x-asciicast+json", headers=headers)
