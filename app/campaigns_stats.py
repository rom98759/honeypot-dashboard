"""
Campaigns: sessions grouped into families of identical behaviour.

Cowrie names each ttylog after the SHA-256 of its content, so sessions whose
terminal exchange was byte-for-byte identical share one file. That is too
strict on its own: the same bot gets a new file whenever its output differs or
it stamps a random marker into a command. Fingerprints are therefore merged
into a family when their normalized command sequence matches
(`command_normalize.family_key`); a fingerprint with no command stays alone.
"""

import ipaddress
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from app.command_normalize import family_key, normalize_sequence

CAMPAIGN_ID_RE = re.compile(r"^[0-9a-f]{64}$")
# Most families hold a single session: a one-off exchange (often a human),
# not a campaign. They are counted apart instead of flooding the list.
MIN_CAMPAIGN_SESSIONS = 2
ACTIVITY_DAYS = 30
NEW_WINDOW = timedelta(days=7)
MAX_VARIANTS_LISTED = 20
# A run cut short (timeout, dropped connection) repeats the start of its script.
# Below 3 commands a shared start says too little: "uname" alone opens many scripts.
MIN_SHARED_PREFIX = 3
SORT_KEYS = {
    "sessions": lambda c: c["sessions"],
    "ips": lambda c: c["ips"],
    "last_seen": lambda c: c["last_seen"],
    "first_seen": lambda c: c["first_seen"],
}
_SQL_VARS_PER_QUERY = 900


def _fingerprint(ttylog_path: str) -> str:
    return ttylog_path.rsplit("/", 1)[-1]


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def _chunks(items: list, size: int = _SQL_VARS_PER_QUERY):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _commands_by_session(db: sqlite3.Connection, session_ids: list[str]) -> dict[str, list[str]]:
    commands: dict[str, list[str]] = defaultdict(list)
    for chunk in _chunks(session_ids):
        placeholders = ",".join("?" * len(chunk))
        for r in db.execute(
            f"SELECT session_id, input_text FROM commands WHERE session_id IN ({placeholders}) "
            "ORDER BY session_id, id",
            chunk,
        ):
            commands[r["session_id"]].append(r["input_text"])
    return commands


def _absorb(target: dict, family: dict) -> None:
    target["paths"] += family["paths"]
    target["variant_sessions"].update(family["variant_sessions"])
    target["ip_set"] |= family["ip_set"]
    target["sessions"] += family["sessions"]
    target["first_seen"] = min(target["first_seen"], family["first_seen"])
    if family["last_seen"] > target["last_seen"]:
        target["last_seen"] = family["last_seen"]
        target["sample_session_id"] = family["sample_session_id"]


def _merge_truncated_runs(families: dict[str, dict]) -> None:
    """Fold a family whose sequence is the start of a longer one into it. Longest
    sequences go first, so every candidate is still a root when a shorter one is
    placed; a start shared by several scripts goes to the busiest."""
    extended_by: dict[tuple, list[dict]] = defaultdict(list)
    for family in sorted(families.values(), key=lambda f: (-len(f["seq"]), -f["sessions"], f["id"])):
        seq = family["seq"]
        candidates = extended_by.get(seq) if len(seq) >= MIN_SHARED_PREFIX else None
        if candidates:
            _absorb(max(candidates, key=lambda f: f["sessions"]), family)
            del families[family["id"]]
            continue
        for length in range(MIN_SHARED_PREFIX, len(seq)):
            extended_by[seq[:length]].append(family)


def compute_campaigns(db: sqlite3.Connection) -> dict:
    """The full aggregate, meant to be cached: grouping every ttylog is the expensive part,
    sorting and paging the resulting families is not."""
    # SQLite returns bare columns (session_id) from the row holding MAX(), so this
    # picks each fingerprint's most recent session as its sample.
    rows = db.execute(
        "SELECT t.ttylog_path, COUNT(DISTINCT t.session_id) AS sessions, "
        "MIN(s.connect_time) AS first_seen, MAX(s.connect_time) AS last_seen, "
        "t.session_id AS sample_session_id "
        "FROM ttylogs t JOIN sessions s ON s.session_id = t.session_id "
        "GROUP BY t.ttylog_path"
    ).fetchall()
    ips_by_path: dict[str, set] = defaultdict(set)
    for r in db.execute(
        "SELECT DISTINCT t.ttylog_path, s.src_ip FROM ttylogs t JOIN sessions s ON s.session_id = t.session_id"
    ):
        ips_by_path[r["ttylog_path"]].add(r["src_ip"])
    commands = _commands_by_session(db, [r["sample_session_id"] for r in rows])

    families: dict[str, dict] = {}
    for r in rows:
        path = r["ttylog_path"]
        sample_commands = commands.get(r["sample_session_id"], [])
        fid = family_key(sample_commands) or _fingerprint(path)
        family = families.setdefault(
            fid,
            {"id": fid, "seq": normalize_sequence(sample_commands),
             "paths": [], "variant_sessions": {}, "ip_set": set(), "sessions": 0,
             "first_seen": r["first_seen"], "last_seen": "", "sample_session_id": None,
             "sample_command": sample_commands[0] if sample_commands else None},
        )
        family["paths"].append(path)
        family["variant_sessions"][_fingerprint(path)] = r["sessions"]
        family["ip_set"] |= ips_by_path[path]
        family["sessions"] += r["sessions"]
        family["first_seen"] = min(family["first_seen"], r["first_seen"])
        if r["last_seen"] > family["last_seen"]:
            family["last_seen"] = r["last_seen"]
            family["sample_session_id"] = r["sample_session_id"]

    _merge_truncated_runs(families)
    total_sessions = db.execute("SELECT COUNT(*) AS n FROM sessions").fetchone()["n"]
    for family in families.values():
        del family["seq"]
        family["ips"] = len(family.pop("ip_set"))
        family["share"] = family["sessions"] / total_sessions if total_sessions else 0

    campaigns = [f for f in families.values() if f["sessions"] >= MIN_CAMPAIGN_SESSIONS]
    unique = [f for f in families.values() if f["sessions"] < MIN_CAMPAIGN_SESSIONS]
    login_only = db.execute(
        "SELECT COUNT(*) AS sessions, COUNT(DISTINCT src_ip) AS ips FROM sessions s "
        "WHERE NOT EXISTS (SELECT 1 FROM ttylogs t WHERE t.session_id = s.session_id)"
    ).fetchone()
    new_cutoff = _iso(datetime.now(timezone.utc) - NEW_WINDOW)
    return {
        "families": families,
        "campaigns": campaigns,
        "unique_session_ids": sorted({f["sample_session_id"] for f in unique}),
        "totals": {
            "campaigns": len(campaigns),
            "sessions": total_sessions,
            "new_7d": sum(c["first_seen"] >= new_cutoff for c in campaigns),
            "unique_sessions": sum(f["sessions"] for f in unique),
            "top_share": max((c["share"] for c in campaigns), default=0),
            "login_only": {"sessions": login_only["sessions"], "ips": login_only["ips"]},
        },
    }


def _daily_activity(db: sqlite3.Connection, families: list[dict]) -> dict[str, list[int]]:
    today = datetime.now(timezone.utc).date()
    days = [(today - timedelta(days=i)).isoformat() for i in range(ACTIVITY_DAYS - 1, -1, -1)]
    family_of = {path: f["id"] for f in families for path in f["paths"]}
    activity = {f["id"]: dict.fromkeys(days, 0) for f in families}
    for chunk in _chunks(list(family_of)):
        placeholders = ",".join("?" * len(chunk))
        for r in db.execute(
            "SELECT t.ttylog_path, substr(s.connect_time, 1, 10) AS day, COUNT(DISTINCT t.session_id) AS n "
            "FROM ttylogs t JOIN sessions s ON s.session_id = t.session_id "
            f"WHERE t.ttylog_path IN ({placeholders}) AND s.connect_time >= ? "
            "GROUP BY t.ttylog_path, day",
            [*chunk, days[0]],
        ):
            counts = activity[family_of[r["ttylog_path"]]]
            if r["day"] in counts:
                counts[r["day"]] += r["n"]
    return {fid: list(counts.values()) for fid, counts in activity.items()}


def _public(family: dict) -> dict:
    return {
        "id": family["id"],
        "sessions": family["sessions"],
        "ips": family["ips"],
        "share": family["share"],
        "first_seen": family["first_seen"],
        "last_seen": family["last_seen"],
        "sample_session_id": family["sample_session_id"],
        "sample_command": family["sample_command"],
        "variants": len(family["paths"]),
    }


def campaign_page(db: sqlite3.Connection, aggregate: dict, sort: str, limit: int, offset: int) -> dict:
    ordered = sorted(aggregate["campaigns"], key=SORT_KEYS[sort], reverse=True)
    page = ordered[offset : offset + limit]
    activity = _daily_activity(db, page)
    items = [{**_public(f), "activity": activity[f["id"]]} for f in page]
    return {"items": items, "total": len(ordered), "totals": aggregate["totals"]}


UNIQUE_SORT_KEYS = {
    # Most commands first: a long one-off exchange is the likeliest human at the keyboard.
    "commands": lambda s: (s["commands"], s["connect_time"]),
    "connect_time": lambda s: s["connect_time"],
    "duration": lambda s: s["duration_ms"] or 0,
}


def unique_sessions(db: sqlite3.Connection, session_ids: list[str]) -> list[dict]:
    sessions = []
    for chunk in _chunks(session_ids):
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


def campaign_detail(db: sqlite3.Connection, aggregate: dict, campaign_id: str) -> dict | None:
    if not CAMPAIGN_ID_RE.match(campaign_id):
        return None
    family = aggregate["families"].get(campaign_id)
    if family is None:
        return None

    sessions_by_ip: Counter = Counter()
    asn_of: dict = {}
    for chunk in _chunks(family["paths"]):
        placeholders = ",".join("?" * len(chunk))
        for r in db.execute(
            "SELECT s.src_ip AS ip, COUNT(DISTINCT t.session_id) AS sessions, e.asn, e.asn_org "
            "FROM ttylogs t JOIN sessions s ON s.session_id = t.session_id "
            "LEFT JOIN ip_enrichment e ON e.ip = s.src_ip "
            f"WHERE t.ttylog_path IN ({placeholders}) GROUP BY s.src_ip",
            chunk,
        ):
            sessions_by_ip[r["ip"]] += r["sessions"]
            asn_of[r["ip"]] = (r["asn"], r["asn_org"])
    total = family["sessions"]

    by_asn: Counter = Counter()
    asn_org: dict = {}
    by_prefix: Counter = Counter()
    for ip, n in sessions_by_ip.items():
        asn, org = asn_of[ip]
        if asn is not None:
            by_asn[asn] += n
            asn_org[asn] = org
        prefix = _prefix24(ip)
        if prefix:
            by_prefix[prefix] += n
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
        (family["sample_session_id"],),
    ).fetchall()
    top_ips = sorted(sessions_by_ip.items(), key=lambda item: (-item[1], item[0]))[:10]
    variants = sorted(family["variant_sessions"].items(), key=lambda item: -item[1])
    return {
        **_public(family),
        "top_asn": top_asn,
        "top_prefix": top_prefix,
        "top_ips": [{"ip": ip, "sessions": n} for ip, n in top_ips],
        "commands": [dict(c) for c in commands],
        "variant_count": len(variants),
        "variants": [{"id": v, "sessions": n} for v, n in variants[:MAX_VARIANTS_LISTED]],
    }
