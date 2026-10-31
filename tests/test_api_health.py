from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app


def _sources_by_name(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    return {s["source"]: s for s in response.json()["sources"]}


def test_health_reports_lag_and_last_event_per_source(tmp_path, monkeypatch):
    f2b = tmp_path / "fail2ban.log"
    f2b.write_text(
        "2026-10-30 10:00:00,123 fail2ban.actions        [1]: NOTICE  [sshd] Ban 9.9.9.9\n"
    )
    monkeypatch.setenv("FAIL2BAN_LOG_PATH", str(f2b))
    monkeypatch.setenv("SSHD_AUTH_LOG_PATH", str(tmp_path / "missing-sshd.log"))
    monkeypatch.setenv("COWRIE_JSON_PATH", str(tmp_path / "missing-cowrie.json"))
    db = connect(tmp_path / "db.sqlite3")
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    before = _sources_by_name(client)["fail2ban.log"]
    assert before["file_present"] is True
    assert before["lag_bytes"] == f2b.stat().st_size
    assert before["last_event"] is None

    app.state.fail2ban_ingester.tick()

    after = _sources_by_name(client)
    assert after["fail2ban.log"]["lag_bytes"] == 0
    assert after["fail2ban.log"]["last_event"] == "2026-10-30 10:00:00,123"
    assert after["sshd-auth.log"]["file_present"] is False
    assert after["sshd-auth.log"]["lag_bytes"] is None


def test_health_counts_whole_file_as_lag_after_rotation(tmp_path, monkeypatch):
    f2b = tmp_path / "fail2ban.log"
    f2b.write_text("old line\n")
    monkeypatch.setenv("FAIL2BAN_LOG_PATH", str(f2b))
    db = connect(tmp_path / "db.sqlite3")
    app = create_app(db=db, start_background_tasks=False)
    app.state.fail2ban_ingester.tick()

    f2b.rename(tmp_path / "fail2ban.log.1")
    f2b.write_text("new line after rotation\n")

    source = _sources_by_name(TestClient(app))["fail2ban.log"]
    assert source["lag_bytes"] == f2b.stat().st_size
