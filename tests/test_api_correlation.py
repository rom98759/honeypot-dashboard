from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app


def test_correlation_endpoint_reflects_bans_and_ssh_attempts(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '9.9.9.9', 't');
        INSERT INTO fail2ban_events (ip, action, jail, timestamp)
        VALUES ('9.9.9.9', 'Ban', 'sshd', 't');
        INSERT INTO sshd_auth_events (ip, result, timestamp)
        VALUES ('9.9.9.9', 'failed_password', 't');
        """
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/correlation")
    assert response.status_code == 200
    body = response.json()
    assert body == [
        {
            "ip": "9.9.9.9",
            "honeypot_sessions": 1,
            "fail2ban_banned": True,
            "real_ssh_attempts": 1,
        }
    ]
