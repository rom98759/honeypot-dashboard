from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app


def _recent_ban_ts(hours: float = 1) -> str:
    """fail2ban's own timestamp layout, `hours` ago."""
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S,000")


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
        INSERT INTO geo_cache (ip, country, country_code, city, latitude, longitude, looked_up_at)
        VALUES ('1.2.3.4', 'France', 'FR', 'Paris', 48.85, 2.35, 't');
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
    assert body["country_code"] == "FR"
    assert body["city"] == "Paris"
    assert body["total_sessions"] == 2
    assert body["total_commands"] == 2
    assert body["first_seen"] == "2026-08-01T10:00:00Z"
    assert body["last_seen"] == "2026-08-14T09:00:00Z"
    assert body["currently_banned"] is False


def test_ip_summary_currently_banned_true_after_ban_with_no_later_unban(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Ban', 'sshd', ?)",
        (_recent_ban_ts(),),
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/summary")
    assert response.status_code == 200
    assert response.json()["currently_banned"] is True


def test_ip_summary_ban_older_than_bantime_has_expired(tmp_path):
    """The Unban line can be lost (log gap, restart): a 7-day sshd ban from 8 days ago is over."""
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Ban', 'sshd', ?)",
        (_recent_ban_ts(hours=24 * 8),),
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    response = TestClient(app).get("/api/ip/1.2.3.4/summary")
    assert response.json()["currently_banned"] is False


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
        "INSERT INTO fail2ban_events (ip, action, jail, timestamp) VALUES ('1.2.3.4', 'Ban', 'sshd', ?)",
        (_recent_ban_ts(),),
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


def test_ip_summary_defaults_to_pending_when_no_enrichment_row(tmp_path, monkeypatch):
    monkeypatch.delenv("ABUSEIPDB_API_KEY", raising=False)
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', 't')")
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/summary")
    body = response.json()
    assert body["enrichment_status"] == "pending"
    assert body["asn"] is None
    assert body["abuseipdb_configured"] is False


def test_ip_summary_includes_resolved_enrichment_fields(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', 't');
        INSERT INTO ip_enrichment (ip, asn, asn_org, reverse_dns, abuseipdb_score, abuseipdb_total_reports, abuseipdb_last_reported_at, status, looked_up_at)
        VALUES ('1.2.3.4', 15169, 'GOOGLE', 'dns.google', 10, 2, '2026-10-01T00:00:00Z', 'done', 't');
        """
    )
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/summary")
    body = response.json()
    assert body["enrichment_status"] == "done"
    assert body["asn"] == 15169
    assert body["asn_org"] == "GOOGLE"
    assert body["reverse_dns"] == "dns.google"
    assert body["abuseipdb_score"] == 10
    assert body["abuseipdb_total_reports"] == 2
    assert body["abuseipdb_last_reported_at"] == "2026-10-01T00:00:00Z"


def test_ip_summary_abuseipdb_configured_true_when_key_set(tmp_path, monkeypatch):
    monkeypatch.setenv("ABUSEIPDB_API_KEY", "fake-key")
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', 't')")
    db.commit()
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/ip/1.2.3.4/summary")
    assert response.json()["abuseipdb_configured"] is True


def _on_event_loop() -> bool:
    import asyncio

    try:
        asyncio.get_running_loop()
        return True
    except RuntimeError:
        return False


class _LoopCheckingDb:
    """Records whether each query ran on the event loop: the shared connection is not thread-safe."""

    def __init__(self, conn):
        self._conn = conn
        self.off_loop_queries = []

    def execute(self, sql, *args):
        if not _on_event_loop():
            self.off_loop_queries.append(sql)
        return self._conn.execute(sql, *args)

    def __getattr__(self, name):
        return getattr(self._conn, name)


class _OffLoopFbanControl:
    """Fails the request if a blocking fail2ban round-trip runs on (and would stall) the event loop."""

    def __init__(self):
        self.on_loop_calls = []

    def _check(self, verb):
        if _on_event_loop():
            self.on_loop_calls.append(verb)

    def request_ban(self, ip, jail="sshd"):
        self._check("ban")

    def request_unban(self, ip, jail="sshd"):
        self._check("unban")

    def request_status(self, ip, jail="sshd"):
        self._check("status")
        return True


def test_ip_endpoints_keep_db_on_event_loop_and_fban_off_it(tmp_path):
    conn = connect(tmp_path / "db.sqlite3")
    conn.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', '2026-08-14T08:00:00Z')"
    )
    conn.commit()
    db = _LoopCheckingDb(conn)
    fban = _OffLoopFbanControl()
    client = TestClient(create_app(db=db, start_background_tasks=False, fban_control=fban))
    db.off_loop_queries.clear()  # startup backfills run outside any request

    headers = {"Origin": "http://testserver"}
    assert client.get("/api/ip/1.2.3.4/summary").status_code == 200
    assert client.post("/api/ip/1.2.3.4/ban", headers=headers).status_code == 200
    assert client.post("/api/ip/1.2.3.4/unban", headers=headers).status_code == 200

    assert db.off_loop_queries == []
    assert fban.on_loop_calls == []
