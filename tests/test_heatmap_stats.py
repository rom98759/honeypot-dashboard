from datetime import datetime, timezone

from app.db import connect
from app.heatmap_stats import get_heatmap_stats


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_extracts_day_of_week_and_hour(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    # 2026-08-16 is a Sunday; SQLite's strftime('%w') convention is 0 = Sunday.
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', ?)",
        ("2026-08-16T03:15:00Z",),
    )
    db.commit()

    cells = get_heatmap_stats(db)
    assert cells == [{"day_of_week": 0, "hour": 3, "n": 1}]


def test_groups_multiple_sessions_in_the_same_cell(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executemany(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES (?, '1.2.3.4', ?)",
        [
            ("s1", "2026-08-16T03:00:00Z"),
            ("s2", "2026-08-16T03:45:00Z"),
            ("s3", "2026-08-17T03:00:00Z"),  # different day, same hour
        ],
    )
    db.commit()

    cells = get_heatmap_stats(db)
    by_key = {(c["day_of_week"], c["hour"]): c["n"] for c in cells}
    assert by_key[(0, 3)] == 2
    assert by_key[(1, 3)] == 1


def test_returns_empty_list_when_no_sessions(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    assert get_heatmap_stats(db) == []
