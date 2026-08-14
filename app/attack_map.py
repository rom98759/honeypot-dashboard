import sqlite3
from datetime import datetime, timedelta, timezone

VALID_PERIODS = {"24h", "7d", "30d", "all"}

_PERIOD_DELTAS = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


def get_map_points(db: sqlite3.Connection, period: str) -> list[dict]:
    where_clause = ""
    params: list = []
    if period != "all":
        cutoff = (datetime.now(timezone.utc) - _PERIOD_DELTAS[period]).strftime("%Y-%m-%dT%H:%M:%SZ")
        where_clause = " AND s.connect_time >= ?"
        params.append(cutoff)

    rows = db.execute(
        "SELECT MIN(g.city) AS city, MIN(g.country) AS country, g.latitude, g.longitude, "
        "COUNT(*) AS session_count, GROUP_CONCAT(DISTINCT s.src_ip) AS ips_csv "
        "FROM sessions s JOIN geo_cache g ON g.ip = s.src_ip "
        "WHERE g.latitude IS NOT NULL AND g.longitude IS NOT NULL" + where_clause + " "
        "GROUP BY g.latitude, g.longitude ORDER BY session_count DESC",
        params,
    ).fetchall()

    return [
        {
            "city": r["city"],
            "country": r["country"],
            "latitude": r["latitude"],
            "longitude": r["longitude"],
            "session_count": r["session_count"],
            "ips": r["ips_csv"].split(","),
        }
        for r in rows
    ]
