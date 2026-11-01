"""
Campaigns: sessions grouped by their Cowrie ttylog file. Cowrie names each
ttylog after the SHA-256 of its content, so sessions whose terminal exchange
was byte-for-byte identical share one file, which makes the file name a free
behavioural fingerprint.
"""

import ipaddress
import re
import sqlite3
from collections import Counter
from datetime import datetime, timedelta, timezone

TTYLOG_DIR = "var/lib/cowrie/tty/"
CAMPAIGN_ID_RE = re.compile(r"^[0-9a-f]{64}$")
# ~80 % of fingerprints hold a single session: a one-off exchange (often a human),
# not a campaign. They are counted apart instead of flooding the list.
MIN_CAMPAIGN_SESSIONS = 2
ACTIVITY_DAYS = 30
NEW_WINDOW = timedelta(days=7)
SORT_KEYS = {
    "sessions": lambda c: c["sessions"],
    "ips": lambda c: c["ips"],
    "last_seen": lambda c: c["last_seen"],
    "first_seen": lambda c: c["first_seen"],
}


def _campaign_id(ttylog_path: str) -> str:
    return ttylog_path.rsplit("/", 1)[-1]


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def compute_campaigns(db: sqlite3.Connection) -> dict:
    """The full aggregate, meant to be cached: grouping every ttylog is the expensive part,
    sorting and paging the ~1k resulting rows is not."""
    # SQLite returns bare columns (session_id) from the row holding MAX(), so this
    # picks each campaign's most recent session as its sample.
    rows = db.execute(
        "SELECT t.ttylog_path, COUNT(DISTINCT t.session_id) AS sessions, "
        "COUNT(DISTINCT s.src_ip) AS ips, MIN(s.connect_time) AS first_seen, "
        "MAX(s.connect_time) AS last_seen, t.session_id AS sample_session_id "
        "FROM ttylogs t JOIN sessions s ON s.session_id = t.session_id "
        "GROUP BY t.ttylog_path"
    ).fetchall()
    total_sessions = db.execute("SELECT COUNT(*) AS n FROM sessions").fetchone()["n"]
    login_only = db.execute(
        "SELECT COUNT(*) AS sessions, COUNT(DISTINCT src_ip) AS ips FROM sessions s "
        "WHERE NOT EXISTS (SELECT 1 FROM ttylogs t WHERE t.session_id = s.session_id)"
    ).fetchone()
    new_cutoff = _iso(datetime.now(timezone.utc) - NEW_WINDOW)

    campaigns = [
        {
            "id": _campaign_id(r["ttylog_path"]),
            "path": r["ttylog_path"],
            "sessions": r["sessions"],
            "ips": r["ips"],
            "share": r["sessions"] / total_sessions if total_sessions else 0,
            "first_seen": r["first_seen"],
            "last_seen": r["last_seen"],
            "sample_session_id": r["sample_session_id"],
        }
        for r in rows
        if r["sessions"] >= MIN_CAMPAIGN_SESSIONS
    ]
    return {
        "campaigns": campaigns,
        "unique_session_ids": sorted(
            {r["sample_session_id"] for r in rows if r["sessions"] < MIN_CAMPAIGN_SESSIONS}
        ),
        "totals": {
            "campaigns": len(campaigns),
            "sessions": total_sessions,
            "new_7d": sum(c["first_seen"] >= new_cutoff for c in campaigns),
            "unique_sessions": sum(r["sessions"] for r in rows if r["sessions"] < MIN_CAMPAIGN_SESSIONS),
            "top_share": max((c["share"] for c in campaigns), default=0),
            "login_only": {"sessions": login_only["sessions"], "ips": login_only["ips"]},
        },
    }


def _daily_activity(db: sqlite3.Connection, paths: list[str]) -> dict[str, list[int]]:
    today = datetime.now(timezone.utc).date()
    days = [(today - timedelta(days=i)).isoformat() for i in range(ACTIVITY_DAYS - 1, -1, -1)]
    activity = {p: dict.fromkeys(days, 0) for p in paths}
    if paths:
        placeholders = ",".join("?" * len(paths))
        for r in db.execute(
            "SELECT t.ttylog_path, substr(s.connect_time, 1, 10) AS day, COUNT(DISTINCT t.session_id) AS n "
            "FROM ttylogs t JOIN sessions s ON s.session_id = t.session_id "
            f"WHERE t.ttylog_path IN ({placeholders}) AND s.connect_time >= ? "
            "GROUP BY t.ttylog_path, day",
            [*paths, days[0]],
        ):
            if r["day"] in activity[r["ttylog_path"]]:
                activity[r["ttylog_path"]][r["day"]] = r["n"]
    return {p: list(counts.values()) for p, counts in activity.items()}


def _first_command(db: sqlite3.Connection, session_id: str) -> str | None:
    row = db.execute(
        "SELECT input_text FROM commands WHERE session_id = ? ORDER BY id LIMIT 1", (session_id,)
    ).fetchone()
    return row["input_text"] if row else None


def campaign_page(db: sqlite3.Connection, aggregate: dict, sort: str, limit: int, offset: int) -> dict:
    ordered = sorted(aggregate["campaigns"], key=SORT_KEYS[sort], reverse=True)
    page = ordered[offset : offset + limit]
    activity = _daily_activity(db, [c["path"] for c in page])
    items = [
        {
            **{k: v for k, v in c.items() if k != "path"},
            "sample_command": _first_command(db, c["sample_session_id"]),
            "activity": activity[c["path"]],
        }
        for c in page
    ]
    return {"items": items, "total": len(ordered), "totals": aggregate["totals"]}


UNIQUE_SORT_KEYS = {
    # Most commands first: a long one-off exchange is the likeliest human at the keyboard.
    "commands": lambda s: (s["commands"], s["connect_time"]),
    "connect_time": lambda s: s["connect_time"],
    "duration": lambda s: s["duration_ms"] or 0,
}
_SQL_VARS_PER_QUERY = 900


def unique_sessions(db: sqlite3.Connection, session_ids: list[str]) -> list[dict]:
    sessions = []
    for start in range(0, len(session_ids), _SQL_VARS_PER_QUERY):
        chunk = session_ids[start : start + _SQL_VARS_PER_QUERY]
        placeholders = ",".join("?" * len(chunk))
        sessions += [
            dict(r)
            for r in db.execute(
                "SELECT s.session_id, s.src_ip, s.connect_time, s.duration_ms, "
                "(SELECT COUNT(*) FROM commands c WHERE c.session_id = s.session_id) AS commands, "
                "(SELECT input_text FROM commands c WHERE c.session_id = s.session_id "
                " ORDER BY c.id LIMIT 1) AS first_command "
                f"FROM sessions s WHERE s.session_id IN ({placeholders})",
                chunk,
            )
        ]
    return sessions


def unique_sessions_page(sessions: list[dict], sort: str, limit: int, offset: int) -> dict:
    ordered = sorted(sessions, key=UNIQUE_SORT_KEYS[sort], reverse=True)
    return {"items": ordered[offset : offset + limit], "total": len(ordered)}


def _prefix24(ip: str) -> str | None:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if addr.version != 4:
        return None
    return str(ipaddress.ip_network(f"{ip}/24", strict=False))


def campaign_detail(db: sqlite3.Connection, campaign_id: str) -> dict | None:
    if not CAMPAIGN_ID_RE.match(campaign_id):
        return None
    path = TTYLOG_DIR + campaign_id
    base = db.execute(
        "SELECT COUNT(DISTINCT t.session_id) AS sessions, COUNT(DISTINCT s.src_ip) AS ips, "
        "MIN(s.connect_time) AS first_seen, MAX(s.connect_time) AS last_seen, "
        "t.session_id AS sample_session_id "
        "FROM ttylogs t JOIN sessions s ON s.session_id = t.session_id WHERE t.ttylog_path = ?",
        (path,),
    ).fetchone()
    if not base["sessions"]:
        return None

    per_ip = db.execute(
        "SELECT s.src_ip AS ip, COUNT(DISTINCT t.session_id) AS sessions, e.asn, e.asn_org "
        "FROM ttylogs t JOIN sessions s ON s.session_id = t.session_id "
        "LEFT JOIN ip_enrichment e ON e.ip = s.src_ip "
        "WHERE t.ttylog_path = ? GROUP BY s.src_ip ORDER BY sessions DESC, s.src_ip",
        (path,),
    ).fetchall()
    total = base["sessions"]

    by_asn: Counter = Counter()
    asn_org: dict = {}
    by_prefix: Counter = Counter()
    for r in per_ip:
        if r["asn"] is not None:
            by_asn[r["asn"]] += r["sessions"]
            asn_org[r["asn"]] = r["asn_org"]
        prefix = _prefix24(r["ip"])
        if prefix:
            by_prefix[prefix] += r["sessions"]
    top_asn = None
    if by_asn:
        asn, n = by_asn.most_common(1)[0]
        top_asn = {"asn": asn, "asn_org": asn_org[asn], "share": n / total}
    top_prefix = None
    if by_prefix:
        prefix, n = by_prefix.most_common(1)[0]
        top_prefix = {"prefix": prefix, "share": n / total}

    commands = db.execute(
        "SELECT timestamp, input_text FROM commands WHERE session_id = ? ORDER BY id",
        (base["sample_session_id"],),
    ).fetchall()
    return {
        "id": campaign_id,
        "sessions": total,
        "ips": base["ips"],
        "first_seen": base["first_seen"],
        "last_seen": base["last_seen"],
        "sample_session_id": base["sample_session_id"],
        "top_asn": top_asn,
        "top_prefix": top_prefix,
        "top_ips": [{"ip": r["ip"], "sessions": r["sessions"]} for r in per_ip[:10]],
        "commands": [dict(c) for c in commands],
    }
