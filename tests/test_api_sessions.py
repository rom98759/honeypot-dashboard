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
