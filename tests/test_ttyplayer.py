import json
from pathlib import Path

import pytest

from app.ttyplayer import TTYLogError, ttylogs_to_asciicast

FIXTURE = Path(__file__).parent / "fixtures" / "sample_ttylog.bin"


def test_converts_real_ttylog_to_asciicast():
    data = FIXTURE.read_bytes()
    cast = ttylogs_to_asciicast([data])
    lines = cast.strip().split("\n")

    header = json.loads(lines[0])
    assert header == {"version": 2, "width": 80, "height": 24, "timestamp": 1786530050}

    events = [json.loads(line) for line in lines[1:]]
    assert events == [
        [0.000364, "o", "\x1b[32mw\n\x1b[0m"],  # single TYPE_INTERACT frame: colored + newline-terminated
        [0.056544, "o", " 10:20:50 up 20 min,  1 user,  load average: 0.00, 0.00, 0.00\n"],
        [0.056849, "o", "USER     TTY      FROM              LOGIN@   IDLE   JCPU   PCPU WHAT\n"],
        [0.056963, "o", "ftpuser  pts/0    172.21.0.1        10:20    0.00s  0.00s  0.00s w\n"],
    ]


def test_concatenates_multiple_ttylogs_on_one_global_timeline():
    data = FIXTURE.read_bytes()
    cast = ttylogs_to_asciicast([data, data])
    lines = cast.strip().split("\n")
    events = [json.loads(line) for line in lines[1:]]
    assert len(events) == 8
    # the second file's frames must be offset by the real gap between the two
    # OP_OPEN timestamps (both files here happen to share the same clock,
    # so the fourth event of file 2 keeps increasing rather than resetting)
    assert events[4][0] > events[3][0]


def test_splits_large_single_event_into_smaller_chunks():
    import struct

    from app.ttyplayer import OP_CLOSE, OP_OPEN, OP_WRITE, TTYSTRUCT, TYPE_OUTPUT

    big_text = ("x" * 500).encode()  # exceeds the chunk size, no newlines
    frames = b""
    frames += struct.pack(TTYSTRUCT, OP_OPEN, 0, 0, 0, 1000, 0)
    frames += struct.pack(TTYSTRUCT, OP_WRITE, 0, len(big_text), TYPE_OUTPUT, 1000, 0) + big_text
    frames += struct.pack(TTYSTRUCT, OP_CLOSE, 0, 0, 0, 1001, 0)

    cast = ttylogs_to_asciicast([frames])
    lines = cast.strip().split("\n")
    events = [json.loads(line) for line in lines[1:]]

    assert len(events) > 1
    assert "".join(e[2] for e in events) == big_text.decode()
    timestamps = [e[0] for e in events]
    assert timestamps == sorted(timestamps)
    assert len(set(timestamps)) == len(timestamps)


def test_colorizes_and_newline_terminates_interact_command_before_output():
    import struct

    from app.ttyplayer import OP_CLOSE, OP_OPEN, OP_WRITE, TTYSTRUCT, TYPE_OUTPUT, TYPE_INTERACT

    command = b'printf \'FILTER:%s\\n\' "$filter_output"'  # no trailing newline, like a real bot payload
    output = b"-bash: syntax error: unexpected end of file\n"
    frames = b""
    frames += struct.pack(TTYSTRUCT, OP_OPEN, 0, 0, 0, 1000, 0)
    frames += struct.pack(TTYSTRUCT, OP_WRITE, 0, len(command), TYPE_INTERACT, 1000, 0) + command
    frames += struct.pack(TTYSTRUCT, OP_WRITE, 0, len(output), TYPE_OUTPUT, 1003, 700000) + output
    frames += struct.pack(TTYSTRUCT, OP_CLOSE, 0, 0, 0, 1004, 0)

    cast = ttylogs_to_asciicast([frames])
    lines = cast.strip().split("\n")
    events = [json.loads(line) for line in lines[1:]]

    command_text = "".join(e[2] for e in events[:-1])
    assert command_text == "\x1b[32m" + command.decode() + "\n\x1b[0m"
    assert events[-1][2] == output.decode()


def test_empty_list_raises():
    with pytest.raises(TTYLogError):
        ttylogs_to_asciicast([])


def test_truncated_frame_raises():
    with pytest.raises(TTYLogError):
        ttylogs_to_asciicast([b"\x01\x00\x00\x00\x00\x00"])  # shorter than one header
