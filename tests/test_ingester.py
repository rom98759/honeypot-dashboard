import shutil
from pathlib import Path

from app.db import connect
from app.ingester import CowrieIngester

FIXTURE = Path(__file__).parent / "fixtures" / "sample_session_events.jsonl"


def test_ingests_real_session_fixture(tmp_path):
    cowrie_json = tmp_path / "cowrie.json"
    shutil.copy(FIXTURE, cowrie_json)
    db = connect(tmp_path / "db.sqlite3")
    ingester = CowrieIngester(db, cowrie_json)

    applied = ingester.tick()
    # 55 lines total, but only these event types are handled by parse_event:
    # session.connect(1) + login.success(1) + command.input(16) + log.closed(16)
    # + session.file_download(1) + session.closed(1) = 36. The rest (client.version,
    # client.kex, session.params, command.failed) are parsed as None and skipped.
    assert applied == 36

    session = db.execute(
        "SELECT * FROM sessions WHERE session_id = 'f3a41d6cf03f'"
    ).fetchone()
    assert session["src_ip"] == "172.21.0.1"
    assert session["login_username"] == "ftpuser"
    assert session["login_success"] == 1
    assert session["duration_ms"] == 89065

    command_count = db.execute(
        "SELECT COUNT(*) AS n FROM commands WHERE session_id = 'f3a41d6cf03f'"
    ).fetchone()["n"]
    assert command_count == 16

    ttylog_count = db.execute(
        "SELECT COUNT(*) AS n FROM ttylogs WHERE session_id = 'f3a41d6cf03f'"
    ).fetchone()["n"]
    assert ttylog_count == 16


def test_second_tick_with_no_new_data_applies_nothing(tmp_path):
    cowrie_json = tmp_path / "cowrie.json"
    shutil.copy(FIXTURE, cowrie_json)
    db = connect(tmp_path / "db.sqlite3")
    ingester = CowrieIngester(db, cowrie_json)

    ingester.tick()
    assert ingester.tick() == 0


def test_session_connect_triggers_geo_lookup(tmp_path):
    class _StubGeoLookup:
        def __init__(self):
            self.looked_up_ips = []

        def lookup(self, ip):
            self.looked_up_ips.append(ip)

    cowrie_json = tmp_path / "cowrie.json"
    shutil.copy(FIXTURE, cowrie_json)
    db = connect(tmp_path / "db.sqlite3")
    geo_lookup = _StubGeoLookup()
    ingester = CowrieIngester(db, cowrie_json, geo_lookup=geo_lookup)

    ingester.tick()

    assert geo_lookup.looked_up_ips == ["172.21.0.1"]


def test_ingestion_works_without_a_geo_lookup(tmp_path):
    cowrie_json = tmp_path / "cowrie.json"
    shutil.copy(FIXTURE, cowrie_json)
    db = connect(tmp_path / "db.sqlite3")
    ingester = CowrieIngester(db, cowrie_json)

    assert ingester.tick() == 36


def test_picks_up_appended_lines(tmp_path):
    cowrie_json = tmp_path / "cowrie.json"
    lines = FIXTURE.read_text().splitlines(keepends=True)
    cowrie_json.write_text("".join(lines[:5]))
    db = connect(tmp_path / "db.sqlite3")
    ingester = CowrieIngester(db, cowrie_json)

    # lines[:5] = session.connect, client.version, client.kex, login.success,
    # session.params — only 2 of those 5 event types are handled
    assert ingester.tick() == 2
    with cowrie_json.open("a") as f:
        f.write(lines[5])  # command.input — handled
    assert ingester.tick() == 1


def test_session_connect_inserts_pending_row_for_new_ip(tmp_path):
    cowrie_json = tmp_path / "cowrie.json"
    shutil.copy(FIXTURE, cowrie_json)
    db = connect(tmp_path / "db.sqlite3")
    ingester = CowrieIngester(db, cowrie_json)

    ingester.tick()

    row = db.execute("SELECT status FROM ip_enrichment WHERE ip = '172.21.0.1'").fetchone()
    assert row is not None
    assert row["status"] == "pending"


def test_session_connect_does_not_reset_an_already_done_row(tmp_path):
    cowrie_json = tmp_path / "cowrie.json"
    shutil.copy(FIXTURE, cowrie_json)
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO ip_enrichment (ip, status, asn) VALUES ('172.21.0.1', 'done', 12345)"
    )
    db.commit()
    ingester = CowrieIngester(db, cowrie_json)

    ingester.tick()

    row = db.execute("SELECT status, asn FROM ip_enrichment WHERE ip = '172.21.0.1'").fetchone()
    assert row["status"] == "done"
    assert row["asn"] == 12345


def test_two_sessions_same_new_ip_do_not_duplicate_enrichment_row(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    from app.cowrie_parser import SessionConnect
    from app.ingester import apply_cowrie_record

    first = SessionConnect(session_id="s1", src_ip="9.9.9.9", src_port=1234, protocol="ssh", timestamp="t1")
    second = SessionConnect(session_id="s2", src_ip="9.9.9.9", src_port=5678, protocol="ssh", timestamp="t2")
    apply_cowrie_record(db, first)
    apply_cowrie_record(db, second)  # must not raise on the PK conflict
    db.commit()

    count = db.execute("SELECT COUNT(*) AS n FROM ip_enrichment WHERE ip = '9.9.9.9'").fetchone()["n"]
    assert count == 1
