"""
Set writable defaults for app.main's environment-driven paths before any test
module is collected.

app/main.py does `app = create_app()` at module import time (so `uvicorn
app.main:app` works), using defaults like `/data/dashboard.sqlite3` meant for
the Docker deployment (Task 12/13), where `/data` is a mounted volume. In a
bare local/dev checkout `/data` doesn't exist and isn't creatable without
root, so importing `app.main` — which every test that does
`from app.main import create_app` triggers — raises
`sqlite3.OperationalError` and aborts the *entire* pytest collection, not just
the offending file.

This redirects those defaults to a repo-local, already-gitignored `data/`
directory (see .gitignore) so the module import succeeds without requiring
Docker or root. Uses setdefault so an operator/CI that explicitly exports
these vars is unaffected.
"""

import os
from pathlib import Path

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_DATA_DIR.mkdir(parents=True, exist_ok=True)

os.environ.setdefault("DASHBOARD_DB_PATH", str(_DATA_DIR / "dashboard.sqlite3"))
os.environ.setdefault("COWRIE_JSON_PATH", str(_DATA_DIR / "cowrie.json"))
os.environ.setdefault("FAIL2BAN_LOG_PATH", str(_DATA_DIR / "fail2ban.log"))
os.environ.setdefault("SSHD_AUTH_LOG_PATH", str(_DATA_DIR / "sshd-auth.log"))
os.environ.setdefault("FBAN_QUEUE_PATH", str(_DATA_DIR / "fban-queue"))
os.environ.setdefault("FBAN_TIMEOUT_SECONDS", "0.1")
