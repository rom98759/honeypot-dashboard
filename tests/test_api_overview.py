from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app


def test_overview_reflects_seeded_sessions(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sessions (session_id, src_ip, connect_time, login_username)
        VALUES ('s1', '1.2.3.4', '2026-08-12T10:00:00Z', 'root');
        INSERT INTO sessions (session_id, src_ip, connect_time, login_username)
        VALUES ('s2', '1.2.3.4', '2026-08-12T11:00:00Z', NULL);
        INSERT INTO sessions (session_id, src_ip, connect_time, login_username)
        VALUES ('s3', '5.6.7.8', '2026-08-12T11:30:00Z', 'admin');
        """
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/overview")
    assert response.status_code == 200
    body = response.json()
    assert body["total_connections"] == 3
    assert body["unique_ips"] == 2
    assert body["login_attempts"] == 2
