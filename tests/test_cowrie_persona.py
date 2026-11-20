import configparser
import pickle
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
COWRIE = REPO / "cowrie"

# Defaults of the stock Cowrie image: each one is a known fingerprint of a honeypot.
DEFAULT_HOSTNAME = "svr04"
DEFAULT_USER = "phil"


def _cfg():
    cfg = configparser.ConfigParser(interpolation=None)
    cfg.read(COWRIE / "cowrie.cfg")
    return cfg


def _walk(node, path=""):
    yield path or "/", node
    if node[1] == 1:
        for child in node[7]:
            yield from _walk(child, f"{path}/{child[0]}")


def _fs():
    with open(COWRIE / "fs.pickle", "rb") as fh:
        return dict(_walk(pickle.load(fh)))


def test_hostname_is_not_the_cowrie_default_and_matches_the_filesystem():
    hostname = _cfg()["honeypot"]["hostname"]
    assert hostname != DEFAULT_HOSTNAME
    assert _fs()["/etc/hostname"][7] == hostname.encode() + b"\n"


def test_banner_and_shell_ssh_version_announce_the_same_openssh():
    cfg = _cfg()
    banner = cfg["ssh"]["version"]
    shell = cfg["shell"]["ssh_version"]
    assert banner.startswith("SSH-2.0-OpenSSH_9.2p1 Debian-")
    assert shell.startswith(banner.removeprefix("SSH-2.0-"))


def test_filesystem_has_no_default_account():
    fs = _fs()
    assert f"/home/{DEFAULT_USER}" not in fs
    for path, node in fs.items():
        content = node[7] if node[1] == 2 and isinstance(node[7], bytes) else b""
        assert not re.search(rb"phil|california|svr04", content, re.I), path


def test_proc_has_no_entries_a_real_debian_host_lacks():
    fs = _fs()
    assert "/proc/docker" not in fs
    assert "/proc/.reset" not in fs
    assert "/proc/cpuinfo" in fs and "/proc/version" in fs


def test_filesystem_sizes_match_rewritten_files():
    fs = _fs()
    for path in ("/etc/hostname", "/etc/passwd", "/etc/group", "/etc/shadow"):
        assert len(fs[path][7]) == fs[path][4], path


def test_userdb_does_not_accept_everything():
    rules = [
        line
        for line in (COWRIE / "userdb.txt").read_text().splitlines()
        if line.strip() and not line.startswith("#")
    ]
    assert rules, "an empty userdb refuses every login"
    assert not any(line.endswith(":x:*") for line in rules)
    assert not any(line.startswith("*:") for line in rules)
