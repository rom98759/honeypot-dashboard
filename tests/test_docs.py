import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GUIDES = [REPO / "docs" / "install.md", REPO / "docs" / "install.fr.md"]
READMES = [REPO / "README.md", REPO / "README.fr.md"]


def _keys(path):
    return re.findall(r"^([A-Z][A-Z0-9_]+)=", path.read_text(), flags=re.M)


def test_every_config_key_is_documented_in_both_guides():
    keys = set(_keys(REPO / ".env.example")) | set(_keys(REPO / "scripts" / "host.env.example"))
    for guide in GUIDES:
        text = guide.read_text()
        missing = sorted(k for k in keys if f"`{k}`" not in text)
        assert missing == [], f"{guide.name} misses {missing}"


def test_ssh_warning_is_prominent_everywhere():
    for doc in READMES + GUIDES:
        head = doc.read_text()[:3000]
        assert "22" in head and "SSH" in head, doc.name
        assert "SSHD_PORT" in doc.read_text(), doc.name


def test_readmes_link_each_other_and_the_guides():
    en, fr = (p.read_text() for p in READMES)
    assert "README.fr.md" in en and "docs/install.md" in en
    assert "README.md" in fr and "docs/install.fr.md" in fr


def test_no_owner_specific_values_tracked():
    out = subprocess.run(
        [
            "git", "grep", "-nIE", r"50022|example|/home/user|54\.37\.|\bens3\b|00000000|vps-[0-9a-f]{8}",
            "--", ".", ":!tests/test_docs.py", ":!tests/test_host_scripts.py",
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert out.stdout == ""
