import asyncio
import math
import os
from contextlib import asynccontextmanager
from pathlib import Path

import geoip2.database
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.correlation import FailbanIngester, SshdAuthIngester
from app.db import connect
from app.fban_control import FbanControl
from app.geoip import GeoLookup
from app.ingester import CowrieIngester
from app.routers import commands, correlation, ip, map as map_router, overview, sessions

POLL_INTERVAL_SECONDS = 5
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


class NoCacheStaticFiles(StaticFiles):
    """
    Forces browsers/CDNs to revalidate (If-None-Match) on every request instead
    of trusting a long default TTL. Without this, Cloudflare's default edge
    cache for .css/.js (hours) served stale UI code after a deploy until a
    manual purge — this makes every deploy self-correcting via cheap 304s.
    """

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


def _open_geoip_reader(geoip_db_path: str | None):
    """
    Returns None (rather than raising) when the path is unset or the .mmdb file
    isn't there — GeoLookup already treats a missing reader as "no geo data",
    so a dev checkout or a VPS where geoip-update.sh hasn't run yet still works.
    """
    if not geoip_db_path or not Path(geoip_db_path).exists():
        return None
    try:
        return geoip2.database.Reader(geoip_db_path)
    except Exception:
        return None


def _parse_optional_float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def _backfill_geo_cache(db, geo_lookup: GeoLookup) -> None:
    """
    Two passes. First: populate geo_cache for sessions ingested before GeoLookup
    was wired up (or before geoip-update.sh had produced an .mmdb file) — a
    rerun is a no-op since it only touches IPs geo_cache doesn't already have.
    Second: re-resolve rows already in geo_cache but missing coordinates (added
    after GeoLookup started extracting them). This queries the reader directly
    and only writes on a successful response — unlike deleting the row first
    and calling geo_lookup.lookup() again, this never destroys a previously
    correct country/city if the IP no longer resolves under the current mmdb
    (GeoLite2-City's coverage shifts release to release). The `country IS NOT
    NULL` guard on the SELECT skips IPs that already failed to resolve entirely
    (private IPs, etc.) — retrying those every startup would be wasted work.
    """
    if geo_lookup.reader is None:
        return

    missing_entirely = db.execute(
        "SELECT DISTINCT s.src_ip FROM sessions s "
        "LEFT JOIN geo_cache g ON g.ip = s.src_ip WHERE g.ip IS NULL"
    ).fetchall()
    for row in missing_entirely:
        geo_lookup.lookup(row["src_ip"])

    missing_coordinates = db.execute(
        "SELECT ip FROM geo_cache WHERE latitude IS NULL AND country IS NOT NULL"
    ).fetchall()
    for row in missing_coordinates:
        try:
            response = geo_lookup.reader.city(row["ip"])
        except Exception:
            continue  # keep the existing country/city rather than nulling it
        db.execute(
            "UPDATE geo_cache SET latitude = ?, longitude = ?, country = ?, city = ? WHERE ip = ?",
            (
                response.location.latitude,
                response.location.longitude,
                response.country.name,
                response.city.name,
                row["ip"],
            ),
        )
    db.commit()


def _backfill_ip_enrichment(db) -> None:
    """Catches any src_ip already in `sessions` that has no ip_enrichment
    row yet — otherwise IPs ingested before this feature shipped would
    never get enqueued (apply_cowrie_record only enqueues on new
    session.connect events). Idempotent (INSERT OR IGNORE), safe to run on
    every startup, same pattern as _backfill_geo_cache."""
    db.execute(
        "INSERT OR IGNORE INTO ip_enrichment (ip) "
        "SELECT DISTINCT src_ip FROM sessions"
    )
    db.commit()


async def _poll_loop(app: FastAPI) -> None:
    while True:
        app.state.cowrie_ingester.tick()
        app.state.fail2ban_ingester.tick()
        app.state.sshd_auth_ingester.tick()
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def create_app(
    db=None, start_background_tasks: bool = True, fban_control: FbanControl | None = None
) -> FastAPI:
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
    fban_queue_path = Path(os.environ.get("FBAN_QUEUE_PATH", "/queue"))
    fban_timeout_seconds = float(os.environ.get("FBAN_TIMEOUT_SECONDS", "2.0"))
    geoip_db_path = os.environ.get("GEOIP_DB_PATH")
    vps_latitude = _parse_optional_float(os.environ.get("VPS_LATITUDE"))
    vps_longitude = _parse_optional_float(os.environ.get("VPS_LONGITUDE"))

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
    app.state.fban_control = (
        fban_control if fban_control is not None else FbanControl(fban_queue_path, timeout=fban_timeout_seconds)
    )
    app.state.cowrie_var_path = cowrie_var_path
    app.state.vps_latitude = vps_latitude
    app.state.vps_longitude = vps_longitude
    app.state.geo_lookup = GeoLookup(app.state.db, _open_geoip_reader(geoip_db_path))
    _backfill_geo_cache(app.state.db, app.state.geo_lookup)
    _backfill_ip_enrichment(app.state.db)
    app.state.cowrie_ingester = CowrieIngester(app.state.db, cowrie_json_path, app.state.geo_lookup)
    app.state.fail2ban_ingester = FailbanIngester(app.state.db, fail2ban_log_path)
    app.state.sshd_auth_ingester = SshdAuthIngester(app.state.db, sshd_auth_log_path)

    app.include_router(overview.router)
    app.include_router(sessions.router)
    app.include_router(correlation.router)
    app.include_router(map_router.router)
    app.include_router(ip.router)
    app.include_router(commands.router)
    if STATIC_DIR.exists():
        app.mount("/", NoCacheStaticFiles(directory=STATIC_DIR, html=True), name="static")
    return app


app = create_app()
