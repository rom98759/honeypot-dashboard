import sqlite3

from app.periods import period_cutoff


def get_map_events(db: sqlite3.Connection, period: str) -> list[dict]:
    where_clause = ""
    params: list = []
    cutoff = period_cutoff(period)
    if cutoff is not None:
        where_clause = " AND s.connect_time >= ?"
        params.append(cutoff)

    rows = db.execute(
        "SELECT s.src_ip AS ip, g.city, g.country, g.latitude, g.longitude, s.connect_time "
        "FROM sessions s JOIN geo_cache g ON g.ip = s.src_ip "
        "WHERE g.latitude IS NOT NULL AND g.longitude IS NOT NULL" + where_clause + " "
        "ORDER BY s.connect_time",
        params,
    ).fetchall()

    return [
        {
            "ip": r["ip"],
            "city": r["city"],
            "country": r["country"],
            "latitude": r["latitude"],
            "longitude": r["longitude"],
            "connect_time": r["connect_time"],
        }
        for r in rows
    ]
