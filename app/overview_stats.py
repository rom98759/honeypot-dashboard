import re
import sqlite3
from datetime import datetime, timedelta, timezone

from app.commands_stats import commands_from
from app.correlation import currently_banned_query
from app.search_filter import compile_filter
from app.periods import bucket_expr, period_cutoff, period_delta

DURATION_BUCKETS = ["<10s", "10-60s", "1-5min", "5-30min", ">30min"]
FILTER_KEYS = ("country", "protocol", "ip", "username")
# A Cowrie session with no closed event yet; older ones are crashed/rotated, not live.
ACTIVE_WINDOW = timedelta(hours=1)
FAIL2BAN_TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}),(\d{3})$")


def _fail2ban_ts_to_iso(raw: str | None) -> str | None:
    """fail2ban writes host-local time with no zone; the VPS runs in UTC, so
    reading it as UTC gives the browser a timestamp it can localize."""
    if raw is None:
        return None
    m = FAIL2BAN_TS_RE.match(raw)
    return f"{m[1]}T{m[2]}.{m[3]}Z" if m else raw


def _filter_clause(filters: dict | None) -> tuple[str, list]:
    """`filters`: the search text under "filter", plus the older single-value keys."""
    filters = dict(filters or {})
    text = filters.pop("filter", None)
    sql, params, _ = compile_filter(text, **{k: v for k, v in filters.items() if v})
    return sql, params


def _totals(db: sqlite3.Connection, where: str, params: list) -> dict:
    row = db.execute(
        "SELECT COUNT(*) AS total, COUNT(DISTINCT src_ip) AS unique_ips, "
        "SUM(CASE WHEN login_username IS NOT NULL THEN 1 ELSE 0 END) AS login_attempts, "
        "AVG(duration_ms) AS avg_duration_ms "
        "FROM sessions s WHERE 1=1" + where,
        params,
    ).fetchone()
    return {
        "total_connections": row["total"],
        "unique_ips": row["unique_ips"],
        "login_attempts": row["login_attempts"] or 0,
        "avg_duration_ms": round(row["avg_duration_ms"]) if row["avg_duration_ms"] is not None else None,
    }


def get_overview_stats(db: sqlite3.Connection, period: str, filters: dict | None = None) -> dict:
    cutoff = period_cutoff(period)
    filter_where, filter_params = _filter_clause(filters)
    where = (" AND s.connect_time >= ?" if cutoff else "") + filter_where
    params = ([cutoff] if cutoff else []) + filter_params

    totals = _totals(db, where, params)

    previous = None
    if cutoff:
        prev_start = (
            datetime.strptime(cutoff, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            - period_delta(period)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        previous = _totals(
            db,
            " AND s.connect_time >= ? AND s.connect_time < ?" + filter_where,
            [prev_start, cutoff] + filter_params,
        )

    active_since = (datetime.now(timezone.utc) - ACTIVE_WINDOW).strftime("%Y-%m-%dT%H:%M:%SZ")
    active_sessions = db.execute(
        "SELECT COUNT(*) AS n FROM sessions s WHERE close_time IS NULL AND connect_time >= ?"
        + filter_where,
        [active_since] + filter_params,
    ).fetchone()["n"]

    banned_sql, banned_params = currently_banned_query()
    currently_banned = db.execute(
        f"SELECT COUNT(*) AS n FROM ({banned_sql})", banned_params
    ).fetchone()["n"]
    last_ban_at = _fail2ban_ts_to_iso(
        db.execute(
            "SELECT MAX(timestamp) AS t FROM fail2ban_events WHERE action IN ('Ban', 'Restore Ban')"
        ).fetchone()["t"]
    )

    top_offenders = db.execute(
        "SELECT s.src_ip, COUNT(*) AS n, MAX(s.connect_time) AS last_seen, g.country, g.country_code "
        "FROM sessions s LEFT JOIN geo_cache g ON g.ip = s.src_ip "
        "WHERE 1=1" + where + " "
        "GROUP BY s.src_ip ORDER BY n DESC LIMIT 10",
        params,
    ).fetchall()

    countries = [
        dict(r)
        for r in db.execute(
            "SELECT g.country, g.country_code, COUNT(*) AS n FROM sessions s "
            "JOIN geo_cache g ON g.ip = s.src_ip "
            "WHERE g.country IS NOT NULL" + where + " "
            "GROUP BY g.country, g.country_code ORDER BY n DESC, g.country",
            params,
        ).fetchall()
    ]

    bucket = bucket_expr(period, "s.connect_time")
    timeline = db.execute(
        f"SELECT {bucket} AS bucket, COUNT(*) AS n, "
        "SUM(CASE WHEN login_username IS NOT NULL THEN 1 ELSE 0 END) AS logins "
        "FROM sessions s WHERE 1=1" + where + " "
        "GROUP BY bucket ORDER BY bucket",
        params,
    ).fetchall()

    protocol_split = db.execute(
        "SELECT COALESCE(protocol, 'ssh') AS protocol, COUNT(*) AS n FROM sessions s WHERE 1=1"
        + where + " GROUP BY COALESCE(protocol, 'ssh') ORDER BY n DESC",
        params,
    ).fetchall()

    top_credentials = db.execute(
        "SELECT login_username, login_password, COUNT(*) AS n FROM sessions s "
        "WHERE login_username IS NOT NULL" + where + " "
        "GROUP BY login_username, login_password ORDER BY n DESC LIMIT 10",
        params,
    ).fetchall()

    def top_values(column: str) -> list[dict]:
        return [
            {"value": r["value"], "n": r["n"]}
            for r in db.execute(
                f"SELECT {column} AS value, COUNT(*) AS n FROM sessions s "
                f"WHERE {column} IS NOT NULL" + where + " "
                "GROUP BY value ORDER BY n DESC, value LIMIT 10",
                params,
            ).fetchall()
        ]

    top_commands = db.execute(
        f"SELECT c.input_text, COUNT(*) AS n FROM {commands_from(sessions_first=bool(where))} "
        "WHERE 1=1" + where + " "
        "GROUP BY c.input_text ORDER BY n DESC, c.input_text LIMIT 10",
        params,
    ).fetchall()

    # Denominator for the commands list: a share of the top 10 alone would overstate every row.
    total_commands = db.execute(
        f"SELECT COUNT(*) AS n FROM {commands_from(sessions_first=bool(where))} WHERE 1=1" + where,
        params,
    ).fetchone()["n"]

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
        **totals,
        "previous": previous,
        "active_sessions": active_sessions,
        "currently_banned": currently_banned,
        "last_ban_at": last_ban_at,
        "top_offenders": [dict(r) for r in top_offenders],
        "top_countries": countries[:10],
        "countries": countries,
        "timeline": [{"bucket": r["bucket"], "n": r["n"], "logins": r["logins"] or 0} for r in timeline],
        "protocol_split": [dict(r) for r in protocol_split],
        "top_credentials": [dict(r) for r in top_credentials],
        "top_usernames": top_values("login_username"),
        "top_passwords": top_values("login_password"),
        "top_commands": [dict(r) for r in top_commands],
        "total_commands": total_commands,
        "duration_distribution": duration_distribution,
        "bans_timeline": [{"bucket": r["bucket"], "n": r["n"]} for r in bans_timeline],
    }
