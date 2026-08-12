import re
import sqlite3
from pathlib import Path

from app.tailer import LogTailer

FAIL2BAN_RE = re.compile(
    r"^(?P<ts>\S+ \S+)\s+fail2ban\.actions\s+\[\d+\]:\s+NOTICE\s+\[(?P<jail>\w+)\]\s+"
    r"(?P<action>Ban|Unban|Restore Ban)\s+(?P<ip>[0-9a-fA-F:.]+)\s*$"
)
IPV4_RE = re.compile(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})")


def parse_fail2ban_line(line: str) -> dict | None:
    m = FAIL2BAN_RE.match(line.strip())
    if not m:
        return None
    return {"timestamp": m["ts"], "jail": m["jail"], "action": m["action"], "ip": m["ip"]}


def parse_sshd_auth_line(line: str) -> dict | None:
    m = IPV4_RE.search(line)
    if not m:
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
    return {"timestamp": timestamp, "ip": m.group(1), "result": result}


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

    rows = []
    for r in ip_rows:
        ip = r["src_ip"]
        banned = db.execute(
            "SELECT COUNT(*) AS n FROM fail2ban_events WHERE ip = ? AND action IN ('Ban', 'Restore Ban')",
            (ip,),
        ).fetchone()["n"]
        real_ssh_hits = db.execute(
            "SELECT COUNT(*) AS n FROM sshd_auth_events WHERE ip = ?", (ip,)
        ).fetchone()["n"]
        rows.append(
            {
                "ip": ip,
                "honeypot_sessions": r["session_count"],
                "fail2ban_banned": banned > 0,
                "real_ssh_attempts": real_ssh_hits,
            }
        )
    return rows
