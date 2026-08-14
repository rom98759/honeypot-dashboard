import sqlite3

from app.periods import bucket_expr, period_cutoff


def get_overview_stats(db: sqlite3.Connection, period: str) -> dict:
    cutoff = period_cutoff(period)
    where = " AND s.connect_time >= ?" if cutoff else ""
    params = [cutoff] if cutoff else []

    stats = db.execute(
        "SELECT COUNT(*) AS total, COUNT(DISTINCT src_ip) AS unique_ips, "
        "SUM(CASE WHEN login_username IS NOT NULL THEN 1 ELSE 0 END) AS login_attempts "
        "FROM sessions s WHERE 1=1" + where,
        params,
    ).fetchone()

    currently_banned = db.execute(
        "SELECT COUNT(DISTINCT ip) AS n FROM fail2ban_events f1 "
        "WHERE action IN ('Ban', 'Restore Ban') AND NOT EXISTS ("
        "  SELECT 1 FROM fail2ban_events f2 "
        "  WHERE f2.ip = f1.ip AND f2.action = 'Unban' AND f2.timestamp > f1.timestamp"
        ")"
    ).fetchone()["n"]

    top_ips = db.execute(
        "SELECT src_ip, COUNT(*) AS n FROM sessions s WHERE 1=1" + where + " "
        "GROUP BY src_ip ORDER BY n DESC LIMIT 10",
        params,
    ).fetchall()

    top_countries = db.execute(
        "SELECT g.country, COUNT(*) AS n FROM sessions s "
        "JOIN geo_cache g ON g.ip = s.src_ip "
        "WHERE g.country IS NOT NULL" + where + " GROUP BY g.country ORDER BY n DESC LIMIT 10",
        params,
    ).fetchall()

    bucket = bucket_expr(period, "s.connect_time")
    timeline = db.execute(
        f"SELECT {bucket} AS bucket, COUNT(*) AS n FROM sessions s WHERE 1=1" + where + " "
        "GROUP BY bucket ORDER BY bucket",
        params,
    ).fetchall()

    protocol_split = db.execute(
        "SELECT COALESCE(protocol, 'ssh') AS protocol, COUNT(*) AS n FROM sessions s WHERE 1=1"
        + where + " GROUP BY COALESCE(protocol, 'ssh')",
        params,
    ).fetchall()

    top_credentials = db.execute(
        "SELECT login_username, login_password, COUNT(*) AS n FROM sessions s "
        "WHERE login_username IS NOT NULL" + where + " "
        "GROUP BY login_username, login_password ORDER BY n DESC LIMIT 10",
        params,
    ).fetchall()

    bans_bucket = bucket_expr(period, "timestamp")
    ban_where = " AND timestamp >= ?" if cutoff else ""
    ban_params = [cutoff] if cutoff else []
    bans_timeline = db.execute(
        f"SELECT {bans_bucket} AS bucket, COUNT(*) AS n FROM fail2ban_events "
        "WHERE action IN ('Ban', 'Restore Ban')" + ban_where + " "
        "GROUP BY bucket ORDER BY bucket",
        ban_params,
    ).fetchall()

    return {
        "total_connections": stats["total"],
        "unique_ips": stats["unique_ips"],
        "login_attempts": stats["login_attempts"] or 0,
        "currently_banned": currently_banned,
        "top_ips": [dict(r) for r in top_ips],
        "top_countries": [dict(r) for r in top_countries],
        "timeline": [{"bucket": r["bucket"], "n": r["n"]} for r in timeline],
        "protocol_split": [dict(r) for r in protocol_split],
        "top_credentials": [dict(r) for r in top_credentials],
        "bans_timeline": [{"bucket": r["bucket"], "n": r["n"]} for r in bans_timeline],
    }
