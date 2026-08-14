from datetime import datetime, timedelta, timezone

from app.db import connect
from app.overview_stats import get_overview_stats


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_totals_are_scoped_to_period(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('recent', '1.2.3.4', ?)",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('old', '9.9.9.9', ?)",
        (_iso(now - timedelta(days=10)),),
    )
    db.commit()

    stats_24h = get_overview_stats(db, "24h")
    assert stats_24h["total_connections"] == 1
    assert stats_24h["unique_ips"] == 1

    stats_all = get_overview_stats(db, "all")
    assert stats_all["total_connections"] == 2
    assert stats_all["unique_ips"] == 2


def test_currently_banned_ignores_period(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('9.9.9.9', 'Ban', 'sshd', ?)",
        (_iso(now - timedelta(days=10)),),
    )
    db.commit()

    stats_24h = get_overview_stats(db, "24h")
    stats_all = get_overview_stats(db, "all")
    assert stats_24h["currently_banned"] == 1
    assert stats_all["currently_banned"] == 1


def test_protocol_split_defaults_null_protocol_to_ssh(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, protocol) VALUES ('s1', '1.2.3.4', ?, NULL)",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, protocol) VALUES ('s2', '5.6.7.8', ?, 'telnet')",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, protocol) VALUES ('s3', '9.9.9.9', ?, 'ssh')",
        (_iso(now),),
    )
    db.commit()

    protocol_split = sorted(get_overview_stats(db, "all")["protocol_split"], key=lambda r: r["protocol"])
    assert protocol_split == [{"protocol": "ssh", "n": 2}, {"protocol": "telnet", "n": 1}]


def test_top_credentials_handles_null_password(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, login_username, login_password) "
        "VALUES ('s1', '1.2.3.4', ?, 'root', NULL)",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, login_username) "
        "VALUES ('s2', '5.6.7.8', ?, NULL)",
        (_iso(now),),
    )
    db.commit()

    top_credentials = get_overview_stats(db, "all")["top_credentials"]
    assert top_credentials == [{"login_username": "root", "login_password": None, "n": 1}]


def test_bans_timeline_counts_ban_and_restore_ban_but_not_unban(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.executemany(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES (?, ?, 'sshd', ?)",
        [
            ("1.2.3.4", "Ban", _iso(now)),
            ("5.6.7.8", "Restore Ban", _iso(now)),
            ("9.9.9.9", "Unban", _iso(now)),
        ],
    )
    db.commit()

    bans_timeline = get_overview_stats(db, "all")["bans_timeline"]
    assert sum(bucket["n"] for bucket in bans_timeline) == 2


def test_timeline_bucket_is_hourly_for_24h_and_daily_for_30d(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', ?)",
        (_iso(now),),
    )
    db.commit()

    bucket_24h = get_overview_stats(db, "24h")["timeline"][0]["bucket"]
    bucket_30d = get_overview_stats(db, "30d")["timeline"][0]["bucket"]
    assert len(bucket_24h) == 13
    assert len(bucket_30d) == 10


def test_bans_timeline_bucket_is_hourly_for_24h_and_daily_for_30d(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Ban', 'sshd', ?)",
        (_iso(now),),
    )
    db.commit()

    bucket_24h = get_overview_stats(db, "24h")["bans_timeline"][0]["bucket"]
    bucket_30d = get_overview_stats(db, "30d")["bans_timeline"][0]["bucket"]
    assert len(bucket_24h) == 13
    assert len(bucket_30d) == 10


def test_bans_timeline_is_period_scoped(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Ban', 'sshd', ?)",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('5.6.7.8', 'Ban', 'sshd', ?)",
        (_iso(now - timedelta(days=10)),),
    )
    db.commit()

    bans_24h = get_overview_stats(db, "24h")["bans_timeline"]
    bans_all = get_overview_stats(db, "all")["bans_timeline"]
    assert sum(bucket["n"] for bucket in bans_24h) == 1
    assert sum(bucket["n"] for bucket in bans_all) == 2
