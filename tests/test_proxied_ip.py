from datetime import datetime, timezone

from app.correlation import get_correlation_rows
from app.db import connect
from app.overview_stats import get_overview_stats
from app.proxied_ip import PROXIED_SOURCE_IP, gateway_ip
from app.session_files import file_detail

GATEWAY = "172.21.0.1"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_gateway_is_first_host_of_subnet():
    assert gateway_ip("172.30.0.0/16") == "172.30.0.1"
    assert gateway_ip(" 10.5.0.0/24 ") == "10.5.0.1"


def test_gateway_defaults_and_rejects_garbage():
    assert gateway_ip(None) == GATEWAY
    assert gateway_ip("") == GATEWAY
    assert gateway_ip("not-a-subnet") is None
    assert gateway_ip("10.0.0.0/31") is None


def test_default_proxied_source_ip():
    assert PROXIED_SOURCE_IP == GATEWAY


def _db(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    rows = [("g1", GATEWAY), ("g2", GATEWAY), ("g3", GATEWAY), ("a1", "203.0.113.5")]
    db.executemany(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES (?, ?, ?)",
        [(sid, ip, NOW) for sid, ip in rows],
    )
    db.commit()
    return db


def test_gateway_sessions_count_but_do_not_rank(tmp_path):
    stats = get_overview_stats(_db(tmp_path), "all")
    assert stats["total_connections"] == 4
    assert [r["src_ip"] for r in stats["top_offenders"]] == ["203.0.113.5"]


def test_gateway_is_not_a_correlation_row(tmp_path):
    rows = get_correlation_rows(_db(tmp_path))
    assert [r["ip"] for r in rows] == ["203.0.113.5"]


def test_gateway_is_not_a_top_ip_for_a_file(tmp_path):
    db = _db(tmp_path)
    sha = "a" * 64
    db.executemany(
        "INSERT INTO session_files (session_id, timestamp, kind, shasum) VALUES (?, ?, 'download', ?)",
        [("g1", NOW, sha), ("a1", NOW, sha)],
    )
    db.commit()
    detail = file_detail(db, tmp_path, sha)
    assert [r["ip"] for r in detail["top_ips"]] == ["203.0.113.5"]
