import shutil
from pathlib import Path

from app.correlation import (
    FailbanIngester,
    SshdAuthIngester,
    get_correlation_rows,
    parse_fail2ban_line,
    parse_sshd_auth_line,
)
from app.db import connect

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_fail2ban_ban_line():
    parsed = parse_fail2ban_line(
        "2026-08-12 09:44:38,400 fail2ban.actions        [292579]: NOTICE  [sshd] Ban 195.178.110.228"
    )
    assert parsed == {
        "timestamp": "2026-08-12 09:44:38,400",
        "jail": "sshd",
        "action": "Ban",
        "ip": "195.178.110.228",
    }


def test_parse_fail2ban_restore_ban_line():
    parsed = parse_fail2ban_line(
        "2026-08-12 09:53:01,024 fail2ban.actions        [308835]: NOTICE  [sshd] Restore Ban 195.178.110.228"
    )
    assert parsed["action"] == "Restore Ban"


def test_parse_fail2ban_ignores_non_action_lines():
    assert parse_fail2ban_line("2026-08-12 09:44:38,400 fail2ban.filter [292579]: INFO some noise") is None


def test_parse_sshd_auth_invalid_user():
    parsed = parse_sshd_auth_line(
        "2026-08-12T09:41:14+0000 vps sshd[300516]: Invalid user admin from 195.178.110.228 port 60270"
    )
    assert parsed["ip"] == "195.178.110.228"
    assert parsed["result"] == "invalid_user"


def test_parse_sshd_auth_failed_password():
    parsed = parse_sshd_auth_line(
        "2026-06-26T17:36:04+0000 vps sshd[2561599]: Failed password for root from 195.178.110.228 port 52182 ssh2"
    )
    assert parsed["ip"] == "195.178.110.228"
    assert parsed["result"] == "failed_password"


def test_ingesters_and_correlation_with_real_fixtures(tmp_path):
    fail2ban_log = tmp_path / "fail2ban.log"
    sshd_auth_log = tmp_path / "sshd-auth.log"
    shutil.copy(FIXTURES / "sample_fail2ban.log", fail2ban_log)
    shutil.copy(FIXTURES / "sample_sshd_auth.log", sshd_auth_log)

    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '195.178.110.228', 't')"
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s2', '1.2.3.4', 't')"
    )
    db.commit()

    FailbanIngester(db, fail2ban_log).tick()
    SshdAuthIngester(db, sshd_auth_log).tick()

    rows = {r["ip"]: r for r in get_correlation_rows(db)}
    assert rows["195.178.110.228"]["fail2ban_banned"] is True
    assert rows["195.178.110.228"]["real_ssh_attempts"] == 6
    assert rows["1.2.3.4"]["fail2ban_banned"] is False
    assert rows["1.2.3.4"]["real_ssh_attempts"] == 0
