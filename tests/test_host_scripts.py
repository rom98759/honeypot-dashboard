import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"


def _run(script, *args, host_env="", tmp_path, extra_env=None):
    env_file = tmp_path / "host.env"
    env_file.write_text(host_env)
    env_file.chmod(0o600)
    env = {"PATH": os.environ["PATH"], "HONEYPOT_HOST_ENV": str(env_file), **(extra_env or {})}
    return subprocess.run(
        ["bash", str(SCRIPTS / script), *args], env=env, capture_output=True, text=True, timeout=30
    )


def test_firewall_default_only_egress(tmp_path):
    out = _run(
        "docker-user-firewall.sh",
        "--print-rules",
        host_env="HONEYPOT_SUBNET=172.30.0.0/16\nWAN_IFACE=eth0\n",
        tmp_path=tmp_path,
    )
    assert out.returncode == 0, out.stderr
    assert "-s 172.30.0.0/16 -m conntrack --ctstate NEW" in out.stdout
    assert "173.245.48.0/20" not in out.stdout
    assert "--dport 81" not in out.stdout
    assert "--dports 80,443 -j DROP" not in out.stdout


def test_firewall_cloudflare_and_blocked_ports_opt_in(tmp_path):
    out = _run(
        "docker-user-firewall.sh",
        "--print-rules",
        host_env="HONEYPOT_SUBNET=172.30.0.0/16\nWAN_IFACE=eth0\nCLOUDFLARE_ONLY=1\nBLOCK_PORTS=\"81 9000\"\n",
        tmp_path=tmp_path,
    )
    assert out.returncode == 0, out.stderr
    assert "-i eth0 -s 173.245.48.0/20 -p tcp -m multiport --dports 80,443 -j RETURN" in out.stdout
    assert "-i eth0 -p tcp -m multiport --dports 80,443 -j DROP" in out.stdout
    assert "-i eth0 -p tcp -m tcp --dport 81 -j DROP" in out.stdout
    assert "-i eth0 -p tcp -m tcp --dport 9000 -j DROP" in out.stdout


def test_firewall_never_touches_input(tmp_path):
    out = _run(
        "docker-user-firewall.sh",
        "--print-rules",
        host_env="WAN_IFACE=eth0\nCLOUDFLARE_ONLY=1\nBLOCK_PORTS=81\n",
        tmp_path=tmp_path,
    )
    assert out.returncode == 0, out.stderr
    rules = [line for line in out.stdout.splitlines() if line.startswith("-A ")]
    assert rules and all(line.startswith("-A DOCKER-USER ") for line in rules)


def test_firewall_rejects_bad_port(tmp_path):
    out = _run(
        "docker-user-firewall.sh",
        "--print-rules",
        host_env="WAN_IFACE=eth0\nBLOCK_PORTS=\"81 ;reboot\"\n",
        tmp_path=tmp_path,
    )
    assert out.returncode != 0
    assert "BLOCK_PORTS" in out.stderr


def test_geoip_requires_creds(tmp_path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    marker = tmp_path / "curl-called"
    (fake_bin / "curl").write_text(f"#!/bin/sh\ntouch {marker}\n")
    (fake_bin / "curl").chmod(0o755)
    out = _run(
        "geoip-update.sh",
        host_env=f"REPO_DIR={tmp_path}\nMAXMIND_ACCOUNT_ID=123\n",
        tmp_path=tmp_path,
        extra_env={"PATH": f"{fake_bin}:{os.environ['PATH']}"},
    )
    assert out.returncode != 0
    assert "MAXMIND_LICENSE_KEY" in out.stderr
    assert not marker.exists()


def test_no_owner_specific_values_in_scripts():
    out = subprocess.run(
        ["git", "grep", "-nE", r"/home/user|50022|eth0|example", "--", "scripts/"],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert out.stdout == ""


def test_firewall_restore_payload_only_declares_docker_user(tmp_path):
    # Fed to `iptables-restore --noflush`: only the declared chain is flushed, so rules other
    # tools add to INPUT/f2b chains in the meantime are never lost.
    out = _run(
        "docker-user-firewall.sh",
        "--print-restore",
        host_env="HONEYPOT_SUBNET=172.30.0.0/16\nWAN_IFACE=eth0\n",
        tmp_path=tmp_path,
    )
    assert out.returncode == 0, out.stderr
    lines = out.stdout.splitlines()
    assert lines[0] == "*filter"
    assert lines[1] == ":DOCKER-USER - [0:0]"
    assert lines[-1] == "COMMIT"
    assert [l for l in lines if l.startswith(":")] == [":DOCKER-USER - [0:0]"]
    assert all(l.startswith("-A DOCKER-USER ") for l in lines[2:-1])


def test_firewall_applies_with_noflush():
    script = (SCRIPTS / "docker-user-firewall.sh").read_text()
    assert "iptables-save" not in script
    assert '"$restore_bin" --noflush' in script


def test_scripts_refuse_writable_host_env(tmp_path):
    for script in ("docker-user-firewall.sh", "geoip-update.sh"):
        env_file = tmp_path / "host.env"
        env_file.write_text("WAN_IFACE=eth0\n")
        env_file.chmod(0o666)
        env = {"PATH": os.environ["PATH"], "HONEYPOT_HOST_ENV": str(env_file)}
        out = subprocess.run(
            ["bash", str(SCRIPTS / script), "--print-rules"], env=env, capture_output=True, text=True, timeout=30
        )
        assert out.returncode != 0, script
        assert "writable" in out.stderr, script
