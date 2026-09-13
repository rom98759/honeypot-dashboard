import json
import struct

TTYSTRUCT = "<iLiiLL"
_STRUCT_SIZE = struct.calcsize(TTYSTRUCT)

OP_OPEN, OP_CLOSE, OP_WRITE, OP_EXEC = 1, 2, 3, 4
TYPE_INPUT, TYPE_OUTPUT, TYPE_INTERACT = 1, 2, 3

# A single WRITE frame can carry many KB of text in one instant timestamp (e.g. a
# bot's whole exec payload echoed back as one blob). Rendering that as one asciinema
# event forces the player to paint it synchronously, which can eat into the delay
# before the next event and make playback look time-shifted. Splitting it into
# fixed-size chunks spread a hair apart gives the player room to paint incrementally.
CHUNK_SIZE = 400
CHUNK_STEP_SECONDS = 0.01

# One-shot exec commands (TYPE_INTERACT) are echoed back as a single raw blob with no
# terminal-echoed Enter keystroke, so they can run straight into the next OUTPUT frame
# with no newline in between. Color the command green (like a shell prompt) and make
# sure it ends with a newline before the response follows.
_COLOR_COMMAND = "\x1b[32m"
_COLOR_RESET = "\x1b[0m"


class TTYLogError(Exception):
    """Raised when a Cowrie TTY log is empty, truncated, or malformed."""


def _parse_frames(data: bytes):
    frames = []
    pos = 0
    while pos < len(data):
        header = data[pos : pos + _STRUCT_SIZE]
        if len(header) < _STRUCT_SIZE:
            raise TTYLogError(f"truncated frame header at offset {pos}")
        op, tty, length, direction, sec, usec = struct.unpack(TTYSTRUCT, header)
        pos += _STRUCT_SIZE
        payload = data[pos : pos + length]
        if len(payload) < length:
            raise TTYLogError(f"truncated frame payload at offset {pos}")
        pos += length
        frames.append((op, tty, direction, sec + usec / 1_000_000, payload))
    return frames


def _select_events(frames):
    """Mirror playlog's stream selection: prefdir + always-shown TYPE_INTERACT."""
    prefdir = 0
    events = []
    for op, _tty, direction, timestamp, payload in frames:
        if op == OP_CLOSE:
            break
        if op != OP_WRITE:
            continue
        if prefdir == 0 and direction != TYPE_INTERACT:
            prefdir = direction
        if direction == prefdir or direction == TYPE_INTERACT:
            events.append((timestamp, direction, payload.decode("utf-8", errors="replace")))
    return events


def ttylogs_to_asciicast(ttylog_blobs: list[bytes], width: int = 80, height: int = 24) -> str:
    """
    Convert one or more raw Cowrie ttylog byte blobs (chronologically ordered)
    into a single asciinema v2 (.cast) JSONL string. Cowrie frame timestamps
    are real Unix epoch time, so concatenating multiple files' events on one
    global timeline preserves the real gaps between commands.
    """
    all_events = []
    session_starts = []  # Track OP_OPEN timestamps for each blob

    for data in ttylog_blobs:
        frames = _parse_frames(data)
        if not frames:
            continue
        # Find OP_OPEN frame to get session start time
        session_start = None
        for op, _tty, _direction, timestamp, _payload in frames:
            if op == OP_OPEN:
                session_start = timestamp
                break
        if session_start is not None:
            session_starts.append(session_start)
        all_events.extend(_select_events(frames))

    if not all_events:
        raise TTYLogError("no replayable frames in any ttylog")

    if not session_starts:
        raise TTYLogError("no session start (OP_OPEN) found in any ttylog")

    all_events.sort(key=lambda e: e[0])
    start_time = min(session_starts)

    header = {"version": 2, "width": width, "height": height, "timestamp": int(start_time)}
    lines = [json.dumps(header)]
    for timestamp, direction, text in all_events:
        elapsed = round(timestamp - start_time, 6)
        if direction == TYPE_INTERACT and not text.endswith("\n"):
            text += "\n"
        chunks = _chunk_text(text)
        for chunk_index, chunk in enumerate(chunks):
            if direction == TYPE_INTERACT:
                if chunk_index == 0:
                    chunk = _COLOR_COMMAND + chunk
                if chunk_index == len(chunks) - 1:
                    chunk += _COLOR_RESET
            lines.append(json.dumps([round(elapsed + chunk_index * CHUNK_STEP_SECONDS, 6), "o", chunk]))

    return "\n".join(lines) + "\n"


def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE) -> list[str]:
    return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)] or [text]
