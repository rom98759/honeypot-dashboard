import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.correlation import FailbanIngester, SshdAuthIngester
from app.db import connect
from app.ingester import CowrieIngester
from app.routers import overview, sessions

POLL_INTERVAL_SECONDS = 5
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


async def _poll_loop(app: FastAPI) -> None:
    while True:
        app.state.cowrie_ingester.tick()
        app.state.fail2ban_ingester.tick()
        app.state.sshd_auth_ingester.tick()
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def create_app(db=None, start_background_tasks: bool = True) -> FastAPI:
    """
    Build the FastAPI app. `db` and `start_background_tasks=False` let tests
    inject an in-memory/tmp DB without spinning up the polling loop.

    Request-serving state (`app.state.db` and friends) is set here,
    synchronously, rather than inside `lifespan` — `TestClient(app)` used
    without a `with` block never runs lifespan startup, and every test in
    this project relies on making requests against a plain `TestClient(app)`.
    `lifespan` is reserved for the one thing that genuinely needs an async
    context: starting/cancelling the background polling task.
    """
    db_path = Path(os.environ.get("DASHBOARD_DB_PATH", "/data/dashboard.sqlite3"))
    cowrie_json_path = Path(
        os.environ.get("COWRIE_JSON_PATH", "/cowrie-var/log/cowrie/cowrie.json")
    )
    cowrie_var_path = Path(os.environ.get("COWRIE_VAR_PATH", "/cowrie-var"))
    fail2ban_log_path = Path(os.environ.get("FAIL2BAN_LOG_PATH", "/var/log/fail2ban.log"))
    sshd_auth_log_path = Path(os.environ.get("SSHD_AUTH_LOG_PATH", "/var/log/sshd-auth.log"))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = None
        if start_background_tasks:
            task = asyncio.create_task(_poll_loop(app))
        yield
        if task is not None:
            task.cancel()

    app = FastAPI(lifespan=lifespan)
    app.state.db = db if db is not None else connect(db_path)
    app.state.cowrie_var_path = cowrie_var_path
    app.state.cowrie_ingester = CowrieIngester(app.state.db, cowrie_json_path)
    app.state.fail2ban_ingester = FailbanIngester(app.state.db, fail2ban_log_path)
    app.state.sshd_auth_ingester = SshdAuthIngester(app.state.db, sshd_auth_log_path)

    app.include_router(overview.router)
    app.include_router(sessions.router)
    if STATIC_DIR.exists():
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
    return app


app = create_app()
