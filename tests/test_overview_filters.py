from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app
from app.overview_stats import get_overview_stats


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _seed(db):
    now = datetime.now(timezone.utc)
    rows = [
        # session_id, ip, age, protocol, username, password, duration_ms, close
        ("cn1", "1.1.1.1", timedelta(hours=1), "ssh", "root", "123456", 10_000, True),
        ("cn2", "1.1.1.1", timedelta(hours=2), "telnet", "admin", "admin", 30_000, True),
        ("us1", "2.2.2.2", timedelta(minutes=30), "ssh", "root", "root", None, False),
        ("prev", "3.3.3.3", timedelta(hours=30), "ssh", "pi", "raspberry", 5_000, True),
    ]
    for sid, ip, age, proto, user, pwd, dur, closed in rows:
        t = now - age
        db.execute(
            "INSERT INTO sessions (session_id, src_ip, connect_time, close_time, protocol, "
            "login_username, login_password, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (sid, ip, _iso(t), _iso(t) if closed else None, proto, user, pwd, dur),
        )
    geo = [("1.1.1.1", "China", "CN"), ("2.2.2.2", "United States", "US"), ("3.3.3.3", "China", "CN")]
    for ip, country, code in geo:
        db.execute(
            "INSERT INTO geo_cache (ip, country, country_code, looked_up_at) VALUES (?, ?, ?, 't')",
            (ip, country, code),
        )
    db.execute(
        "INSERT INTO commands (session_id, timestamp, input_text) VALUES ('cn1', 't', 'uname -a')"
    )
    db.execute(
        "INSERT INTO commands (session_id, timestamp, input_text) VALUES ('cn2', 't', 'uname -a')"
    )
    db.execute(
        "INSERT INTO commands (session_id, timestamp, input_text) VALUES ('us1', 't', 'id')"
    )
    db.commit()


def test_country_filter_scopes_totals_and_lists(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db)

    stats = get_overview_stats(db, "24h", {"country": "China"})

    assert stats["total_connections"] == 2
    assert stats["unique_ips"] == 1
    assert [c["input_text"] for c in stats["top_commands"]] == ["uname -a"]
    assert stats["top_commands"][0]["n"] == 2


def test_protocol_ip_and_username_filters_combine(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db)

    stats = get_overview_stats(db, "24h", {"protocol": "ssh", "username": "root"})
    assert stats["total_connections"] == 2

    stats = get_overview_stats(db, "24h", {"ip": "1.1.1.1", "protocol": "telnet"})
    assert stats["total_connections"] == 1


def test_previous_period_totals(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db)

    stats = get_overview_stats(db, "24h")

    assert stats["previous"]["total_connections"] == 1
    assert stats["previous"]["unique_ips"] == 1
    assert stats["previous"]["login_attempts"] == 1


def test_previous_is_none_for_all_period(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db)

    assert get_overview_stats(db, "all")["previous"] is None


def test_countries_carry_iso_code_and_are_not_truncated(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db)

    stats = get_overview_stats(db, "24h")

    assert stats["countries"] == [
        {"country": "China", "country_code": "CN", "n": 2},
        {"country": "United States", "country_code": "US", "n": 1},
    ]


def test_timeline_has_login_series(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db)

    stats = get_overview_stats(db, "24h")

    assert sum(b["n"] for b in stats["timeline"]) == 3
    assert sum(b["logins"] for b in stats["timeline"]) == 3


def test_top_usernames_passwords_avg_duration_and_active(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db)

    stats = get_overview_stats(db, "24h")

    assert stats["top_usernames"][0] == {"value": "root", "n": 2}
    assert {p["value"] for p in stats["top_passwords"]} == {"123456", "admin", "root"}
    assert stats["avg_duration_ms"] == 20_000
    assert stats["active_sessions"] == 1


def test_api_passes_filters_through(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db)
    client = TestClient(create_app(db=db, start_background_tasks=False))

    body = client.get("/api/overview?period=24h&country=United%20States").json()

    assert body["total_connections"] == 1
    assert body["countries"][0]["country_code"] == "US"


def test_overview_endpoint_is_cached_per_period_and_filters():
    db = connect(":memory:")
    _seed(db)
    client = TestClient(create_app(db=db, start_background_tasks=False))
    first = client.get("/api/overview?period=all").json()
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('new', '9.9.9.9', ?)",
        (_iso(datetime.now(timezone.utc)),),
    )
    assert client.get("/api/overview?period=all").json()["total_connections"] == first["total_connections"]
    assert client.get("/api/overview?period=all&ip=9.9.9.9").json()["total_connections"] == 1
    client.app.state.stats_cache.clear()
    assert client.get("/api/overview?period=all").json()["total_connections"] == first["total_connections"] + 1
