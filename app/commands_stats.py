import sqlite3

from app.periods import period_cutoff


def commands_from(sessions_first: bool) -> str:
    """FROM clause joining commands to sessions (aliases c and s).

    SQLite's planner prefers scanning commands through idx_commands_input_text for the GROUP BY,
    which reads every command even when only the last 24h of sessions matter. When the sessions
    side is selective (a period cutoff or a filter), CROSS JOIN pins the order so the scan starts
    from idx_sessions_connect_time instead. Over the whole history the planner's choice is faster.
    """
    if sessions_first:
        return "sessions s CROSS JOIN commands c ON c.session_id = s.session_id"
    return "commands c JOIN sessions s ON s.session_id = c.session_id"


def get_commands_stats(
    db: sqlite3.Connection,
    period: str,
    q: str,
    limit: int,
    offset: int,
    session_filter: tuple[str, list] = ("", []),
) -> dict:
    """`q` matches the command text; `session_filter` (search language, see search_filter)
    restricts which sessions count."""
    where_clauses = []
    params: list = []
    cutoff = period_cutoff(period)
    if cutoff:
        where_clauses.append("s.connect_time >= ?")
        params.append(cutoff)
    if q:
        where_clauses.append("c.input_text LIKE ?")
        params.append(f"%{q}%")
    if session_filter[0]:
        where_clauses.append("1=1" + session_filter[0])
        params.extend(session_filter[1])
    where = (" AND " + " AND ".join(where_clauses)) if where_clauses else ""
    source = commands_from(sessions_first=cutoff is not None or bool(session_filter[0]))

    total = db.execute(
        f"SELECT COUNT(DISTINCT c.input_text) AS n FROM {source} WHERE 1=1" + where,
        params,
    ).fetchone()["n"]

    rows = db.execute(
        "SELECT c.input_text, COUNT(*) AS n, MAX(c.timestamp) AS last_seen "
        f"FROM {source} "
        "WHERE 1=1" + where + " "
        "GROUP BY c.input_text ORDER BY n DESC, c.input_text ASC LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()

    return {"items": [dict(r) for r in rows], "total": total}
