from fastapi import APIRouter, HTTPException, Request

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

    currently_banned = bool(
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
