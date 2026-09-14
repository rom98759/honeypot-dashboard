import re
import time
import uuid
from pathlib import Path

IP_RE = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$")
JAIL_WHITELIST = {"sshd"}


class FbanControlError(Exception):
    """The host worker reported a failure, or a request could not be validated."""


class FbanTimeout(FbanControlError):
    """No response file appeared within the configured timeout."""


def _validate(ip: str, jail: str) -> None:
    if jail not in JAIL_WHITELIST:
        raise ValueError(f"jail not whitelisted: {jail!r}")
    if not IP_RE.match(ip):
        raise ValueError(f"invalid ip: {ip!r}")


class FbanControl:
    """
    Talks to the host-side fail2ban worker (scripts/fban-queue-worker.sh) via a
    bind-mounted directory: writes a `req-<id>` file, polls for the matching
    `res-<id>` file. The container never gets a socket or capability toward
    fail2ban itself — see docs/superpowers/specs/2026-09-14-fban-control-design.md.
    """

    def __init__(self, queue_dir: Path, timeout: float = 2.0, poll_interval: float = 0.05):
        self.queue_dir = Path(queue_dir)
        self.timeout = timeout
        self.poll_interval = poll_interval
        self.queue_dir.mkdir(parents=True, exist_ok=True)

    def _write_request(self, verb: str, ip: str, jail: str) -> str:
        _validate(ip, jail)
        request_id = uuid.uuid4().hex
        final_path = self.queue_dir / f"req-{request_id}"
        tmp_path = self.queue_dir / f".req-{request_id}.tmp"
        tmp_path.write_text(f"{verb} {jail} {ip}\n")
        tmp_path.rename(final_path)  # atomic on the same filesystem
        return request_id

    def _await_response(self, request_id: str) -> str | None:
        req_path = self.queue_dir / f"req-{request_id}"
        res_path = self.queue_dir / f"res-{request_id}"
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            if res_path.exists():
                content = res_path.read_text().strip()
                res_path.unlink(missing_ok=True)
                return content
            time.sleep(self.poll_interval)
        req_path.unlink(missing_ok=True)  # nobody will ever process this now
        return None

    def _request_action(self, verb: str, ip: str, jail: str) -> None:
        try:
            request_id = self._write_request(verb, ip, jail)
            result = self._await_response(request_id)
        except OSError as exc:
            raise FbanControlError(str(exc)) from exc
        if result is None:
            raise FbanTimeout(f"no response for {verb} {ip}")
        if result != "ok":
            raise FbanControlError(result)

    def request_ban(self, ip: str, jail: str = "sshd") -> None:
        self._request_action("ban", ip, jail)

    def request_unban(self, ip: str, jail: str = "sshd") -> None:
        self._request_action("unban", ip, jail)

    def request_status(self, ip: str, jail: str = "sshd") -> bool | None:
        _validate(ip, jail)
        try:
            request_id = self._write_request("status", ip, jail)
            result = self._await_response(request_id)
        except OSError:
            return None  # queue mechanism unavailable: caller falls back
        if result == "banned":
            return True
        if result == "not_banned":
            return False
        return None  # timeout or unexpected worker response: caller falls back
