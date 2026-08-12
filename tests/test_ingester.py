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
    # 55 lines total, but only 6 event types are handled by parse_event:
    # session.connect(1) + login.success(1) + command.input(16) + log.closed(16)
    # + session.closed(1) = 35. The rest (client.version, client.kex,
    # session.params, command.failed, session.file_download) are parsed as
    # None and skipped — verified against the real fixture with a one-off count.
    assert applied == 35

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
