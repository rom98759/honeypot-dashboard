import sqlite3

from app.periods import bucket_expr, period_cutoff

DURATION_BUCKETS = ["<10s", "10-60s", "1-5min", "5-30min", ">30min"]


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

    top_offenders = db.execute(
        "SELECT s.src_ip, COUNT(*) AS n, MAX(s.connect_time) AS last_seen, g.country "
        "FROM sessions s LEFT JOIN geo_cache g ON g.ip = s.src_ip "
        "WHERE 1=1" + where + " "
        "GROUP BY s.src_ip ORDER BY n DESC LIMIT 10",
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

    duration_rows = db.execute(
        "SELECT "
        "  CASE "
        "    WHEN duration_ms < 10000 THEN '<10s' "
        "    WHEN duration_ms < 60000 THEN '10-60s' "
        "    WHEN duration_ms < 300000 THEN '1-5min' "
        "    WHEN duration_ms < 1800000 THEN '5-30min' "
        "    ELSE '>30min' "
        "  END AS bucket, "
        "  COUNT(*) AS n "
        "FROM sessions s WHERE duration_ms IS NOT NULL" + where + " "
        "GROUP BY bucket",
        params,
    ).fetchall()
    duration_counts = {r["bucket"]: r["n"] for r in duration_rows}
    duration_distribution = [
        {"bucket": b, "n": duration_counts.get(b, 0)} for b in DURATION_BUCKETS
    ]

    bans_bucket = bucket_expr(period, "REPLACE(timestamp, ' ', 'T')")
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
        "top_offenders": [dict(r) for r in top_offenders],
        "top_countries": [dict(r) for r in top_countries],
        "timeline": [{"bucket": r["bucket"], "n": r["n"]} for r in timeline],
        "protocol_split": [dict(r) for r in protocol_split],
        "top_credentials": [dict(r) for r in top_credentials],
        "duration_distribution": duration_distribution,
        "bans_timeline": [{"bucket": r["bucket"], "n": r["n"]} for r in bans_timeline],
    }
