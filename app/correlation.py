import ipaddress
import re
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

# Banned now = a Ban/Restore Ban with no later Unban for that IP. Every
# "banned" figure (overview KPI, correlation, IP page fallback) uses this so
# the screens cannot disagree about the same IP.
CURRENTLY_BANNED_IPS_SQL = (
    "SELECT DISTINCT f1.ip FROM fail2ban_events f1 "
    "WHERE f1.action IN ('Ban', 'Restore Ban') AND NOT EXISTS ("
    "  SELECT 1 FROM fail2ban_events f2 "
    "  WHERE f2.ip = f1.ip AND f2.action = 'Unban' AND f2.timestamp > f1.timestamp"
    ")"
)


def currently_banned_ips(db: sqlite3.Connection) -> set[str]:
    return {r["ip"] for r in db.execute(CURRENTLY_BANNED_IPS_SQL).fetchall()}


def is_currently_banned(db: sqlite3.Connection, ip: str) -> bool:
    return (
        db.execute(
            f"SELECT EXISTS (SELECT 1 FROM ({CURRENTLY_BANNED_IPS_SQL}) WHERE ip = ?) AS banned",
            (ip,),
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
