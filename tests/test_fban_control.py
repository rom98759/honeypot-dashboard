import threading
import time
from pathlib import Path

import pytest

from app.fban_control import FbanControl, FbanControlError, FbanProtected, FbanTimeout


def respond_after(queue_dir: Path, verb: str, response_text: str, delay: float = 0.02):
    """Simulate the host worker: wait for the matching request file, then
    write the response and delete the request, like fban-queue-worker.sh does."""

    def worker():
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            for req in queue_dir.glob("req-*"):
                content = req.read_text()
                if content.startswith(verb + " "):
                    request_id = req.name[len("req-"):]
                    (queue_dir / f"res-{request_id}").write_text(response_text)
                    req.unlink()
                    return
            time.sleep(delay)

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    return t


def test_request_ban_writes_validated_request_line(tmp_path):
    control = FbanControl(tmp_path)
    t = respond_after(tmp_path, "ban", "ok")
    control.request_ban("1.2.3.4")
    t.join(timeout=1)
    assert list(tmp_path.glob("req-*")) == []
    assert list(tmp_path.glob("res-*")) == []


def test_request_ban_rejects_invalid_ip(tmp_path):
    control = FbanControl(tmp_path)
    with pytest.raises(ValueError):
        control.request_ban("not-an-ip")
    assert list(tmp_path.glob("req-*")) == []


def test_request_ban_rejects_unknown_scope(tmp_path):
    control = FbanControl(tmp_path)
    with pytest.raises(ValueError):
        control.request_ban("1.2.3.4", "nginx")
    assert list(tmp_path.glob("req-*")) == []


@pytest.mark.parametrize(
    ("call", "line"),
    [
        (lambda c: c.request_ban("1.2.3.4"), "ban manual 1.2.3.4\n"),
        (lambda c: c.request_ban("1.2.3.4", "all"), "ban manual-all 1.2.3.4\n"),
        (lambda c: c.request_unban("1.2.3.4"), "unban all 1.2.3.4\n"),
        (lambda c: c.request_status("1.2.3.4"), "status all 1.2.3.4\n"),
    ],
)
def test_request_lines_match_the_worker_protocol(tmp_path, call, line):
    control = FbanControl(tmp_path, timeout=0.05, poll_interval=0.01)
    seen = []
    original = control._await_response

    def capture(request_id):
        seen.append((tmp_path / f"req-{request_id}").read_text())
        return original(request_id)

    control._await_response = capture
    try:
        call(control)
    except Exception:
        pass
    assert seen == [line]


def test_request_status_true_when_worker_lists_jails(tmp_path):
    control = FbanControl(tmp_path)
    respond_after(tmp_path, "status", "banned sshd,cowrie")
    assert control.request_status("1.2.3.4") is True


def test_request_ban_raises_fban_control_error_on_worker_error(tmp_path):
    control = FbanControl(tmp_path)
    respond_after(tmp_path, "ban", "error: fail2ban-client failed")
    with pytest.raises(FbanControlError):
        control.request_ban("1.2.3.4")


def test_request_ban_times_out_and_cleans_up_request_file(tmp_path):
    control = FbanControl(tmp_path, timeout=0.1, poll_interval=0.02)
    with pytest.raises(FbanTimeout):
        control.request_ban("1.2.3.4")
    assert list(tmp_path.glob("req-*")) == []


def test_request_unban_writes_validated_request_line(tmp_path):
    control = FbanControl(tmp_path)
    t = respond_after(tmp_path, "unban", "ok")
    control.request_unban("1.2.3.4")
    t.join(timeout=1)


def test_request_status_true_when_worker_reports_banned(tmp_path):
    control = FbanControl(tmp_path)
    respond_after(tmp_path, "status", "banned")
    assert control.request_status("1.2.3.4") is True


def test_request_status_false_when_worker_reports_not_banned(tmp_path):
    control = FbanControl(tmp_path)
    respond_after(tmp_path, "status", "not_banned")
    assert control.request_status("1.2.3.4") is False


def test_request_status_returns_none_on_timeout_without_raising(tmp_path):
    control = FbanControl(tmp_path, timeout=0.1, poll_interval=0.02)
    assert control.request_status("1.2.3.4") is None
    assert list(tmp_path.glob("req-*")) == []


def test_request_status_rejects_invalid_ip(tmp_path):
    control = FbanControl(tmp_path)
    with pytest.raises(ValueError):
        control.request_status("not-an-ip")


def test_request_ban_raises_protected_when_worker_refuses(tmp_path):
    control = FbanControl(tmp_path)
    t = respond_after(tmp_path, "ban", "protected")
    with pytest.raises(FbanProtected):
        control.request_ban("1.2.3.4")
    t.join(timeout=1)
