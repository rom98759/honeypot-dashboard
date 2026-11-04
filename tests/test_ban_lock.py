from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app, parse_ip_list

SAME_ORIGIN = {"Origin": "http://testserver"}


class _RecordingFban:
    def __init__(self):
        self.calls = []

    def request_ban(self, ip, scope="services"):
        self.calls.append(("ban", ip))
        self.scopes = getattr(self, "scopes", []) + [scope]

    def request_unban(self, ip):
        self.calls.append(("unban", ip))

    def request_status(self, ip):
        return False


def _client(tmp_path, monkeypatch, admin_ips="203.0.113.7, 198.51.100.0/24"):
    monkeypatch.setenv("ADMIN_IPS", admin_ips)
    fban = _RecordingFban()
    db = connect(tmp_path / "db.sqlite3")
    db.executemany(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES (?, ?, '2026-10-30T10:00:00Z')",
        [("s1", "198.51.100.9"), ("s2", "192.0.2.1")],
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False, fban_control=fban)
    return TestClient(app), fban


def test_parse_ip_list_accepts_ips_and_networks_and_skips_junk():
    networks = parse_ip_list(" 203.0.113.7 ,198.51.100.0/24,, not-an-ip, 2001:db8::/32 ")
    assert [str(n) for n in networks] == ["203.0.113.7/32", "198.51.100.0/24", "2001:db8::/32"]


def test_ban_refuses_protected_ips_without_touching_fail2ban(tmp_path, monkeypatch):
    client, fban = _client(tmp_path, monkeypatch)

    assert client.post("/api/ip/203.0.113.7/ban", headers=SAME_ORIGIN).status_code == 403
    assert client.post("/api/ip/198.51.100.42/ban", headers=SAME_ORIGIN).status_code == 403
    assert fban.calls == []
    assert client.post("/api/ip/192.0.2.1/ban", headers=SAME_ORIGIN).status_code == 200
    assert fban.calls == [("ban", "192.0.2.1")]


def test_unban_stays_allowed_for_protected_ips(tmp_path, monkeypatch):
    client, fban = _client(tmp_path, monkeypatch)
    assert client.post("/api/ip/203.0.113.7/unban", headers=SAME_ORIGIN).status_code == 200


def test_summary_flags_protected_ips(tmp_path, monkeypatch):
    client, _ = _client(tmp_path, monkeypatch)
    assert client.get("/api/ip/198.51.100.9/summary").json()["protected"] is True
    assert client.get("/api/ip/192.0.2.1/summary").json()["protected"] is False


def test_responses_forbid_framing(tmp_path, monkeypatch):
    client, _ = _client(tmp_path, monkeypatch)
    headers = client.get("/api/health").headers
    assert headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in headers["content-security-policy"]
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["referrer-policy"] == "same-origin"


def test_ban_scope_defaults_to_real_services_and_accepts_all(tmp_path, monkeypatch):
    client, fban = _client(tmp_path, monkeypatch)
    assert client.post("/api/ip/192.0.2.1/ban", headers=SAME_ORIGIN).status_code == 200
    assert client.post("/api/ip/192.0.2.1/ban", headers=SAME_ORIGIN, json={"scope": "all"}).status_code == 200
    assert fban.scopes == ["services", "all"]
    assert client.post("/api/ip/192.0.2.1/ban", headers=SAME_ORIGIN, json={"scope": "x"}).status_code == 422
