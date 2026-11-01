from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app

HASH_A = "a" * 64
HASH_B = "b" * 64
HASH_C = "c" * 64


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000000Z")


def _client(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=40)
    sessions = [
        ("s1", "109.160.32.14", _iso(old)),
        ("s2", "109.160.32.88", _iso(now - timedelta(hours=1))),
        ("s3", "203.0.113.5", _iso(now - timedelta(days=2))),
        ("s4", "198.51.100.7", _iso(now - timedelta(hours=3))),  # login only, no shell
        ("s5", "203.0.113.6", _iso(now - timedelta(days=1))),
        ("s6", "192.0.2.9", _iso(now - timedelta(hours=5))),  # one-off behaviour, not a campaign
    ]
    db.executemany("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES (?, ?, ?)", sessions)
    db.executemany(
        "INSERT INTO ttylogs (session_id, ttylog_path, close_time) VALUES (?, ?, 't')",
        [("s1", f"var/lib/cowrie/tty/{HASH_A}"), ("s2", f"var/lib/cowrie/tty/{HASH_A}"),
         ("s3", f"var/lib/cowrie/tty/{HASH_B}"), ("s5", f"var/lib/cowrie/tty/{HASH_B}"),
         ("s6", f"var/lib/cowrie/tty/{HASH_C}")],
    )
    db.executemany(
        "INSERT INTO commands (session_id, timestamp, input_text) VALUES (?, ?, ?)",
        [("s1", "t1", "uname -a"), ("s2", "t1", "uname -a"), ("s2", "t2", "id"),
         ("s3", "t1", "echo OK"), ("s6", "t1", "cat /etc/passwd"), ("s6", "t2", "w")],
    )
    db.executemany(
        "INSERT INTO ip_enrichment (ip, asn, asn_org, status) VALUES (?, ?, ?, 'done')",
        [("109.160.32.14", 198364, "Banatsync Srl"), ("109.160.32.88", 198364, "Banatsync Srl")],
    )
    db.commit()
    return TestClient(create_app(db=db, start_background_tasks=False))


def test_campaign_list_groups_sessions_by_ttylog_hash(tmp_path):
    body = _client(tmp_path).get("/api/campaigns").json()

    assert body["total"] == 2
    assert body["totals"] == {
        "campaigns": 2,
        "sessions": 6,
        "new_7d": 1,
        "unique_sessions": 1,
        "top_share": 2 / 6,
        "login_only": {"sessions": 1, "ips": 1},
    }
    first, second = body["items"]
    assert first["id"] == HASH_A
    assert first["sessions"] == 2
    assert first["ips"] == 2
    assert first["share"] == 2 / 6
    assert first["sample_session_id"] == "s2"  # most recent session of the campaign
    assert first["sample_command"] == "uname -a"
    assert len(first["activity"]) == 30
    assert sum(first["activity"]) == 1  # s1 is older than the 30-day window
    assert second["id"] == HASH_B


def test_campaign_list_sorts_by_recency(tmp_path):
    client = _client(tmp_path)
    body = client.get("/api/campaigns?sort=last_seen").json()
    assert [c["id"] for c in body["items"]] == [HASH_A, HASH_B]
    body = client.get("/api/campaigns?sort=first_seen").json()
    assert [c["id"] for c in body["items"]] == [HASH_B, HASH_A]


def test_campaign_list_rejects_unknown_sort(tmp_path):
    assert _client(tmp_path).get("/api/campaigns?sort=nope").status_code == 400


def test_campaign_detail_reports_dominant_asn_and_prefix(tmp_path):
    body = _client(tmp_path).get(f"/api/campaigns/{HASH_A}").json()

    assert body["sessions"] == 2
    assert body["top_asn"] == {"asn": 198364, "asn_org": "Banatsync Srl", "share": 1.0}
    assert body["top_prefix"] == {"prefix": "109.160.32.0/24", "share": 1.0}
    assert body["sample_session_id"] == "s2"
    assert [c["input_text"] for c in body["commands"]] == ["uname -a", "id"]
    assert [ip["ip"] for ip in body["top_ips"]] == ["109.160.32.14", "109.160.32.88"]


def test_campaign_detail_unknown_or_malformed_id(tmp_path):
    client = _client(tmp_path)
    assert client.get(f"/api/campaigns/{'d' * 64}").status_code == 404
    assert client.get("/api/campaigns/not-a-hash").status_code == 404


def test_unique_sessions_lists_one_off_fingerprints_by_command_count(tmp_path):
    body = _client(tmp_path).get("/api/campaigns/unique").json()

    assert body["total"] == 1
    (item,) = body["items"]
    assert item["session_id"] == "s6"
    assert item["src_ip"] == "192.0.2.9"
    assert item["commands"] == 2
    assert item["first_command"] == "cat /etc/passwd"


def test_unique_sessions_rejects_unknown_sort(tmp_path):
    assert _client(tmp_path).get("/api/campaigns/unique?sort=nope").status_code == 400


def test_campaign_page_and_detail_are_cached(tmp_path, monkeypatch):
    import app.routers.campaigns as router

    calls = {"page": 0, "detail": 0}
    real_page, real_detail = router.campaign_page, router.campaign_detail

    def counting_page(*args, **kwargs):
        calls["page"] += 1
        return real_page(*args, **kwargs)

    def counting_detail(*args, **kwargs):
        calls["detail"] += 1
        return real_detail(*args, **kwargs)

    monkeypatch.setattr(router, "campaign_page", counting_page)
    monkeypatch.setattr(router, "campaign_detail", counting_detail)
    client = _client(tmp_path)

    for _ in range(2):
        client.get("/api/campaigns?sort=ips")
        client.get(f"/api/campaigns/{HASH_A}")

    assert calls == {"page": 1, "detail": 1}
