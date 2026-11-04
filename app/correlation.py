import ipaddress
import os
import re
from datetime import datetime, timedelta, timezone
import sqlite3
from pathlib import Path

from app.tailer import LogTailer

FAIL2BAN_RE = re.compile(
    r"^(?P<ts>\S+ \S+)\s+fail2ban\.actions\s+\[\d+\]:\s+NOTICE\s+\[(?P<jail>[\w-]+)\]\s+"
    r"(?P<action>Ban|Unban|Restore Ban)\s+(?P<ip>[0-9a-fA-F:.]+)\s*$"
)
# sshd always ends the client part with "<ip> port <n>", after any username,
# so the LAST such pair is the real source: an attacker-chosen username like
# "1.2.3.4" or "x from 1.2.3.4 port 22" can only appear before it.
SOURCE_PORT_RE = re.compile(r"(\S+) port \d+")
# VERBOSE "Connection from X port A on <local ip> port B rdomain ..." ends with
# the server's own address; anchored at the end so a username cannot fake it.
LOCAL_SUFFIX_RE = re.compile(r' on \S+ port \d+(?: rdomain "[^"]*")?\s*$')

# A ban whose Unban line never reached us (log gap, fail2ban restart) would
# otherwise stay "banned" forever, so a ban also ends once its jail's bantime
# has passed. Defaults mirror scripts/fail2ban/honeypot.local.tmpl;
# FAIL2BAN_BANTIMES overrides them.
DEFAULT_BANTIMES = {
    "sshd": 7 * 86400,
    "cowrie": 86400,
    "recidive": 30 * 86400,
    "npm-badbots": 3600,
    "manual": 7 * 86400,
    "manual-all": 7 * 86400,
}
# What a ban in each jail blocks (honeypot-block action scope). "services" =
# every real service but not the honeypot, "all" = Cowrie included.
JAIL_SCOPES = {"manual-all": "all"}
DEFAULT_SCOPE = "services"
# Unknown jails get fail2ban's longest common setting rather than being dropped.
FALLBACK_BANTIME = 604800


def parse_bantimes(raw: str | None) -> dict[str, int]:
    """"sshd=86400,recidive=604800" -> {"sshd": 86400, ...}; bad entries are ignored."""
    bantimes = {}
    for item in (raw or "").split(","):
        jail, _, seconds = item.partition("=")
        if jail.strip() and seconds.strip().isdigit():
            bantimes[jail.strip()] = int(seconds.strip())
    return bantimes


BANTIMES = {**DEFAULT_BANTIMES, **parse_bantimes(os.environ.get("FAIL2BAN_BANTIMES"))}


def _fail2ban_ts(dt: datetime) -> str:
    # fail2ban timestamps are "YYYY-MM-DD HH:MM:SS,mmm" in host time (UTC on the
    # VPS), so the same layout compares correctly as text.
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _active_ban_filter(now: datetime) -> tuple[str, list]:
    """WHERE clause on fail2ban_events f1 for bans still running: a Ban/Restore Ban
    younger than its jail's bantime, with no later Unban in the same jail (each
    jail bans and unbans on its own, so a short ban ending must not end a long one)."""
    params: list = []
    for jail, seconds in BANTIMES.items():
        params += [jail, _fail2ban_ts(now - timedelta(seconds=seconds))]
    params.append(_fail2ban_ts(now - timedelta(seconds=FALLBACK_BANTIME)))
    # SQLite rejects a CASE without any WHEN.
    cases = " ".join("WHEN ? THEN ?" for _ in BANTIMES)
    jail_cutoff = f"CASE f1.jail {cases} ELSE ? END" if BANTIMES else "?"
    where = (
        "f1.action IN ('Ban', 'Restore Ban') "
        f"AND f1.timestamp > {jail_cutoff} "
        "AND NOT EXISTS ("
        "  SELECT 1 FROM fail2ban_events f2 WHERE f2.ip = f1.ip AND f2.jail = f1.jail"
        "  AND f2.action = 'Unban' AND f2.timestamp > f1.timestamp"
        ")"
    )
    return where, params


def currently_banned_query(now: datetime | None = None) -> tuple[str, list]:
    """IPs with at least one running ban. Every "banned" figure (overview KPI,
    correlation, IP page fallback) uses this so the screens cannot disagree."""
    where, params = _active_ban_filter(now or datetime.now(timezone.utc))
    return f"SELECT DISTINCT f1.ip AS ip FROM fail2ban_events f1 WHERE {where}", params


def _iso_from_fail2ban(ts: str) -> str:
    return ts.replace(" ", "T", 1).replace(",", ".", 1) + "Z"


def active_bans(db: sqlite3.Connection, ip: str, now: datetime | None = None) -> list[dict]:
    """Running bans of one IP, one per jail: when, until when, and what it blocks."""
    where, params = _active_ban_filter(now or datetime.now(timezone.utc))
    rows = db.execute(
        f"SELECT f1.jail AS jail, MAX(f1.timestamp) AS ts FROM fail2ban_events f1 "
        f"WHERE {where} AND f1.ip = ? GROUP BY f1.jail ORDER BY ts DESC",
        [*params, ip],
    ).fetchall()
    bans = []
    for r in rows:
        started = datetime.strptime(r["ts"][:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        bantime = BANTIMES.get(r["jail"], FALLBACK_BANTIME)
        bans.append({
            "jail": r["jail"],
            "banned_at": _iso_from_fail2ban(r["ts"]),
            "expires_at": (started + timedelta(seconds=bantime)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "scope": JAIL_SCOPES.get(r["jail"], DEFAULT_SCOPE),
        })
    return bans


def currently_banned_ips(db: sqlite3.Connection) -> set[str]:
    sql, params = currently_banned_query()
    return {r["ip"] for r in db.execute(sql, params).fetchall()}


def is_currently_banned(db: sqlite3.Connection, ip: str) -> bool:
    sql, params = currently_banned_query()
    return (
        db.execute(
            f"SELECT EXISTS (SELECT 1 FROM ({sql}) WHERE ip = ?) AS banned", [*params, ip]
        ).fetchone()["banned"]
        == 1
    )


def _source_ip(line: str) -> str | None:
    line = LOCAL_SUFFIX_RE.sub("", line.rstrip("\n"))
    for candidate in reversed(SOURCE_PORT_RE.findall(line)):
        try:
            ip = ipaddress.ip_address(candidate)
        except ValueError:
            continue
        # "Server listening on 0.0.0.0 port N" is not a client.
        return None if ip.is_unspecified else str(ip)
    return None


def parse_fail2ban_line(line: str) -> dict | None:
    m = FAIL2BAN_RE.match(line.strip())
    if not m:
        return None
    return {"timestamp": m["ts"], "jail": m["jail"], "action": m["action"], "ip": m["ip"]}


def parse_sshd_auth_line(line: str) -> dict | None:
    ip = _source_ip(line)
    if ip is None:
        return None
    if "Failed password" in line:
        result = "failed_password"
    elif "Accepted password" in line or "Accepted publickey" in line:
        result = "accepted"
    elif "Invalid user" in line:
        result = "invalid_user"
    else:
        result = "other"
    timestamp = line.split(" ", 1)[0]
    return {"timestamp": timestamp, "ip": ip, "result": result}


class FailbanIngester:
    def __init__(self, db: sqlite3.Connection, path: Path):
        self.db = db
        self.tailer = LogTailer(db, "fail2ban.log", path)

    def tick(self) -> int:
        applied = 0
        for line in self.tailer.read_new_lines():
            parsed = parse_fail2ban_line(line)
            if parsed:
                self.db.execute(
                    "INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES (?, ?, ?, ?)",
                    (parsed["ip"], parsed["action"], parsed["jail"], parsed["timestamp"]),
                )
                applied += 1
        self.db.commit()
        return applied


class SshdAuthIngester:
    def __init__(self, db: sqlite3.Connection, path: Path):
        self.db = db
        self.tailer = LogTailer(db, "sshd-auth.log", path)

    def tick(self) -> int:
        applied = 0
        for line in self.tailer.read_new_lines():
            parsed = parse_sshd_auth_line(line)
            if parsed:
                self.db.execute(
                    "INSERT INTO sshd_auth_events (ip, result, timestamp) VALUES (?, ?, ?)",
                    (parsed["ip"], parsed["result"], parsed["timestamp"]),
                )
                applied += 1
        self.db.commit()
        return applied


def get_correlation_rows(db: sqlite3.Connection) -> list[dict]:
    ip_rows = db.execute(
        "SELECT src_ip, COUNT(*) AS session_count FROM sessions GROUP BY src_ip "
        "ORDER BY session_count DESC"
    ).fetchall()

    banned_ips = currently_banned_ips(db)
    ssh_hits_by_ip = {
        r["ip"]: r["n"]
        for r in db.execute(
            "SELECT ip, COUNT(*) AS n FROM sshd_auth_events GROUP BY ip"
        ).fetchall()
    }

    return [
        {
            "ip": r["src_ip"],
            "honeypot_sessions": r["session_count"],
            "fail2ban_banned": r["src_ip"] in banned_ips,
            "real_ssh_attempts": ssh_hits_by_ip.get(r["src_ip"], 0),
        }
        for r in ip_rows
    ]
