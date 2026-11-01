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


def test_last_ban_at_is_latest_ban_as_utc_iso(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('9.9.9.9', 'Ban', 'sshd', '2026-10-02 23:51:04,355');
        INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('8.8.8.8', 'Restore Ban', 'sshd', '2026-10-03 00:03:19,852');
        INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('9.9.9.9', 'Unban', 'sshd', '2026-10-04 00:00:00,000');
        """
    )
    db.commit()

    assert get_overview_stats(db, "24h")["last_ban_at"] == "2026-10-03T00:03:19.852Z"


def test_last_ban_at_is_null_without_bans(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    assert get_overview_stats(db, "24h")["last_ban_at"] is None


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


def test_bans_timeline_bucket_is_t_separated_for_real_fail2ban_timestamps(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES "
        "('1.2.3.4', 'Ban', 'sshd', '2026-08-12 09:44:38,400')",
    )
    db.commit()

    bans_timeline = get_overview_stats(db, "all")["bans_timeline"]
    assert bans_timeline == [{"bucket": "2026-08-12", "n": 1}]


def test_bans_timeline_bucket_is_t_separated_hourly_for_24h(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    real_format_timestamp = now.strftime("%Y-%m-%d %H:%M:%S,000")
    db.execute(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Ban', 'sshd', ?)",
        (real_format_timestamp,),
    )
    db.commit()

    bucket = get_overview_stats(db, "24h")["bans_timeline"][0]["bucket"]
    assert " " not in bucket
    assert "T" in bucket


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


def test_top_offenders_includes_country_and_last_seen(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    earlier = now - timedelta(hours=2)
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', ?)",
        (_iso(earlier),),
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s2', '1.2.3.4', ?)",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO geo_cache (ip, country, looked_up_at) VALUES ('1.2.3.4', 'France', ?)",
        (_iso(now),),
    )
    db.commit()

    top_offenders = get_overview_stats(db, "all")["top_offenders"]
    assert top_offenders == [
        {"src_ip": "1.2.3.4", "n": 2, "last_seen": _iso(now), "country": "France", "country_code": None}
    ]


def test_top_offenders_has_null_country_when_ungeolocated(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '9.9.9.9', ?)",
        (_iso(now),),
    )
    db.commit()

    top_offenders = get_overview_stats(db, "all")["top_offenders"]
    assert top_offenders == [
        {"src_ip": "9.9.9.9", "n": 1, "last_seen": _iso(now), "country": None, "country_code": None}
    ]


def test_duration_distribution_buckets_and_zero_fills(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.executemany(
        "INSERT INTO sessions (session_id, src_ip, connect_time, duration_ms) VALUES (?, '1.2.3.4', ?, ?)",
        [
            ("s1", _iso(now), 5_000),       # <10s
            ("s2", _iso(now), 45_000),      # 10-60s
            ("s3", _iso(now), 200_000),     # 1-5min
            ("s4", _iso(now), 1_000_000),   # 5-30min
            ("s5", _iso(now), 2_000_000),   # >30min
            ("s6", _iso(now), 2_100_000),   # >30min (second in same bucket)
        ],
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, duration_ms) VALUES ('s7', '1.2.3.4', ?, NULL)",
        (_iso(now),),
    )
    db.commit()

    duration_distribution = get_overview_stats(db, "all")["duration_distribution"]
    assert duration_distribution == [
        {"bucket": "<10s", "n": 1},
        {"bucket": "10-60s", "n": 1},
        {"bucket": "1-5min", "n": 1},
        {"bucket": "5-30min", "n": 1},
        {"bucket": ">30min", "n": 2},
    ]


def test_duration_distribution_all_zero_when_no_closed_sessions(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, duration_ms) VALUES ('s1', '1.2.3.4', ?, NULL)",
        (_iso(now),),
    )
    db.commit()

    duration_distribution = get_overview_stats(db, "all")["duration_distribution"]
    assert duration_distribution == [
        {"bucket": "<10s", "n": 0},
        {"bucket": "10-60s", "n": 0},
        {"bucket": "1-5min", "n": 0},
        {"bucket": "5-30min", "n": 0},
        {"bucket": ">30min", "n": 0},
    ]
