import sqlite3


def get_heatmap_stats(db: sqlite3.Connection) -> list[dict]:
    rows = db.execute(
        "SELECT CAST(strftime('%w', connect_time) AS INTEGER) AS day_of_week, "
        "CAST(strftime('%H', connect_time) AS INTEGER) AS hour, COUNT(*) AS n "
        "FROM sessions GROUP BY day_of_week, hour"
    ).fetchall()
    return [dict(r) for r in rows]
