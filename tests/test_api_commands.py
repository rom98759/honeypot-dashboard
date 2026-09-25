from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _seed(db):
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', ?)",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO commands (session_id, timestamp, input_text) VALUES ('s1', ?, 'whoami')",
        (_iso(now),),
    )
    db.commit()


def test_list_commands_returns_ranked_items(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/commands", params={"period": "all"})
    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["input_text"] == "whoami"
    assert body["total"] == 1


def test_list_commands_default_period_is_24h(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/commands")
    assert response.status_code == 200
    assert response.json()["total"] == 1


def test_list_commands_rejects_invalid_period(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/commands", params={"period": "bogus"})
    assert response.status_code == 400


def test_list_commands_passes_q_through(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    _seed(db)
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/commands", params={"period": "all", "q": "nomatch"})
    assert response.status_code == 200
    assert response.json()["total"] == 0
