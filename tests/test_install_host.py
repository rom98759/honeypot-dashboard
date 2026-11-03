import hashlib
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
INSTALLER = REPO / "scripts" / "install-host.sh"

UFW_ACTIVE_WITH_RULE = "Status: active\\n\\nTo Action From\\n-- ------ ----\\n50022/tcp LIMIT Anywhere\\n"
UFW_ACTIVE_NO_RULE = "Status: active\\n\\nTo Action From\\n-- ------ ----\\n80/tcp ALLOW Anywhere\\n"
UFW_INACTIVE = "Status: inactive\\n"


def _run(tmp_path, *args, sshd_ports="50022", ufw=UFW_ACTIVE_WITH_RULE, host_env=None):
    root = tmp_path / "root"
    root.mkdir(exist_ok=True)
    env_file = tmp_path / "host.env"
    env_file.write_text(host_env if host_env is not None else "SSHD_PORT=50022\n")
    env_file.chmod(0o600)
    env = {
        "PATH": os.environ["PATH"],
        "HONEYPOT_HOST_ENV": str(env_file),
        "SSHD_PORTS_CMD": f"printf '%s\\n' {sshd_ports}",
        "UFW_STATUS_CMD": f"printf '{ufw}'",
        "SYSTEMCTL": "true",
    }
    out = subprocess.run(
        ["bash", str(INSTALLER), "--root", str(root), *args],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return out, root


def _tree(root):
    digest = {}
    for path in sorted(root.rglob("*")):
        rel = str(path.relative_to(root))
        digest[rel] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else "dir"
    return digest


def test_aborts_when_sshd_on_22(tmp_path):
    out, root = _run(tmp_path, sshd_ports="22")
    assert out.returncode == 2
    assert "SSH LOCKOUT RISK" in out.stdout
    assert "1)" in out.stdout and "6)" in out.stdout
    assert _tree(root) == {}


def test_aborts_when_sshd_on_22_and_new_port(tmp_path):
    out, root = _run(tmp_path, sshd_ports="22 50022")
    assert out.returncode == 2
    assert "SSH LOCKOUT RISK" in out.stdout
    assert _tree(root) == {}


def test_aborts_when_sshd_port_is_22_in_config(tmp_path):
    out, root = _run(tmp_path, host_env="SSHD_PORT=22\n")
    assert out.returncode == 2
    assert "SSH LOCKOUT RISK" in out.stdout


def test_aborts_when_ufw_active_without_rule(tmp_path):
    out, root = _run(tmp_path, ufw=UFW_ACTIVE_NO_RULE)
    assert out.returncode == 2
    assert "ufw allow 50022/tcp" in out.stdout
    assert _tree(root) == {}


def test_warns_when_ufw_inactive(tmp_path):
    out, root = _run(tmp_path, ufw=UFW_INACTIVE)
    assert out.returncode == 0, out.stdout + out.stderr
    assert "provider" in out.stdout.lower()


def test_aborts_when_sshd_port_mismatch(tmp_path):
    out, root = _run(tmp_path, sshd_ports="40022")
    assert out.returncode == 2
    assert "40022" in out.stdout and "50022" in out.stdout
    assert _tree(root) == {}


def test_dry_run_writes_nothing(tmp_path):
    out, root = _run(tmp_path, "--dry-run")
    assert out.returncode == 0, out.stdout + out.stderr
    assert "would" in out.stdout
    assert "usr/local/sbin/docker-user-firewall.sh" in out.stdout
    assert _tree(root) == {}


def test_install_is_idempotent(tmp_path):
    out, root = _run(tmp_path)
    assert out.returncode == 0, out.stdout + out.stderr
    never_ban = root / "etc/honeypot/never-ban"
    never_ban.write_text("203.0.113.7\n")
    first = _tree(root)
    out, _ = _run(tmp_path)
    assert out.returncode == 0, out.stdout + out.stderr
    assert _tree(root) == first
    assert never_ban.read_text() == "203.0.113.7\n"
    for rel in [
        "usr/local/sbin/docker-user-firewall.sh",
        "usr/local/sbin/sshd-auth-export.sh",
        "etc/systemd/system/geoip-update.timer",
        "etc/logrotate.d/honeypot-export",
        "etc/fail2ban/jail.d/honeypot-sshd.conf",
    ]:
        assert rel in first, rel
    assert "port = 50022" in (root / "etc/fail2ban/jail.d/honeypot-sshd.conf").read_text()
    assert "usr/local/sbin/fban-queue-worker.sh" not in first
    # Compose always bind-mounts the queue dir: if Docker creates it, it is root-owned and
    # the non-root dashboard can never drop a request in it.
    assert first.get("opt/honeypot/fban-queue") == "dir"
    assert oct((root / "opt/honeypot/fban-queue").stat().st_mode & 0o777) == "0o770"


def test_ban_worker_only_when_enabled(tmp_path):
    out, root = _run(tmp_path, host_env="SSHD_PORT=50022\nFBAN_ENABLED=1\n")
    assert out.returncode == 0, out.stdout + out.stderr
    assert (root / "usr/local/sbin/fban-queue-worker.sh").exists()
    assert (root / "etc/systemd/system/fban-queue-worker.path").exists()


def test_keeps_existing_sshd_jail(tmp_path):
    root = tmp_path / "root"
    (root / "etc/fail2ban").mkdir(parents=True)
    (root / "etc/fail2ban/jail.local").write_text("[sshd]\nenabled = true\nport = 50022\n")
    out, root = _run(tmp_path)
    assert out.returncode == 0, out.stdout + out.stderr
    assert not (root / "etc/fail2ban/jail.d/honeypot-sshd.conf").exists()
    assert "existing sshd jail" in out.stdout


def test_debian_default_jail_does_not_count_as_existing(tmp_path):
    root = tmp_path / "root"
    (root / "etc/fail2ban/jail.d").mkdir(parents=True)
    (root / "etc/fail2ban/jail.d/defaults-debian.conf").write_text("[sshd]\nenabled = true\n")
    out, root = _run(tmp_path)
    assert out.returncode == 0, out.stdout + out.stderr
    assert (root / "etc/fail2ban/jail.d/honeypot-sshd.conf").exists()


def test_uninstall_removes_units_not_data(tmp_path):
    out, root = _run(tmp_path, host_env="SSHD_PORT=50022\nFBAN_ENABLED=1\n")
    assert out.returncode == 0
    (root / "etc/honeypot/never-ban").write_text("203.0.113.7\n")
    out, root = _run(tmp_path, "--uninstall", host_env="SSHD_PORT=50022\nFBAN_ENABLED=1\n")
    assert out.returncode == 0, out.stdout + out.stderr
    assert not (root / "usr/local/sbin/docker-user-firewall.sh").exists()
    assert not (root / "etc/systemd/system/fban-queue-worker.path").exists()
    assert not (root / "etc/fail2ban/jail.d/honeypot-sshd.conf").exists()
    assert (root / "etc/honeypot/never-ban").read_text() == "203.0.113.7\n"
    assert (root / "var/log/honeypot-export").is_dir()


def test_refuses_repo_dir_without_compose_file(tmp_path):
    out, root = _run(tmp_path, host_env=f"SSHD_PORT=50022\nREPO_DIR={tmp_path}\n")
    assert out.returncode != 0
    assert "REPO_DIR" in out.stdout + out.stderr
    assert _tree(root) == {}


def test_refuses_writable_host_env(tmp_path):
    out, root = _run(tmp_path)
    assert out.returncode == 0
    (tmp_path / "host.env").chmod(0o666)
    env = {
        "PATH": os.environ["PATH"],
        "HONEYPOT_HOST_ENV": str(tmp_path / "host.env"),
        "SSHD_PORTS_CMD": "printf 50022",
        "UFW_STATUS_CMD": "printf 'Status: inactive'",
        "SYSTEMCTL": "true",
    }
    out = subprocess.run(
        ["bash", str(INSTALLER), "--root", str(root)], env=env, capture_output=True, text=True, timeout=30
    )
    assert out.returncode != 0
    assert "writable" in out.stderr


def test_probe_overrides_ignored_outside_root(tmp_path):
    # A stray SSHD_PORTS_CMD (sudo -E) must never replace the real lockout check.
    env_file = tmp_path / "host.env"
    env_file.write_text("SSHD_PORT=50022\n")
    env_file.chmod(0o600)
    env = {
        "PATH": os.environ["PATH"],
        "HONEYPOT_HOST_ENV": str(env_file),
        "SSHD_PORTS_CMD": "printf 50022",
        "UFW_STATUS_CMD": "printf 'Status: inactive'",
    }
    out = subprocess.run(["bash", str(INSTALLER), "--dry-run"], env=env, capture_output=True, text=True, timeout=30)
    assert "would:" not in out.stdout
    assert out.returncode == 2
