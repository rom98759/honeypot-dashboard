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


def test_parse_sshd_auth_ignores_ip_spoofed_in_username():
    parsed = parse_sshd_auth_line(
        "2026-10-30T10:00:00+0000 vps sshd[123]: Invalid user 192.0.2.77 from 203.0.113.5 port 4444"
    )
    assert parsed["ip"] == "203.0.113.5"


def test_parse_sshd_auth_ignores_fake_port_clause_in_username():
    parsed = parse_sshd_auth_line(
        "2026-10-30T10:00:00+0000 vps sshd[123]: Invalid user x from 192.0.2.77 port 22 "
        "from 203.0.113.5 port 4444"
    )
    assert parsed["ip"] == "203.0.113.5"


def test_parse_sshd_auth_accepts_ipv6_source():
    parsed = parse_sshd_auth_line(
        "2026-10-30T10:00:00+0000 vps sshd[123]: Failed password for root from 2001:db8::7 port 52182 ssh2"
    )
    assert parsed["ip"] == "2001:db8::7"
    assert parsed["result"] == "failed_password"


def test_parse_sshd_auth_ignores_local_address_suffix():
    parsed = parse_sshd_auth_line(
        "2026-10-30T10:00:00+0000 vps sshd[123]: Connection from 203.0.113.5 port 40520 "
        'on 10.0.0.2 port 50022 rdomain ""'
    )
    assert parsed["ip"] == "203.0.113.5"


def test_parse_sshd_auth_skips_listen_address():
    line = "2026-10-30T10:00:00+0000 vps sshd[123]: Server listening on 0.0.0.0 port 50022."
    assert parse_sshd_auth_line(line) is None


def test_parse_sshd_auth_skips_lines_without_source_port():
    line = "2026-10-30T10:00:00+0000 vps sshd[123]: pam_unix(sshd:session): session closed for user 10.0.0.1"
    assert parse_sshd_auth_line(line) is None


def test_correlation_marks_ip_unbanned_after_later_unban(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '9.9.9.9', 't');
        INSERT INTO fail2ban_events (ip, action, jail, timestamp)
        VALUES ('9.9.9.9', 'Ban', 'sshd', '2026-09-14 10:00:00,000');
        INSERT INTO fail2ban_events (ip, action, jail, timestamp)
        VALUES ('9.9.9.9', 'Unban', 'sshd', '2026-09-14 11:00:00,000');
        """
    )
    rows = {r["ip"]: r for r in get_correlation_rows(db)}
    assert rows["9.9.9.9"]["fail2ban_banned"] is False
