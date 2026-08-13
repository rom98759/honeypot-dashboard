from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/api/overview")
async def get_overview(request: Request):
    db = request.app.state.db
    stats = db.execute(
        "SELECT COUNT(*) AS total, COUNT(DISTINCT src_ip) AS unique_ips, "
        "SUM(CASE WHEN login_username IS NOT NULL THEN 1 ELSE 0 END) AS login_attempts "
        "FROM sessions"
    ).fetchone()
    total_connections = stats["total"]
    unique_ips = stats["unique_ips"]
    login_attempts = stats["login_attempts"] or 0
    currently_banned = db.execute(
        "SELECT COUNT(DISTINCT ip) AS n FROM fail2ban_events f1 "
        "WHERE action IN ('Ban', 'Restore Ban') AND NOT EXISTS ("
        "  SELECT 1 FROM fail2ban_events f2 "
        "  WHERE f2.ip = f1.ip AND f2.action = 'Unban' AND f2.timestamp > f1.timestamp"
        ")"
    ).fetchone()["n"]
    top_ips = db.execute(
        "SELECT src_ip, COUNT(*) AS n FROM sessions GROUP BY src_ip ORDER BY n DESC LIMIT 10"
    ).fetchall()
    top_countries = db.execute(
        "SELECT g.country, COUNT(*) AS n FROM sessions s "
        "JOIN geo_cache g ON g.ip = s.src_ip "
        "WHERE g.country IS NOT NULL GROUP BY g.country ORDER BY n DESC LIMIT 10"
    ).fetchall()
    timeline = db.execute(
        "SELECT substr(connect_time, 1, 13) AS hour, COUNT(*) AS n "
        "FROM sessions GROUP BY hour ORDER BY hour"
    ).fetchall()

    return {
        "total_connections": total_connections,
        "unique_ips": unique_ips,
        "login_attempts": login_attempts,
        "currently_banned": currently_banned,
        "top_ips": [dict(r) for r in top_ips],
        "top_countries": [dict(r) for r in top_countries],
        "timeline": [dict(r) for r in timeline],
    }
