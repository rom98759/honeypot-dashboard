import sqlite3

from app.periods import period_cutoff


def get_commands_stats(db: sqlite3.Connection, period: str, q: str, limit: int, offset: int) -> dict:
    where_clauses = []
    params: list = []
    cutoff = period_cutoff(period)
    if cutoff:
        where_clauses.append("s.connect_time >= ?")
        params.append(cutoff)
    if q:
        where_clauses.append("c.input_text LIKE ?")
        params.append(f"%{q}%")
    where = (" AND " + " AND ".join(where_clauses)) if where_clauses else ""

    total = db.execute(
        "SELECT COUNT(DISTINCT c.input_text) AS n FROM commands c "
        "JOIN sessions s ON s.session_id = c.session_id WHERE 1=1" + where,
        params,
    ).fetchone()["n"]

    rows = db.execute(
        "SELECT c.input_text, COUNT(*) AS n, MAX(c.timestamp) AS last_seen "
        "FROM commands c JOIN sessions s ON s.session_id = c.session_id "
        "WHERE 1=1" + where + " "
        "GROUP BY c.input_text ORDER BY n DESC LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()

    return {"items": [dict(r) for r in rows], "total": total}
