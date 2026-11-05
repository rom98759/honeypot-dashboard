import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
WORKER = REPO / "scripts" / "fban-queue-worker.sh"
BAN = REPO / "scripts" / "honeypot-ban.sh"
JAIL_TEMPLATE = REPO / "scripts" / "fail2ban" / "honeypot.local.tmpl"
COWRIE_FILTER = REPO / "scripts" / "fail2ban" / "filter.d" / "honeypot-cowrie.conf"


def _worker_accepts(line: str) -> bool:
    script = (
        'eval "$(grep -E "^(IP_RE|LINE_RE)=" "$1")"\n'
        '[[ "$2" =~ $LINE_RE ]]\n'
    )
    return subprocess.run(["bash", "-c", script, "_", str(WORKER), line]).returncode == 0


@pytest.mark.parametrize(
    "line",
    ["ban manual 203.0.113.7", "ban manual-all 2001:db8::1", "unban all 203.0.113.7", "status all 203.0.113.7"],
)
def test_worker_accepts_dashboard_requests(line):
    assert _worker_accepts(line)


@pytest.mark.parametrize(
    "line",
    [
        "ban sshd 203.0.113.7",  # automatic jails are fail2ban's, not the dashboard's
        "ban cowrie 203.0.113.7",
        "unban manual 203.0.113.7",
        "ban manual 203.0.113.7;reboot",
        "ban manual 203.0.113.7 extra",
        "status all not-an-ip",
    ],
)
def test_worker_rejects_anything_else(line):
    assert not _worker_accepts(line)


def _ban(tmp_path, *args):
    env = {
        "PATH": os.environ["PATH"],
        "HONEYPOT_HOST_ENV": str(tmp_path / "missing.env"),
        "HONEYPOT_BAN_STATE_DIR": str(tmp_path / "state"),
    }
    return subprocess.run(["bash", str(BAN), *args], env=env, capture_output=True, text=True)


def test_services_scope_keeps_the_honeypot_reachable(tmp_path):
    out = _ban(tmp_path, "--dry-run", "start", "cowrie", "services")
    assert out.returncode == 0, out.stderr
    assert "iptables -w -A hp-cowrie -p tcp --dport 22 -j RETURN" in out.stdout
    assert "iptables -w -I INPUT 1 -j hp-cowrie" in out.stdout
    assert "ip6tables -w -I INPUT 1 -j hp-cowrie" in out.stdout


def test_all_scope_has_no_honeypot_exception(tmp_path):
    out = _ban(tmp_path, "--dry-run", "start", "manual-all", "all")
    assert out.returncode == 0, out.stderr
    assert "RETURN" not in out.stdout


def test_ban_picks_the_address_family(tmp_path):
    assert "iptables -w -A hp-manual -s 203.0.113.7 -j DROP" in _ban(tmp_path, "--dry-run", "ban", "manual", "203.0.113.7").stdout
    assert "ip6tables -w -A hp-manual -s 2001:db8::1 -j DROP" in _ban(tmp_path, "--dry-run", "ban", "manual", "2001:db8::1").stdout


@pytest.mark.parametrize("args", [["ban", "manual", "1.2.3.4;id"], ["ban", "Bad_Jail", "1.2.3.4"], ["start", "x", "everything"]])
def test_ban_helper_rejects_bad_input(tmp_path, args):
    assert _ban(tmp_path, "--dry-run", *args).returncode != 0


def test_docker_user_rules_follow_each_jail_scope(tmp_path):
    state = tmp_path / "state"
    state.mkdir()
    (state / "cowrie").write_text("services\n")
    (state / "manual-all").write_text("all\n")
    out = _ban(tmp_path, "--dry-run", "docker-user-rules", "v4", "eth0")
    assert out.returncode == 0, out.stderr
    assert sorted(out.stdout.splitlines()) == [
        "-A DOCKER-USER -i eth0 ! -d 172.21.0.0/16 -j hp-cowrie",
        "-A DOCKER-USER -i eth0 -j hp-manual-all",
    ]


def test_jail_template_covers_every_jail_with_the_ban_action():
    text = JAIL_TEMPLATE.read_text()
    for jail in ["sshd", "cowrie", "npm-badbots", "recidive", "manual", "manual-all"]:
        assert f"[{jail}]" in text
        assert f"honeypot-block[name={jail}," in text
    assert "journalmatch = _SYSTEMD_UNIT=ssh.service" in text
    assert "scope=all" in text.split("[manual-all]")[1]


def test_cowrie_filter_matches_a_real_connect_line():
    regex = next(
        line.split("=", 1)[1].strip()
        for line in COWRIE_FILTER.read_text().splitlines()
        if line.startswith("failregex")
    )
    import re

    pattern = re.compile(regex.replace("<HOST>", r"(?P<host>[0-9a-fA-F.:]+)"))
    line = (
        '{"session":"919602dd5674","protocol":"ssh","src_ip":"192.0.2.50","src_port":46120,'
        '"dst_ip":"172.21.0.2","dst_port":2222,"eventid":"cowrie.session.connect",'
        '"timestamp":"2026-11-03T10:20:26.579600Z"}'
    )
    assert pattern.search(line)["host"] == "192.0.2.50"
    assert not pattern.search(line.replace("session.connect", "command.input"))


NEVER_BAN = REPO / "scripts" / "honeypot-never-ban.sh"


def _protected(tmp_path, ip, never_ban="", dashboard=None):
    (tmp_path / "never-ban").write_text(never_ban)
    dash = tmp_path / "admin-networks"
    if dashboard is not None:
        dash.write_text(dashboard)
    env = {
        "PATH": os.environ["PATH"],
        "HONEYPOT_NEVER_BAN": str(tmp_path / "never-ban"),
        "HONEYPOT_DASHBOARD_NETWORKS": str(dash),
    }
    return subprocess.run(["bash", str(NEVER_BAN), ip], env=env).returncode == 0


def test_never_ban_reads_both_lists(tmp_path):
    assert _protected(tmp_path, "203.0.113.7", never_ban="# box\n203.0.113.7  # me\n")
    assert _protected(tmp_path, "198.51.100.9", dashboard="# header\n198.51.100.0/24\n")
    assert not _protected(tmp_path, "192.0.2.1", never_ban="203.0.113.7\n", dashboard="198.51.100.0/24\n")
    assert not _protected(tmp_path, "not-an-ip", never_ban="0.0.0.0/0\n")


def test_dashboard_list_cannot_whitelist_wide_ranges(tmp_path):
    # The container writes this file: a /8 there must not protect anyone.
    assert not _protected(tmp_path, "10.1.2.3", dashboard="10.0.0.0/8\n")
    assert not _protected(tmp_path, "2001:db8::1", dashboard="2001:db8::/32\n")
    # The owner's own file is trusted as is.
    assert _protected(tmp_path, "10.1.2.3", never_ban="10.0.0.0/8\n")


def test_dashboard_list_symlink_is_ignored(tmp_path):
    target = tmp_path / "elsewhere"
    target.write_text("192.0.2.0/24\n")
    (tmp_path / "admin-networks").symlink_to(target)
    assert not _protected(tmp_path, "192.0.2.1")


def test_jail_template_asks_the_never_ban_script():
    assert "ignorecommand = /usr/local/sbin/honeypot-never-ban.sh <ip>" in JAIL_TEMPLATE.read_text()


PERMS = REPO / "scripts" / "cowrie-downloads-perms.py"


def test_downloads_perms_makes_samples_readable_and_nothing_else(tmp_path):
    downloads = tmp_path / "downloads"
    downloads.mkdir()
    sample = downloads / ("a" * 64)
    sample.write_bytes(b"x")
    sample.chmod(0o4600)
    tmp = downloads / "tmpXYZ"  # Cowrie's in-flight temp file
    tmp.write_bytes(b"x")
    tmp.chmod(0o600)
    outside = tmp_path / "outside"
    outside.write_bytes(b"secret")
    outside.chmod(0o600)
    (downloads / ("b" * 64)).symlink_to(outside)
    os.link(outside, downloads / ("c" * 64))

    out = subprocess.run([sys.executable, str(PERMS), str(downloads)], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert oct(sample.stat().st_mode & 0o7777) == "0o604"  # o+r, setuid dropped
    assert oct(tmp.stat().st_mode & 0o777) == "0o600"
    assert oct(outside.stat().st_mode & 0o777) == "0o600"  # neither via symlink nor hard link
    assert "1 file(s)" in out.stdout

    again = subprocess.run([sys.executable, str(PERMS), str(downloads)], capture_output=True, text=True)
    assert again.returncode == 0 and again.stdout == ""
    missing = subprocess.run([sys.executable, str(PERMS), str(tmp_path / "none")])
    assert missing.returncode == 0
