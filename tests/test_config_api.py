from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app

SAME_ORIGIN = {"Origin": "http://testserver"}


class _RecordingFban:
    def __init__(self):
        self.calls = []

    def request_ban(self, ip, jail="sshd"):
        self.calls.append(("ban", ip))

    def request_unban(self, ip, jail="sshd"):
        self.calls.append(("unban", ip))

    def request_status(self, ip, jail="sshd"):
        self.calls.append(("status", ip))
        return False


def _client(tmp_path, **kwargs):
    fban = _RecordingFban()
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '203.0.113.5', '2026-10-30T10:00:00Z')"
    )
    db.commit()
    app = create_app(
        db=db, start_background_tasks=False, fban_control=fban, **kwargs
    )
    return TestClient(app), fban


def test_config_defaults(tmp_path, monkeypatch):
    monkeypatch.delenv("SSHD_PORT", raising=False)
    monkeypatch.delenv("FBAN_ENABLED", raising=False)
    client, _ = _client(tmp_path)
    assert client.get("/api/config").json() == {"sshd_port": None, "ban_enabled": False}


def test_config_from_env(tmp_path, monkeypatch):
    monkeypatch.setenv("SSHD_PORT", "50022")
    monkeypatch.setenv("FBAN_ENABLED", "true")
    client, _ = _client(tmp_path)
    assert client.get("/api/config").json() == {"sshd_port": 50022, "ban_enabled": True}


def test_config_ignores_invalid_port(tmp_path, monkeypatch):
    monkeypatch.setenv("SSHD_PORT", "not-a-port")
    client, _ = _client(tmp_path)
    assert client.get("/api/config").json()["sshd_port"] is None


def test_config_from_args(tmp_path):
    client, _ = _client(tmp_path, sshd_port=50022, ban_enabled=True)
    assert client.get("/api/config").json() == {"sshd_port": 50022, "ban_enabled": True}


def test_ban_disabled_returns_404(tmp_path):
    client, fban = _client(tmp_path, ban_enabled=False)
    assert client.post("/api/ip/203.0.113.5/ban", headers=SAME_ORIGIN).status_code == 404
    assert client.post("/api/ip/203.0.113.5/unban", headers=SAME_ORIGIN).status_code == 404
    assert fban.calls == []


def test_ban_disabled_summary_skips_host_worker(tmp_path):
    # Without the host worker every status request would wait for the full timeout.
    client, fban = _client(tmp_path, ban_enabled=False)
    response = client.get("/api/ip/203.0.113.5/summary")
    assert response.status_code == 200
    assert response.json()["ban_enabled"] is False
    assert fban.calls == []


def test_ban_enabled_still_works(tmp_path):
    client, fban = _client(tmp_path, ban_enabled=True)
    assert client.post("/api/ip/203.0.113.5/ban", headers=SAME_ORIGIN).status_code == 200
    assert ("ban", "203.0.113.5") in fban.calls
