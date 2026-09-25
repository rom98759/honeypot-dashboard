from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app

FIXTURE_TTY = Path(__file__).parent / "fixtures" / "sample_ttylog.bin"


def _seed(db, tmp_path):
    db.executescript(
        """
        INSERT INTO sessions (session_id, src_ip, connect_time, duration_ms)
        VALUES ('s1', '1.2.3.4', '2026-08-12T10:00:00Z', 5000);
        INSERT INTO sessions (session_id, src_ip, connect_time, duration_ms)
        VALUES ('s2', '5.6.7.8', '2026-08-12T11:00:00Z', 1000);
        INSERT INTO commands (session_id, timestamp, input_text)
        VALUES ('s1', '2026-08-12T10:00:01Z', 'whoami');
        """
    )
    tty_dir = tmp_path / "lib/cowrie/tty"
    tty_dir.mkdir(parents=True)
    tty_path = tty_dir / "abc123"
    tty_path.write_bytes(FIXTURE_TTY.read_bytes())
    db.execute(
        "INSERT INTO ttylogs (session_id, ttylog_path, close_time, size, duration_ms) "
        "VALUES ('s1', 'var/lib/cowrie/tty/abc123', '2026-08-12T10:00:02Z', 343, 100)"
    )
    db.commit()


def test_list_sessions_filters_by_ip(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"ip": "1.2.3.4"})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["session_id"] == "s1"


def test_list_sessions_paginates_with_offset_and_limit(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"limit": 1, "offset": 1, "sort": "connect_time", "order": "asc"})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert len(body["items"]) == 1
    assert body["items"][0]["session_id"] == "s2"


def test_list_sessions_sorts_by_requested_column(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"sort": "src_ip", "order": "asc"})
    assert response.status_code == 200
    ips = [item["src_ip"] for item in response.json()["items"]]
    assert ips == ["1.2.3.4", "5.6.7.8"]


def test_list_sessions_rejects_unknown_sort_column(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"sort": "session_id; DROP TABLE sessions"})
    assert response.status_code == 400


def test_list_sessions_rejects_unknown_order(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"order": "sideways"})
    assert response.status_code == 400


def test_list_sessions_rejects_negative_limit(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"limit": -1})
    assert response.status_code == 422


def test_list_sessions_rejects_zero_limit(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"limit": 0})
    assert response.status_code == 422


def test_list_sessions_rejects_negative_offset(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"offset": -1})
    assert response.status_code == 422


def test_list_sessions_defaults_to_descending_order(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"sort": "src_ip"})
    assert response.status_code == 200
    ips = [item["src_ip"] for item in response.json()["items"]]
    assert ips == ["5.6.7.8", "1.2.3.4"]


def test_list_sessions_combines_ip_filter_with_pagination(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sessions (session_id, src_ip, connect_time, duration_ms)
        VALUES ('s1', '1.2.3.4', '2026-08-12T10:00:00Z', 5000);
        INSERT INTO sessions (session_id, src_ip, connect_time, duration_ms)
        VALUES ('s2', '1.2.3.4', '2026-08-12T11:00:00Z', 1000);
        INSERT INTO sessions (session_id, src_ip, connect_time, duration_ms)
        VALUES ('s3', '1.2.3.4', '2026-08-12T12:00:00Z', 2000);
        INSERT INTO sessions (session_id, src_ip, connect_time, duration_ms)
        VALUES ('s4', '5.6.7.8', '2026-08-12T13:00:00Z', 3000);
        """
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get(
        "/api/sessions",
        params={"ip": "1.2.3.4", "limit": 1, "offset": 1, "sort": "connect_time", "order": "asc"},
    )
    assert response.status_code == 200
    body = response.json()
    # total must reflect only rows matching the ip filter, not the whole table
    assert body["total"] == 3
    assert len(body["items"]) == 1
    assert body["items"][0]["session_id"] == "s2"


def test_list_sessions_rejects_unlisted_real_column(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"sort": "login_password"})
    assert response.status_code == 400


def test_get_session_detail_includes_commands(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    app.state.cowrie_var_path = tmp_path
    client = TestClient(app)

    response = client.get("/api/sessions/s1")
    assert response.status_code == 200
    body = response.json()
    assert body["session"]["session_id"] == "s1"
    assert body["commands"] == [{"timestamp": "2026-08-12T10:00:01Z", "input_text": "whoami"}]


def test_get_session_detail_404_when_missing(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    assert client.get("/api/sessions/does-not-exist").status_code == 404


def test_replay_returns_asciicast(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    app.state.cowrie_var_path = tmp_path
    client = TestClient(app)

    response = client.get("/api/sessions/s1/replay")
    assert response.status_code == 200
    assert response.text.startswith('{"version": 2')


def test_replay_404_when_no_ttylog(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s2', '5.6.7.8', 't')"
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    app.state.cowrie_var_path = tmp_path
    client = TestClient(app)

    response = client.get("/api/sessions/s2/replay")
    assert response.status_code == 404


def test_replay_concatenates_multiple_ttylogs(tmp_path):
    """A session with several ttylogs (e.g. one per exec-mode command) must have
    the replay endpoint concatenate ALL of them, ordered by close_time, into a
    single asciicast timeline (not just serve the first row)."""
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, duration_ms) "
        "VALUES ('s3', '9.9.9.9', '2026-08-12T12:00:00Z', 5000)"
    )
    tty_dir = tmp_path / "lib/cowrie/tty"
    tty_dir.mkdir(parents=True)
    tty_path_a = tty_dir / "multi_a"
    tty_path_b = tty_dir / "multi_b"
    tty_path_a.write_bytes(FIXTURE_TTY.read_bytes())
    tty_path_b.write_bytes(FIXTURE_TTY.read_bytes())
    db.execute(
        "INSERT INTO ttylogs (session_id, ttylog_path, close_time, size, duration_ms) "
        "VALUES ('s3', 'var/lib/cowrie/tty/multi_a', '2026-08-12T12:00:01Z', 343, 100)"
    )
    db.execute(
        "INSERT INTO ttylogs (session_id, ttylog_path, close_time, size, duration_ms) "
        "VALUES ('s3', 'var/lib/cowrie/tty/multi_b', '2026-08-12T12:00:02Z', 343, 100)"
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    app.state.cowrie_var_path = tmp_path
    client = TestClient(app)

    response = client.get("/api/sessions/s3/replay")
    assert response.status_code == 200
    lines = response.text.strip().split("\n")
    event_lines = lines[1:]  # first line is the asciicast header
    # a single copy of the fixture yields 4 events (see test_ttyplayer.py); two
    # ttylog rows concatenated on one timeline must yield 2x4 = 8
    assert len(event_lines) == 8


def test_replay_404_when_ttylog_corrupted(tmp_path):
    """If the one ttylog row on disk is corrupted/truncated, ttylogs_to_asciicast
    raises TTYLogError, and the router must translate that into a 404 (not a 500),
    end to end through the /replay endpoint."""
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s4', '1.1.1.1', 't')"
    )
    tty_dir = tmp_path / "lib/cowrie/tty"
    tty_dir.mkdir(parents=True)
    tty_path = tty_dir / "corrupt"
    tty_path.write_bytes(b"\x01\x00\x00")  # shorter than one valid frame header
    db.execute(
        "INSERT INTO ttylogs (session_id, ttylog_path, close_time, size, duration_ms) "
        "VALUES ('s4', 'var/lib/cowrie/tty/corrupt', '2026-08-12T13:00:00Z', 3, 10)"
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    app.state.cowrie_var_path = tmp_path
    client = TestClient(app)

    response = client.get("/api/sessions/s4/replay")
    assert response.status_code == 404


def test_list_sessions_filters_by_exact_command(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"command": "whoami"})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["session_id"] == "s1"


def test_list_sessions_command_filter_is_exact_not_substring(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"command": "who"})
    assert response.status_code == 200
    assert response.json()["total"] == 0


def test_list_sessions_combines_ip_and_command_filters(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db, tmp_path)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    matching = client.get("/api/sessions", params={"ip": "1.2.3.4", "command": "whoami"})
    assert matching.json()["total"] == 1

    mismatched = client.get("/api/sessions", params={"ip": "5.6.7.8", "command": "whoami"})
    assert mismatched.json()["total"] == 0


def test_list_sessions_filters_by_protocol(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sessions (session_id, src_ip, protocol, connect_time) VALUES ('s1', '1.2.3.4', 'ssh', '2026-08-12T10:00:00Z');
        INSERT INTO sessions (session_id, src_ip, protocol, connect_time) VALUES ('s2', '5.6.7.8', 'telnet', '2026-08-12T11:00:00Z');
        """
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"protocol": "ssh"})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["session_id"] == "s1"


def test_list_sessions_filters_by_country_via_geo_cache(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', '2026-08-12T10:00:00Z');
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s2', '5.6.7.8', '2026-08-12T11:00:00Z');
        INSERT INTO geo_cache (ip, country, looked_up_at) VALUES ('1.2.3.4', 'France', '2026-08-12T09:00:00Z');
        """
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"country": "France"})
    assert response.status_code == 200
    body = response.json()
    # s2 has no geo_cache row at all and must NOT match — an IP with unknown country is not a
    # wildcard, it simply never matches any specific country filter.
    assert body["total"] == 1
    assert body["items"][0]["session_id"] == "s1"


def test_list_sessions_filters_by_period(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    old = (now - timedelta(days=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
    recent = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    db.executescript(
        f"""
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('old', '1.2.3.4', '{old}');
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('recent', '5.6.7.8', '{recent}');
        """
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"period": "24h"})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["session_id"] == "recent"


def test_list_sessions_period_all_adds_no_filter(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', '2020-01-01T00:00:00Z')"
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"period": "all"})
    assert response.status_code == 200
    assert response.json()["total"] == 1


def test_list_sessions_rejects_invalid_period(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"period": "nonsense"})
    assert response.status_code == 400


def test_list_sessions_date_range_lower_bound_inclusive_upper_bound_exclusive(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('before', '1.1.1.1', '2026-08-12T09:59:59Z');
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('at_lower', '2.2.2.2', '2026-08-12T10:00:00Z');
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('inside', '3.3.3.3', '2026-08-12T10:30:00Z');
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('at_upper', '4.4.4.4', '2026-08-12T11:00:00Z');
        """
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get(
        "/api/sessions", params={"date_from": "2026-08-12T10:00:00Z", "date_to": "2026-08-12T11:00:00Z"}
    )
    assert response.status_code == 200
    ids = {item["session_id"] for item in response.json()["items"]}
    # 'at_upper' sits exactly on date_to and must be excluded — the upper bound is exclusive.
    assert ids == {"at_lower", "inside"}


def test_list_sessions_combines_protocol_and_country_filters(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sessions (session_id, src_ip, protocol, connect_time) VALUES ('s1', '1.2.3.4', 'ssh', '2026-08-12T10:00:00Z');
        INSERT INTO sessions (session_id, src_ip, protocol, connect_time) VALUES ('s2', '1.2.3.4', 'telnet', '2026-08-12T11:00:00Z');
        INSERT INTO geo_cache (ip, country, looked_up_at) VALUES ('1.2.3.4', 'France', '2026-08-12T09:00:00Z');
        """
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/sessions", params={"protocol": "ssh", "country": "France"})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["session_id"] == "s1"
