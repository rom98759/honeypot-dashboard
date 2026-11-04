import os
import subprocess
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
