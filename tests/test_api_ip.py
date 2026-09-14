from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app


def test_ip_summary_404_for_unknown_ip(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/9.9.9.9/summary")
    assert response.status_code == 404


def test_ip_summary_aggregates_sessions_and_geo(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at)
        VALUES ('1.2.3.4', 'France', 'Paris', 48.85, 2.35, 't');
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', '2026-08-01T10:00:00Z');
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s2', '1.2.3.4', '2026-08-14T09:00:00Z');
        INSERT INTO commands (session_id, timestamp, input_text) VALUES ('s1', '2026-08-01T10:00:01Z', 'whoami');
        INSERT INTO commands (session_id, timestamp, input_text) VALUES ('s1', '2026-08-01T10:00:02Z', 'ls');
        """
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/summary")
    assert response.status_code == 200
    body = response.json()
    assert body["country"] == "France"
    assert body["city"] == "Paris"
    assert body["total_sessions"] == 2
    assert body["total_commands"] == 2
    assert body["first_seen"] == "2026-08-01T10:00:00Z"
    assert body["last_seen"] == "2026-08-14T09:00:00Z"
    assert body["currently_banned"] is False


def test_ip_summary_currently_banned_true_after_ban_with_no_later_unban(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) "
        "VALUES ('1.2.3.4', 'Ban', 'sshd', '2026-08-14T08:00:00Z')"
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/summary")
    assert response.status_code == 200
    assert response.json()["currently_banned"] is True


def test_ip_summary_currently_banned_false_after_later_unban(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Ban', 'sshd', '2026-08-14T08:00:00Z');
        INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Unban', 'sshd', '2026-08-14T09:00:00Z');
        """
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/summary")
    assert response.json()["currently_banned"] is False


class _FakeFbanControl:
    def __init__(self, status):
        self._status = status

    def request_status(self, ip, jail="sshd"):
        return self._status


def test_ip_summary_currently_banned_uses_live_status_over_log(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Ban', 'sshd', '2026-08-14T08:00:00Z');
        INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Unban', 'sshd', '2026-08-14T09:00:00Z');
        """
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False, fban_control=_FakeFbanControl(True))
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/summary")
    # log says unbanned, but the live worker says banned -> live wins
    assert response.json()["currently_banned"] is True


def test_ip_summary_currently_banned_falls_back_to_log_when_worker_times_out(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) "
        "VALUES ('1.2.3.4', 'Ban', 'sshd', '2026-08-14T08:00:00Z')"
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False, fban_control=_FakeFbanControl(None))
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/summary")
    # worker timed out (None) -> falls back to log-derived heuristic, which says banned
    assert response.json()["currently_banned"] is True


def test_ip_summary_returns_data_for_ip_with_only_fail2ban_events_and_no_sessions(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) "
        "VALUES ('1.2.3.4', 'Ban', 'sshd', '2026-08-14T08:00:00Z')"
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/summary")
    assert response.status_code == 200
    body = response.json()
    assert body["total_sessions"] == 0
    assert body["first_seen"] is None
    assert body["last_seen"] is None


def test_ip_fail2ban_paginates_and_orders_desc(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Ban', 'sshd', '2026-08-01T10:00:00Z');
        INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Unban', 'sshd', '2026-08-02T10:00:00Z');
        INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Restore Ban', 'sshd', '2026-08-03T10:00:00Z');
        """
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/fail2ban", params={"limit": 2, "offset": 0})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2
    assert body["items"][0]["action"] == "Restore Ban"
    assert body["items"][1]["action"] == "Unban"


def test_ip_fail2ban_empty_for_ip_with_no_events(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/fail2ban")
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0}


def test_ip_sshd_auth_paginates_and_orders_desc(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sshd_auth_events (ip, result, timestamp) VALUES ('1.2.3.4', 'invalid_user', '2026-08-01T10:00:00Z');
        INSERT INTO sshd_auth_events (ip, result, timestamp) VALUES ('1.2.3.4', 'failed_password', '2026-08-02T10:00:00Z');
        """
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/sshd-auth")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["items"][0]["result"] == "failed_password"
    assert body["items"][1]["result"] == "invalid_user"


class _RecordingFbanControl:
    def __init__(self, status_after_action=True, raise_on_action=None):
        self.calls = []
        self._status_after_action = status_after_action
        self._raise_on_action = raise_on_action

    def request_ban(self, ip, jail="sshd"):
        self.calls.append(("ban", ip))
        if self._raise_on_action:
            raise self._raise_on_action

    def request_unban(self, ip, jail="sshd"):
        self.calls.append(("unban", ip))
        if self._raise_on_action:
            raise self._raise_on_action

    def request_status(self, ip, jail="sshd"):
        return self._status_after_action


def test_ban_ip_calls_fban_control_and_returns_fresh_status(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    fban = _RecordingFbanControl(status_after_action=True)
    app = create_app(db=db, start_background_tasks=False, fban_control=fban)
    client = TestClient(app)

    response = client.post(
        "/api/ip/1.2.3.4/ban", headers={"Origin": "http://testserver"}
    )
    assert response.status_code == 200
    assert response.json() == {"currently_banned": True}
    assert fban.calls == [("ban", "1.2.3.4")]


def test_unban_ip_calls_fban_control_and_returns_fresh_status(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    fban = _RecordingFbanControl(status_after_action=False)
    app = create_app(db=db, start_background_tasks=False, fban_control=fban)
    client = TestClient(app)

    response = client.post(
        "/api/ip/1.2.3.4/unban", headers={"Origin": "http://testserver"}
    )
    assert response.status_code == 200
    assert response.json() == {"currently_banned": False}
    assert fban.calls == [("unban", "1.2.3.4")]


def test_ban_ip_rejects_cross_origin_request(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    fban = _RecordingFbanControl()
    app = create_app(db=db, start_background_tasks=False, fban_control=fban)
    client = TestClient(app)

    response = client.post(
        "/api/ip/1.2.3.4/ban", headers={"Origin": "http://evil.example"}
    )
    assert response.status_code == 403
    assert fban.calls == []


def test_ban_ip_accepts_referer_when_origin_is_missing(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    fban = _RecordingFbanControl(status_after_action=True)
    app = create_app(db=db, start_background_tasks=False, fban_control=fban)
    client = TestClient(app)

    response = client.post(
        "/api/ip/1.2.3.4/ban", headers={"Referer": "http://testserver/some/page"}
    )
    assert response.status_code == 200
    assert response.json() == {"currently_banned": True}
    assert fban.calls == [("ban", "1.2.3.4")]


def test_ban_ip_rejects_request_with_no_origin_and_no_referer(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    fban = _RecordingFbanControl()
    app = create_app(db=db, start_background_tasks=False, fban_control=fban)
    client = TestClient(app)

    response = client.post("/api/ip/1.2.3.4/ban")
    assert response.status_code == 403
    assert fban.calls == []


def test_ban_ip_returns_503_on_timeout(tmp_path):
    from app.fban_control import FbanTimeout

    db = connect(tmp_path / "db.sqlite3")
    fban = _RecordingFbanControl(raise_on_action=FbanTimeout("no response"))
    app = create_app(db=db, start_background_tasks=False, fban_control=fban)
    client = TestClient(app)

    response = client.post(
        "/api/ip/1.2.3.4/ban", headers={"Origin": "http://testserver"}
    )
    assert response.status_code == 503
