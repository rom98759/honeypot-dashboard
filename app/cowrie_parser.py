from dataclasses import dataclass


@dataclass
class SessionConnect:
    session_id: str
    src_ip: str
    src_port: int
    protocol: str
    timestamp: str


@dataclass
class LoginAttempt:
    session_id: str
    username: str
    password: str
    success: bool
    timestamp: str


@dataclass
class CommandInput:
    session_id: str
    input_text: str
    timestamp: str


@dataclass
class TTYLogClosed:
    session_id: str
    ttylog_path: str
    size: int
    duration_ms: int
    timestamp: str


@dataclass
class SessionClosed:
    session_id: str
    duration_ms: int
    timestamp: str


def parse_event(event: dict):
    """Translate one raw Cowrie JSON event into a typed record, or None if irrelevant."""
    eventid = event.get("eventid")
    session_id = event.get("session")
    timestamp = event.get("timestamp")

    if eventid == "cowrie.session.connect":
        return SessionConnect(
            session_id=session_id,
            src_ip=event.get("src_ip", ""),
            src_port=event.get("src_port", 0),
            protocol=event.get("protocol", "ssh"),
            timestamp=timestamp,
        )
    if eventid in ("cowrie.login.success", "cowrie.login.failed"):
        return LoginAttempt(
            session_id=session_id,
            username=event.get("username", ""),
            password=event.get("password", ""),
            success=eventid == "cowrie.login.success",
            timestamp=timestamp,
        )
    if eventid == "cowrie.command.input":
        return CommandInput(
            session_id=session_id,
            input_text=event.get("input", ""),
            timestamp=timestamp,
        )
    if eventid == "cowrie.log.closed":
        return TTYLogClosed(
            session_id=session_id,
            ttylog_path=event.get("ttylog", ""),
            size=event.get("size", 0),
            duration_ms=event.get("duration_ms", 0),
            timestamp=timestamp,
        )
    if eventid == "cowrie.session.closed":
        return SessionClosed(
            session_id=session_id,
            duration_ms=event.get("duration_ms", 0),
            timestamp=timestamp,
        )
    return None
