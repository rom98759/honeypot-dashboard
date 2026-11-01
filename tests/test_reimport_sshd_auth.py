import gzip

from app.db import connect
from app.reimport_sshd_auth import reimport


def _rows(db):
    return [
        tuple(r)
        for r in db.execute("SELECT timestamp, ip, result FROM sshd_auth_events ORDER BY timestamp, ip")
    ]


def test_reimport_replaces_rows_in_covered_range_only(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sshd_auth_events (ip, result, timestamp) VALUES ('1.1.1.1', 'other', '2026-09-01T00:00:00+0000');
        INSERT INTO sshd_auth_events (ip, result, timestamp) VALUES ('192.0.2.77', 'invalid_user', '2026-10-10T10:00:00+0000');
        INSERT INTO sshd_auth_events (ip, result, timestamp) VALUES ('2.2.2.2', 'other', '2026-10-30T00:00:00+0000');
        """
    )
    db.commit()
    older = tmp_path / "sshd-auth.log.2.gz"
    with gzip.open(older, "wt") as f:
        f.write("2026-10-10T10:00:00+0000 vps sshd[1]: Invalid user 192.0.2.77 from 203.0.113.5 port 4444\n")
    newer = tmp_path / "sshd-auth.log.1"
    newer.write_text(
        "2026-10-20T08:00:00+0000 vps sshd[2]: Failed password for root from 203.0.113.6 port 22 ssh2\n"
        "2026-10-20T08:00:01+0000 vps sshd[2]: pam_unix(sshd:session): session closed for user labmon\n"
    )

    summary = reimport(db, [newer, older])

    assert summary == {
        "from": "2026-10-10T10:00:00+0000",
        "to": "2026-10-20T08:00:00+0000",
        "deleted": 1,
        "inserted": 2,
    }
    assert _rows(db) == [
        ("2026-09-01T00:00:00+0000", "1.1.1.1", "other"),
        ("2026-10-10T10:00:00+0000", "203.0.113.5", "invalid_user"),
        ("2026-10-20T08:00:00+0000", "203.0.113.6", "failed_password"),
        ("2026-10-30T00:00:00+0000", "2.2.2.2", "other"),
    ]


def test_reimport_dry_run_changes_nothing(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    log = tmp_path / "sshd-auth.log.1"
    log.write_text("2026-10-20T08:00:00+0000 vps sshd[2]: Failed password for root from 203.0.113.6 port 22 ssh2\n")

    summary = reimport(db, [log], dry_run=True)

    assert summary["inserted"] == 1
    assert _rows(db) == []
