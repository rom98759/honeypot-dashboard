from app.db import connect
from app.tailer import LogTailer


def test_reads_only_new_complete_lines(tmp_path):
    log_path = tmp_path / "test.log"
    log_path.write_text("line1\nline2\n")
    db = connect(tmp_path / "db.sqlite3")
    tailer = LogTailer(db, "test-source", log_path)

    assert tailer.read_new_lines() == ["line1\n", "line2\n"]
    assert tailer.read_new_lines() == []  # nothing new

    with log_path.open("a") as f:
        f.write("line3\n")
    assert tailer.read_new_lines() == ["line3\n"]


def test_does_not_consume_partial_trailing_line(tmp_path):
    log_path = tmp_path / "test.log"
    log_path.write_text("complete\npartial")
    db = connect(tmp_path / "db.sqlite3")
    tailer = LogTailer(db, "test-source", log_path)

    assert tailer.read_new_lines() == ["complete\n"]

    with log_path.open("a") as f:
        f.write(" line\n")
    assert tailer.read_new_lines() == ["partial line\n"]


def test_survives_rotation(tmp_path):
    log_path = tmp_path / "test.log"
    log_path.write_text("old1\nold2\n")
    db = connect(tmp_path / "db.sqlite3")
    tailer = LogTailer(db, "test-source", log_path)
    assert tailer.read_new_lines() == ["old1\n", "old2\n"]

    log_path.unlink()
    log_path.write_text("new1\n")  # new inode, smaller than the old offset
    assert tailer.read_new_lines() == ["new1\n"]


def test_missing_file_returns_no_lines(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    tailer = LogTailer(db, "test-source", tmp_path / "missing.log")
    assert tailer.read_new_lines() == []
