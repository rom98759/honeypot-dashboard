from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app

TTY = "var/lib/cowrie/tty/"
HASH_A, HASH_B, HASH_C, HASH_D, HASH_E, HASH_F = (c * 64 for c in "abcdef")


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000000Z")


def _client(tmp_path, extra=()):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    sessions = [*extra(now), *_default_sessions(now)] if extra else _default_sessions(now)
    for sid, ip, ts, ttylog, commands in sessions:
        db.execute("INSERT INTO sessions (session_id, src_ip, connect_time) VALUES (?, ?, ?)", (sid, ip, ts))
        if ttylog:
            db.execute(
                "INSERT INTO ttylogs (session_id, ttylog_path, close_time) VALUES (?, ?, 't')", (sid, TTY + ttylog)
            )
        for i, text in enumerate(commands):
            db.execute(
                "INSERT INTO commands (session_id, timestamp, input_text) VALUES (?, ?, ?)", (sid, f"t{i}", text)
            )
    db.executemany(
        "INSERT INTO ip_enrichment (ip, asn, asn_org, status) VALUES (?, ?, ?, 'done')",
        [("109.160.32.14", 198364, "Banatsync Srl"), ("109.160.32.88", 198364, "Banatsync Srl")],
    )
    db.commit()
    return TestClient(create_app(db=db, start_background_tasks=False))


def _default_sessions(now):
    return [
        ("s1", "109.160.32.14", _iso(now - timedelta(days=40)), HASH_A, ["uname -a", "id"]),
        ("s2", "109.160.32.88", _iso(now - timedelta(hours=1)), HASH_A, ["uname -a", "id"]),
        # Same commands, different terminal output: another variant of the same bot.
        ("s7", "109.160.32.99", _iso(now - timedelta(minutes=30)), HASH_D, ["uname -a", "id"]),
        ("s3", "203.0.113.5", _iso(now - timedelta(days=2)), HASH_B, ["echo OK"]),
        ("s5", "203.0.113.6", _iso(now - timedelta(days=1)), HASH_B, ["echo OK"]),
        # Random per-run marker: two fingerprints, one family once normalized.
        ("s8", "80.94.92.55", _iso(now - timedelta(hours=6)), HASH_E, ["echo check_0123456789abcdef"]),
        ("s9", "80.94.92.56", _iso(now - timedelta(hours=7)), HASH_F, ["echo check_fedcba9876543210"]),
        ("s6", "192.0.2.9", _iso(now - timedelta(hours=5)), HASH_C, ["cat /etc/passwd", "w"]),
        ("s4", "198.51.100.7", _iso(now - timedelta(hours=3)), None, []),  # login only, no shell
    ]


SCRIPT = ["echo check_0123456789abcdef", "nproc", "free -m", "uptime", "w"]


def _truncated_runs(now):
    # One script, cut after 5, 4 and 3 commands: one family. The 2-command run stays apart.
    return [
        ("t5", "45.0.0.1", _iso(now - timedelta(hours=2)), "1" * 64, SCRIPT),
        ("t4", "45.0.0.2", _iso(now - timedelta(hours=3)), "2" * 64, SCRIPT[:4]),
        ("t3", "45.0.0.3", _iso(now - timedelta(hours=4)), "3" * 64, SCRIPT[:3]),
        ("t2", "45.0.0.4", _iso(now - timedelta(hours=5)), "4" * 64, SCRIPT[:2]),
    ]


def test_truncated_runs_of_one_script_form_one_family(tmp_path):
    body = _client(tmp_path, extra=_truncated_runs).get("/api/campaigns").json()

    script = next(c for c in body["items"] if c["variants"] == 3)
    assert script["sessions"] == 3
    assert script["sample_session_id"] == "t5"
    assert script["sample_command"] == SCRIPT[0]


def test_runs_shorter_than_the_minimum_prefix_are_not_merged(tmp_path):
    body = _client(tmp_path, extra=_truncated_runs).get("/api/campaigns/unique").json()
    assert "t2" in {s["session_id"] for s in body["items"]}


def _by_command(body):
    return {c["sample_command"]: c for c in body["items"]}


def test_campaigns_merge_variants_into_families(tmp_path):
    body = _client(tmp_path).get("/api/campaigns").json()

    assert body["total"] == 3
    assert body["totals"] == {
        "campaigns": 3,
        "sessions": 9,
        "new_7d": 2,
        "unique_sessions": 1,
        "top_share": 3 / 9,
        "login_only": {"sessions": 1, "ips": 1},
    }
    uname = _by_command(body)["uname -a"]
    assert uname["sessions"] == 3
    assert uname["ips"] == 3
    assert uname["variants"] == 2
    assert uname["sample_session_id"] == "s7"  # most recent session across variants
    assert len(uname["activity"]) == 30
    assert sum(uname["activity"]) == 2  # s1 is older than the 30-day window
    check = _by_command(body)["echo check_0123456789abcdef"]
    assert (check["sessions"], check["variants"]) == (2, 2)


def test_campaign_list_sorts_by_recency(tmp_path):
    client = _client(tmp_path)
    by_last = client.get("/api/campaigns?sort=last_seen").json()["items"]
    assert [c["sample_session_id"] for c in by_last] == ["s7", "s8", "s5"]
    by_first = client.get("/api/campaigns?sort=first_seen").json()["items"]
    assert [c["sample_session_id"] for c in by_first] == ["s8", "s5", "s7"]


def test_campaign_list_rejects_unknown_sort(tmp_path):
    assert _client(tmp_path).get("/api/campaigns?sort=nope").status_code == 400


def test_campaign_detail_reports_dominant_asn_prefix_and_variants(tmp_path):
    client = _client(tmp_path)
    family_id = _by_command(client.get("/api/campaigns").json())["uname -a"]["id"]

    body = client.get(f"/api/campaigns/{family_id}").json()

    assert body["sessions"] == 3
    assert body["top_asn"] == {"asn": 198364, "asn_org": "Banatsync Srl", "share": 2 / 3}
    assert body["top_prefix"] == {"prefix": "109.160.32.0/24", "share": 1.0}
    assert body["sample_session_id"] == "s7"
    assert [c["input_text"] for c in body["commands"]] == ["uname -a", "id"]
    assert [ip["ip"] for ip in body["top_ips"]] == ["109.160.32.14", "109.160.32.88", "109.160.32.99"]
    assert body["variant_count"] == 2
    assert {v["id"]: v["sessions"] for v in body["variants"]} == {HASH_A: 2, HASH_D: 1}


def test_campaign_detail_unknown_or_malformed_id(tmp_path):
    client = _client(tmp_path)
    assert client.get(f"/api/campaigns/{'9' * 64}").status_code == 404
    assert client.get("/api/campaigns/not-a-hash").status_code == 404


def test_unique_sessions_exclude_merged_variants(tmp_path):
    body = _client(tmp_path).get("/api/campaigns/unique").json()

    assert body["total"] == 1
    (item,) = body["items"]
    assert item["session_id"] == "s6"
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
    family_id = client.get("/api/campaigns").json()["items"][0]["id"]

    for _ in range(2):
        client.get("/api/campaigns?sort=ips")
        client.get(f"/api/campaigns/{family_id}")

    assert calls == {"page": 2, "detail": 1}  # default sort page + sort=ips page, each once
