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
    tty_dir = tmp_path / "var/lib/cowrie/tty"
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
    assert len(body) == 1
    assert body[0]["session_id"] == "s1"


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
    tty_dir = tmp_path / "var/lib/cowrie/tty"
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
    tty_dir = tmp_path / "var/lib/cowrie/tty"
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
