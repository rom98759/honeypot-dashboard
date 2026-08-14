from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_overview_reflects_seeded_sessions(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, login_username) "
        "VALUES ('s1', '1.2.3.4', ?, 'root')",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, login_username) "
        "VALUES ('s2', '1.2.3.4', ?, NULL)",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, login_username) "
        "VALUES ('s3', '5.6.7.8', ?, 'admin')",
        (_iso(now),),
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/overview?period=all")
    assert response.status_code == 200
    body = response.json()
    assert body["total_connections"] == 3
    assert body["unique_ips"] == 2
    assert body["login_attempts"] == 2


def test_overview_default_period_is_24h(tmp_path):
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

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/overview")
    assert response.status_code == 200
    assert response.json()["total_connections"] == 1


def test_overview_rejects_invalid_period(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/overview?period=bogus")
    assert response.status_code == 400


def test_overview_new_fields_present(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time, protocol, login_username, login_password) "
        "VALUES ('s1', '1.2.3.4', ?, 'telnet', 'root', '123456')",
        (_iso(now),),
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    body = client.get("/api/overview?period=all").json()
    assert body["protocol_split"] == [{"protocol": "telnet", "n": 1}]
    assert body["top_credentials"] == [{"login_username": "root", "login_password": "123456", "n": 1}]
    assert body["bans_timeline"] == []
