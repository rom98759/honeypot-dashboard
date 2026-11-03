import ipaddress
import os
import re
from datetime import datetime, timedelta, timezone
import sqlite3
from pathlib import Path

from app.tailer import LogTailer

FAIL2BAN_RE = re.compile(
    r"^(?P<ts>\S+ \S+)\s+fail2ban\.actions\s+\[\d+\]:\s+NOTICE\s+\[(?P<jail>\w+)\]\s+"
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
# has passed. Defaults mirror the VPS jails; FAIL2BAN_BANTIMES overrides them.
DEFAULT_BANTIMES = {"sshd": 86400, "recidive": 604800, "npm-badbots": 3600}
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


def currently_banned_query(now: datetime | None = None) -> tuple[str, list]:
    """Banned now = a Ban/Restore Ban younger than its jail's bantime with no
    later Unban for that IP. Every "banned" figure (overview KPI, correlation,
    IP page fallback) uses this so the screens cannot disagree about the same IP."""
    now = now or datetime.now(timezone.utc)

    # fail2ban timestamps are "YYYY-MM-DD HH:MM:SS,mmm" in host time (UTC on the
    # VPS), so the same layout compares correctly as text.
    def cutoff(seconds: int) -> str:
        return (now - timedelta(seconds=seconds)).strftime("%Y-%m-%d %H:%M:%S")

    params: list = []
    for jail, seconds in BANTIMES.items():
        params += [jail, cutoff(seconds)]
    params.append(cutoff(FALLBACK_BANTIME))
    # SQLite rejects a CASE without any WHEN.
    cases = " ".join("WHEN ? THEN ?" for _ in BANTIMES)
    jail_cutoff = f"CASE f1.jail {cases} ELSE ? END" if BANTIMES else "?"
    sql = (
        "SELECT DISTINCT f1.ip AS ip FROM fail2ban_events f1 "
        "WHERE f1.action IN ('Ban', 'Restore Ban') "
        f"AND f1.timestamp > {jail_cutoff} "
        "AND NOT EXISTS ("
        "  SELECT 1 FROM fail2ban_events f2 "
        "  WHERE f2.ip = f1.ip AND f2.action = 'Unban' AND f2.timestamp > f1.timestamp"
        ")"
    )
    return sql, params


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
