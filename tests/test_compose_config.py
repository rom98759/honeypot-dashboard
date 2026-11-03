import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent

pytestmark = pytest.mark.skipif(shutil.which("docker") is None, reason="docker CLI not installed")


def _render(**env_overrides):
    env_file = REPO / ".env.example"
    lines = env_file.read_text().splitlines()
    for key, value in env_overrides.items():
        lines = [line for line in lines if not line.startswith(f"{key}=")] + [f"{key}={value}"]
    rendered_env = REPO / "data" / "compose-test.env"
    rendered_env.parent.mkdir(exist_ok=True)
    rendered_env.write_text("\n".join(lines) + "\n")
    out = subprocess.run(
        ["docker", "compose", "--env-file", str(rendered_env), "config", "--format", "json"],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.stdout)


def test_compose_renders_both_services():
    config = _render()
    assert set(config["services"]) == {"cowrie", "dashboard"}


def test_cowrie_is_hardened_and_published_on_22():
    cowrie = _render()["services"]["cowrie"]
    assert [(p["published"], p["target"]) for p in cowrie["ports"]] == [("22", 2222)]
    assert cowrie["read_only"] is True
    assert cowrie["cap_drop"] == ["ALL"]
    assert cowrie["pids_limit"] == 128
    assert "no-new-privileges:true" in cowrie["security_opt"]
    assert set(cowrie["networks"]) == {"honeypot-net"}


def test_honeypot_network_subnet_from_env():
    config = _render(HONEYPOT_SUBNET="172.30.0.0/16")
    subnets = [c["subnet"] for c in config["networks"]["honeypot-net"]["ipam"]["config"]]
    assert subnets == ["172.30.0.0/16"]


def test_dashboard_reads_cowrie_volume_read_only_and_stays_off_honeypot_net():
    dashboard = _render()["services"]["dashboard"]
    cowrie_mount = next(v for v in dashboard["volumes"] if v["target"] == "/cowrie-var")
    assert cowrie_mount["read_only"] is True
    assert "honeypot-net" not in dashboard["networks"]


def test_volume_names_overridable_for_existing_installs():
    config = _render(COWRIE_VAR_VOLUME="honeypot_cowrie-var", DASHBOARD_DATA_VOLUME="legacy_dashboard-data")
    assert config["volumes"]["cowrie-var"]["name"] == "honeypot_cowrie-var"
    assert config["volumes"]["dashboard-data"]["name"] == "legacy_dashboard-data"


def test_proxy_network_name_from_env():
    config = _render(PROXY_NETWORK="my-proxy")
    assert config["networks"]["proxy"]["name"] == "my-proxy"
    assert config["networks"]["proxy"]["external"] is True


def test_image_prepares_a_data_dir_the_app_user_owns():
    # A fresh named volume copies ownership from the image's mount point; without this
    # the non-root app cannot create its SQLite file and the container crash-loops.
    dockerfile = (REPO / "Dockerfile").read_text()
    user_line = dockerfile.index("USER dashboard")
    assert "install -d -o dashboard -g dashboard /data" in dockerfile[:user_line]
