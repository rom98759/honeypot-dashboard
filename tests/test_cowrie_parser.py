import json
from pathlib import Path

from app.cowrie_parser import (
    CommandInput,
    LoginAttempt,
    SessionClosed,
    SessionConnect,
    TTYLogClosed,
    parse_event,
)

FIXTURE = Path(__file__).parent / "fixtures" / "sample_session_events.jsonl"


def _load_events():
    with FIXTURE.open() as f:
        return [json.loads(line) for line in f]


def test_parses_session_connect():
    events = _load_events()
    record = parse_event(events[0])
    assert isinstance(record, SessionConnect)
    assert record.session_id == "f3a41d6cf03f"
    assert record.src_ip == "172.21.0.1"
    assert record.protocol == "ssh"


def test_parses_login_success():
    events = _load_events()
    login_event = next(e for e in events if e["eventid"] == "cowrie.login.success")
    record = parse_event(login_event)
    assert isinstance(record, LoginAttempt)
    assert record.username == "ftpuser"
    assert record.password == "12345"
    assert record.success is True


def test_parses_command_input():
    events = _load_events()
    cmd_event = next(
        e for e in events
        if e["eventid"] == "cowrie.command.input" and "chattr" in e.get("input", "")
    )
    record = parse_event(cmd_event)
    assert isinstance(record, CommandInput)
    assert record.input_text == "cd ~; chattr -ia .ssh; lockr -ia .ssh"


def test_parses_ttylog_closed():
    events = _load_events()
    tty_event = next(e for e in events if e["eventid"] == "cowrie.log.closed")
    record = parse_event(tty_event)
    assert isinstance(record, TTYLogClosed)
    assert record.session_id == "f3a41d6cf03f"
    assert record.ttylog_path.startswith("var/lib/cowrie/tty/")
    assert record.duration_ms == 106


def test_parses_session_closed():
    events = _load_events()
    record = parse_event(events[-1])
    assert isinstance(record, SessionClosed)
    assert record.duration_ms == 89065


def test_ignores_unrelated_event():
    record = parse_event({"eventid": "cowrie.client.version", "session": "x"})
    assert record is None
