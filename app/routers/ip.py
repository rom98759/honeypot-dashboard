from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query, Request

from app.fban_control import FbanControlError

router = APIRouter()


@router.get("/api/ip/{ip}/summary")
async def get_ip_summary(request: Request, ip: str):
    db = request.app.state.db

    has_any_data = db.execute(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE src_ip = ?) "
        "OR EXISTS(SELECT 1 FROM fail2ban_events WHERE ip = ?) "
        "OR EXISTS(SELECT 1 FROM sshd_auth_events WHERE ip = ?) AS any_data",
        (ip, ip, ip),
    ).fetchone()["any_data"]
    if not has_any_data:
        raise HTTPException(status_code=404, detail="no data for this IP")

    geo = db.execute(
        "SELECT country, city, latitude, longitude FROM geo_cache WHERE ip = ?", (ip,)
    ).fetchone()

    session_stats = db.execute(
        "SELECT COUNT(*) AS total, MIN(connect_time) AS first_seen, MAX(connect_time) AS last_seen "
        "FROM sessions WHERE src_ip = ?",
        (ip,),
    ).fetchone()

    total_commands = db.execute(
        "SELECT COUNT(*) AS n FROM commands c JOIN sessions s ON s.session_id = c.session_id "
        "WHERE s.src_ip = ?",
        (ip,),
    ).fetchone()["n"]

    log_derived_banned = bool(
        db.execute(
            "SELECT EXISTS ("
            "  SELECT 1 FROM fail2ban_events f1 WHERE f1.ip = ? AND f1.action IN ('Ban', 'Restore Ban') "
            "  AND NOT EXISTS ("
            "    SELECT 1 FROM fail2ban_events f2 "
            "    WHERE f2.ip = f1.ip AND f2.action = 'Unban' AND f2.timestamp > f1.timestamp"
            "  )"
            ") AS banned",
            (ip,),
        ).fetchone()["banned"]
    )
    live_banned = request.app.state.fban_control.request_status(ip)
    currently_banned = live_banned if live_banned is not None else log_derived_banned

    return {
        "ip": ip,
        "country": geo["country"] if geo else None,
        "city": geo["city"] if geo else None,
        "latitude": geo["latitude"] if geo else None,
        "longitude": geo["longitude"] if geo else None,
        "first_seen": session_stats["first_seen"],
        "last_seen": session_stats["last_seen"],
        "total_sessions": session_stats["total"],
        "total_commands": total_commands,
        "currently_banned": currently_banned,
    }


@router.get("/api/ip/{ip}/fail2ban")
async def get_ip_fail2ban(
    request: Request, ip: str, limit: int = Query(25, ge=1, le=500), offset: int = Query(0, ge=0)
):
    db = request.app.state.db
    total = db.execute("SELECT COUNT(*) AS n FROM fail2ban_events WHERE ip = ?", (ip,)).fetchone()["n"]
    rows = db.execute(
        "SELECT action, jail, timestamp FROM fail2ban_events WHERE ip = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        (ip, limit, offset),
    ).fetchall()
    return {"items": [dict(r) for r in rows], "total": total}


@router.get("/api/ip/{ip}/sshd-auth")
async def get_ip_sshd_auth(
    request: Request, ip: str, limit: int = Query(25, ge=1, le=500), offset: int = Query(0, ge=0)
):
    db = request.app.state.db
    total = db.execute("SELECT COUNT(*) AS n FROM sshd_auth_events WHERE ip = ?", (ip,)).fetchone()["n"]
    rows = db.execute(
        "SELECT result, timestamp FROM sshd_auth_events WHERE ip = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        (ip, limit, offset),
    ).fetchall()
    return {"items": [dict(r) for r in rows], "total": total}


def _verify_dashboard_origin(request: Request) -> None:
    """
    NPM Basic Auth in front of this app is vulnerable to CSRF on write
    endpoints (browsers auto-attach cached credentials to same-origin
    requests regardless of the initiating page). Reject anything whose
    Origin/Referer doesn't match this request's own host.
    """
    header = request.headers.get("origin") or request.headers.get("referer")
    if not header:
        raise HTTPException(status_code=403, detail="missing Origin/Referer header")
    if urlparse(header).netloc != request.url.netloc:
        raise HTTPException(status_code=403, detail="cross-origin request rejected")


@router.post("/api/ip/{ip}/ban")
async def ban_ip(request: Request, ip: str):
    _verify_dashboard_origin(request)
    fban_control = request.app.state.fban_control
    try:
        fban_control.request_ban(ip)
    except FbanControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"currently_banned": fban_control.request_status(ip)}


@router.post("/api/ip/{ip}/unban")
async def unban_ip(request: Request, ip: str):
    _verify_dashboard_origin(request)
    fban_control = request.app.state.fban_control
    try:
        fban_control.request_unban(ip)
    except FbanControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"currently_banned": fban_control.request_status(ip)}
