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
        [0.000364, "o", "w"],
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


def test_empty_list_raises():
    with pytest.raises(TTYLogError):
        ttylogs_to_asciicast([])


def test_truncated_frame_raises():
    with pytest.raises(TTYLogError):
        ttylogs_to_asciicast([b"\x01\x00\x00\x00\x00\x00"])  # shorter than one header
