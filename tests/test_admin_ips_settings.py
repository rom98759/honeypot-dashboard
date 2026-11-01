import pytest
from fastapi.testclient import TestClient

from app.admin_ips import validate_network
from app.db import connect
from app.main import create_app

SAME_ORIGIN = {"Origin": "http://testserver"}


class _Fban:
    def __init__(self):
        self.calls = []

    def request_ban(self, ip, jail="sshd"):
        self.calls.append(ip)

    def request_unban(self, ip, jail="sshd"):
        pass

    def request_status(self, ip, jail="sshd"):
        return False


def _client(tmp_path, monkeypatch, env=""):
    monkeypatch.setenv("ADMIN_IPS", env)
    fban = _Fban()
    app = create_app(db=connect(tmp_path / "db.sqlite3"), start_background_tasks=False, fban_control=fban)
    return TestClient(app), fban


def test_validate_network_normalizes_and_rejects_too_wide_ranges():
    assert str(validate_network(" 203.0.113.7 ")) == "203.0.113.7/32"
    assert str(validate_network("203.0.113.7/24")) == "203.0.113.0/24"
    for bad in ("0.0.0.0/0", "10.0.0.0/8", "2001:db8::/32", "not-an-ip", ""):
        with pytest.raises(ValueError):
            validate_network(bad)


def test_added_network_protects_from_ban_and_can_be_removed(tmp_path, monkeypatch):
    client, fban = _client(tmp_path, monkeypatch)

    response = client.post(
        "/api/settings/admin-ips", json={"value": "203.0.113.0/24", "note": "box"}, headers=SAME_ORIGIN
    )
    assert response.status_code == 201
    assert client.post("/api/ip/203.0.113.7/ban", headers=SAME_ORIGIN).status_code == 403

    listing = client.get("/api/settings/admin-ips").json()
    assert [(i["cidr"], i["note"]) for i in listing["items"]] == [("203.0.113.0/24", "box")]

    removed = client.delete("/api/settings/admin-ips?cidr=203.0.113.0/24", headers=SAME_ORIGIN)
    assert removed.status_code == 204
    assert client.post("/api/ip/203.0.113.7/ban", headers=SAME_ORIGIN).status_code == 200
    assert fban.calls == ["203.0.113.7"]


def test_env_networks_are_listed_read_only(tmp_path, monkeypatch):
    client, _ = _client(tmp_path, monkeypatch, env="203.0.113.7")
    assert client.get("/api/settings/admin-ips").json()["env"] == ["203.0.113.7/32"]


def test_settings_writes_reject_bad_input_duplicates_and_cross_origin(tmp_path, monkeypatch):
    client, _ = _client(tmp_path, monkeypatch)
    url = "/api/settings/admin-ips"
    assert client.post(url, json={"value": "0.0.0.0/0"}, headers=SAME_ORIGIN).status_code == 400
    assert client.post(url, json={"value": "203.0.113.7"}, headers=SAME_ORIGIN).status_code == 201
    assert client.post(url, json={"value": "203.0.113.7/32"}, headers=SAME_ORIGIN).status_code == 409
    assert client.post(url, json={"value": "1.2.3.4"}, headers={"Origin": "http://evil.example"}).status_code == 403
    assert client.delete(f"{url}?cidr=203.0.113.7/32", headers={"Origin": "http://evil.example"}).status_code == 403
