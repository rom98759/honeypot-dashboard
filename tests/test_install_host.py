import hashlib
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
INSTALLER = REPO / "scripts" / "install-host.sh"

UFW_ACTIVE_WITH_RULE = "Status: active\\n\\nTo Action From\\n-- ------ ----\\n50022/tcp LIMIT Anywhere\\n"
UFW_ACTIVE_NO_RULE = "Status: active\\n\\nTo Action From\\n-- ------ ----\\n80/tcp ALLOW Anywhere\\n"
UFW_INACTIVE = "Status: inactive\\n"


def _run(tmp_path, *args, sshd_ports="50022", ufw=UFW_ACTIVE_WITH_RULE, host_env=None, extra_env=None, fake_bin=None):
    root = tmp_path / "root"
    root.mkdir(exist_ok=True)
    env_file = tmp_path / "host.env"
    env_file.write_text(host_env if host_env is not None else "SSHD_PORT=50022\n")
    env_file.chmod(0o600)
    env = {
        "PATH": f"{fake_bin}:{os.environ['PATH']}" if fake_bin else os.environ["PATH"],
        "HONEYPOT_HOST_ENV": str(env_file),
        "UFW_STATUS_CMD": f"printf '{ufw}'",
        "SYSTEMCTL": "true",
        **(extra_env or {}),
    }
    if sshd_ports is not None:
        env["SSHD_PORTS_CMD"] = f"printf '%s\\n' {sshd_ports}"
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
    # The jail's ignoreip follows never-ban, so it changes once, then stays put.
    out, _ = _run(tmp_path)
    assert "203.0.113.7" in (root / "etc/fail2ban/jail.d/honeypot.local").read_text()
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
        "etc/fail2ban/jail.d/honeypot.local",
        "etc/fail2ban/action.d/honeypot-block.conf",
        "etc/fail2ban/filter.d/honeypot-cowrie.conf",
        "usr/local/sbin/honeypot-ban.sh",
    ]:
        assert rel in first, rel
    assert "port = 50022" in (root / "etc/fail2ban/jail.d/honeypot.local").read_text()
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


def test_jail_overrides_jail_local_and_drops_the_legacy_file(tmp_path):
    root = tmp_path / "root"
    (root / "etc/fail2ban/jail.d").mkdir(parents=True)
    (root / "etc/fail2ban/jail.local").write_text("[sshd]\nenabled = true\nport = 50022\n")
    (root / "etc/fail2ban/jail.d/honeypot-sshd.conf").write_text("[sshd]\nenabled = true\n")
    out, root = _run(tmp_path)
    assert out.returncode == 0, out.stdout + out.stderr
    # jail.d/*.local is read after jail.local: the owner's file stays as is and ours wins.
    assert (root / "etc/fail2ban/jail.local").read_text() == "[sshd]\nenabled = true\nport = 50022\n"
    assert (root / "etc/fail2ban/jail.d/honeypot.local").exists()
    assert not (root / "etc/fail2ban/jail.d/honeypot-sshd.conf").exists()


def test_jail_ignores_never_ban_and_the_honeypot_network(tmp_path):
    root = tmp_path / "root"
    (root / "etc/honeypot").mkdir(parents=True)
    (root / "etc/honeypot/never-ban").write_text("# me\n203.0.113.7  # box\n\n198.51.100.0/24\nnot an ip\n")
    repo = _repo_with_env(tmp_path, "HONEYPOT_SUBNET=172.30.0.0/16\n")
    out, root = _run(tmp_path, host_env=f"SSHD_PORT=50022\nREPO_DIR={repo}\nHONEYPOT_SUBNET=172.30.0.0/16\n")
    assert out.returncode == 0, out.stdout + out.stderr
    jail = (root / "etc/fail2ban/jail.d/honeypot.local").read_text()
    assert "ignoreip = 127.0.0.1/8 ::1 172.30.0.0/16 203.0.113.7 198.51.100.0/24\n" in jail


def test_cowrie_jail_follows_the_log_file(tmp_path):
    host_env = "SSHD_PORT=50022\nCOWRIE_JSON=/srv/cowrie/cowrie.json\n"
    out, root = _run(tmp_path, host_env=host_env)
    assert out.returncode == 0, out.stdout + out.stderr
    cowrie = (root / "etc/fail2ban/jail.d/honeypot.local").read_text().split("[cowrie]")[1].split("[")[0]
    assert "enabled = false" in cowrie
    assert "cowrie jail disabled" in out.stdout

    (root / "srv/cowrie").mkdir(parents=True)
    (root / "srv/cowrie/cowrie.json").write_text("")
    out, root = _run(tmp_path, host_env=host_env)
    cowrie = (root / "etc/fail2ban/jail.d/honeypot.local").read_text().split("[cowrie]")[1].split("[")[0]
    assert "enabled = true" in cowrie
    assert "logpath = /srv/cowrie/cowrie.json" in cowrie


def test_uninstall_removes_units_not_data(tmp_path):
    out, root = _run(tmp_path, host_env="SSHD_PORT=50022\nFBAN_ENABLED=1\n")
    assert out.returncode == 0
    (root / "etc/honeypot/never-ban").write_text("203.0.113.7\n")
    out, root = _run(tmp_path, "--uninstall", host_env="SSHD_PORT=50022\nFBAN_ENABLED=1\n")
    assert out.returncode == 0, out.stdout + out.stderr
    assert not (root / "usr/local/sbin/docker-user-firewall.sh").exists()
    assert not (root / "etc/systemd/system/fban-queue-worker.path").exists()
    assert not (root / "etc/fail2ban/jail.d/honeypot.local").exists()
    assert not (root / "etc/fail2ban/action.d/honeypot-block.conf").exists()
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


def test_downloads_perms_units_follow_cowrie_volume(tmp_path):
    out, root = _run(tmp_path)
    assert out.returncode == 0, out.stdout + out.stderr
    downloads = "/var/lib/docker/volumes/honeypot-cowrie-var/_data/lib/cowrie/downloads"
    path_unit = (root / "etc/systemd/system/cowrie-downloads-perms.path").read_text()
    service = (root / "etc/systemd/system/cowrie-downloads-perms.service").read_text()
    assert f"PathChanged={downloads}\n" in path_unit
    assert f"ExecStart=/usr/local/sbin/cowrie-downloads-perms.py {downloads}\n" in service
    assert "@" not in path_unit + service
    assert os.access(root / "usr/local/sbin/cowrie-downloads-perms.py", os.X_OK)

    out, root = _run(tmp_path, host_env="SSHD_PORT=50022\nCOWRIE_JSON=/srv/c.json\n")
    assert "cannot locate Cowrie's downloads" in out.stdout
    assert not (root / "etc/systemd/system/cowrie-downloads-perms.path").exists()

    out, root = _run(tmp_path, "--uninstall")
    assert out.returncode == 0, out.stdout + out.stderr
    assert not (root / "usr/local/sbin/cowrie-downloads-perms.py").exists()


def _fake_bin(tmp_path, sshd_t, ss="", socket_listen=None):
    """Stub sshd/ss/systemctl so the real port detection runs against a known host."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    scripts = {
        "sshd": f"#!/bin/sh\n[ \"$1\" = -T ] && printf '%b' '{sshd_t}'\n",
        "ss": f"#!/bin/sh\nprintf '%b' '{ss}'\n",
        "systemctl": (
            "#!/bin/sh\n"
            'case "$*" in\n'
            f'  *is-active*ssh.socket*) {"exit 0" if socket_listen else "exit 3"} ;;\n'
            f"  *show*ssh.socket*) printf '%b' '{socket_listen or ''}' ;;\n"
            "esac\n"
        ),
    }
    for name, body in scripts.items():
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    return bin_dir


def test_listenaddress_port_wins_over_default_port(tmp_path):
    # "Port 22" stays the default while ListenAddress pins the real port: sshd is not on 22.
    fake = _fake_bin(tmp_path, "port 22\\nlistenaddress 0.0.0.0:50022\\nlistenaddress [::]:50022\\n")
    out, _ = _run(tmp_path, sshd_ports=None, fake_bin=fake)
    assert out.returncode == 0, out.stdout + out.stderr
    assert "sshd listens on: 50022" in out.stdout


def test_ssh_socket_on_22_is_detected(tmp_path):
    # Socket activation: ss shows the listener as "systemd", not "sshd".
    fake = _fake_bin(
        tmp_path,
        "port 50022\\nlistenaddress 0.0.0.0:50022\\n",
        ss='LISTEN 0 4096 *:22 *:* users:(("systemd",pid=1,fd=50))\\n',
        socket_listen="[::]:22 (Stream)\\n",
    )
    out, root = _run(tmp_path, sshd_ports=None, fake_bin=fake)
    assert out.returncode == 2
    assert "listens on port 22" in out.stdout
    assert _tree(root) == {}


UFW_HEAD = "Status: active\\n\\nTo Action From\\n-- ------ ----\\n"


def test_ufw_accepts_ranges_lists_interfaces_and_source_rules(tmp_path):
    for rule in (
        "50000:50100/tcp ALLOW Anywhere",
        "22,50022/tcp ALLOW Anywhere",
        "50022/tcp on eth0 ALLOW IN Anywhere",
        "50022 ALLOW IN 203.0.113.7",
        "Anywhere ALLOW 203.0.113.7",
    ):
        out, _ = _run(tmp_path, ufw=UFW_HEAD + rule + "\\n")
        assert out.returncode == 0, rule + "\n" + out.stdout + out.stderr


def test_ufw_refuses_rules_that_do_not_open_the_port(tmp_path):
    for rule in ("50022/udp ALLOW Anywhere", "50022/tcp DENY Anywhere", "50000:50010/tcp ALLOW Anywhere"):
        out, root = _run(tmp_path, ufw=UFW_HEAD + rule + "\\n")
        assert out.returncode == 2, rule
        assert _tree(root) == {}


def test_ufw_app_profile_only_warns(tmp_path):
    out, _ = _run(tmp_path, ufw=UFW_HEAD + "OpenSSH ALLOW Anywhere\\n")
    assert out.returncode == 0, out.stdout + out.stderr
    assert "application profile" in out.stdout


def test_refuses_without_docker_before_any_change(tmp_path):
    out, root = _run(tmp_path, extra_env={"DOCKER_CHECK_CMD": "false"})
    assert out.returncode != 0
    assert "Docker" in out.stdout + out.stderr
    assert _tree(root) == {}


def _repo_with_env(tmp_path, dot_env):
    repo = tmp_path / "clone"
    repo.mkdir(exist_ok=True)
    (repo / "docker-compose.yml").write_text("services: {}\n")
    (repo / ".env").write_text(dot_env)
    return repo


def test_refuses_honeypot_subnet_drift(tmp_path):
    repo = _repo_with_env(tmp_path, "HONEYPOT_SUBNET=172.30.0.0/16\n")
    out, root = _run(tmp_path, host_env=f"SSHD_PORT=50022\nREPO_DIR={repo}\nHONEYPOT_SUBNET=172.21.0.0/16\n")
    assert out.returncode != 0
    assert "HONEYPOT_SUBNET" in out.stdout + out.stderr
    assert _tree(root) == {}


def test_subnet_defaults_count_as_equal(tmp_path):
    repo = _repo_with_env(tmp_path, "SSHD_PORT=50022\n")
    out, _ = _run(tmp_path, host_env=f"SSHD_PORT=50022\nREPO_DIR={repo}\nHONEYPOT_SUBNET=172.21.0.0/16\n")
    assert out.returncode == 0, out.stdout + out.stderr

    repo = _repo_with_env(tmp_path, "HONEYPOT_SUBNET=172.30.0.0/16\n")
    out, _ = _run(tmp_path, host_env=f"SSHD_PORT=50022\nREPO_DIR={repo}\n")
    assert out.returncode != 0


def test_uninstall_clears_docker_user_itself(tmp_path):
    out, root = _run(tmp_path)
    assert out.returncode == 0
    out, _ = _run(tmp_path, "--uninstall")
    assert out.returncode == 0, out.stdout + out.stderr
    assert "docker-user-firewall.sh --clear" in out.stdout
    assert "restart docker" not in out.stdout
