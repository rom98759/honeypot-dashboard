import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

import geoip2.database
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.correlation import FailbanIngester, SshdAuthIngester
from app.db import connect
from app.enrichment_worker import EnrichmentWorker
from app.fban_control import FbanControl
from app.geoip import GeoLookup
from app.ingester import CowrieIngester
from app.ip_enrichment import AbuseIpDbClient, AsnLookup, IpEnrichment
from app.routers import commands, correlation, ip, overview, sessions
from app.ttl_cache import TtlCache

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


def _open_asn_reader(asn_db_path: str | None):
    """Same degrade-to-None contract as `_open_geoip_reader` — a missing
    GeoLite2-ASN.mmdb (dev checkout, or VPS before geoip-update.sh has run)
    must not crash app startup."""
    if not asn_db_path or not Path(asn_db_path).exists():
        return None
    try:
        return geoip2.database.Reader(asn_db_path)
    except Exception:
        return None


def _backfill_geo_cache(db, geo_lookup: GeoLookup) -> None:
    """
    Two passes. First: populate geo_cache for sessions ingested before GeoLookup
    was wired up (or before geoip-update.sh had produced an .mmdb file) — a
    rerun is a no-op since it only touches IPs geo_cache doesn't already have.
    Second: re-resolve rows already in geo_cache but missing coordinates or the
    ISO country code (both added after GeoLookup started extracting them). This queries the reader directly
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
        "SELECT ip FROM geo_cache "
        "WHERE (latitude IS NULL OR country_code IS NULL) AND country IS NOT NULL"
    ).fetchall()
    for row in missing_coordinates:
        try:
            response = geo_lookup.reader.city(row["ip"])
        except Exception:
            continue  # keep the existing country/city rather than nulling it
        db.execute(
            "UPDATE geo_cache SET latitude = ?, longitude = ?, country = ?, country_code = ?, "
            "city = ? WHERE ip = ?",
            (
                response.location.latitude,
                response.location.longitude,
                response.country.name,
                getattr(response.country, "iso_code", None),
                response.city.name,
                row["ip"],
            ),
        )
    db.commit()


def _backfill_missing_asn(db, asn_lookup: AsnLookup) -> None:
    """Second pass for ASN, mirroring `_backfill_geo_cache`'s own second pass
    for coordinates: rows that were fully processed (`status = 'done'`) but
    got no ASN — either because no GeoLite2-ASN.mmdb reader existed yet at
    the time, or because the IP genuinely isn't found — stay stuck at
    asn = NULL forever otherwise, since done rows are never reprocessed by
    the worker. Re-querying a genuinely-not-found IP on every startup is
    harmless, same tradeoff `_backfill_geo_cache` accepts for its own
    "missing coordinates" pass. Only asn/asn_org are touched; reverse_dns,
    the abuseipdb_* fields, and status are left alone."""
    if asn_lookup.reader is None:
        return

    missing_asn = db.execute(
        "SELECT ip FROM ip_enrichment WHERE status = 'done' AND asn IS NULL"
    ).fetchall()
    for row in missing_asn:
        asn, asn_org = asn_lookup.lookup(row["ip"])
        if asn is None and asn_org is None:
            continue
        db.execute(
            "UPDATE ip_enrichment SET asn = ?, asn_org = ? WHERE ip = ?",
            (asn, asn_org, row["ip"]),
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
    geoip_asn_db_path = os.environ.get("GEOIP_ASN_DB_PATH")
    abuseipdb_api_key = os.environ.get("ABUSEIPDB_API_KEY", "").strip() or None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        tasks = []
        if start_background_tasks:
            tasks = [
                asyncio.create_task(_poll_loop(app)),
                asyncio.create_task(app.state.enrichment_worker.run_forever()),
            ]
        yield
        for task in tasks:
            task.cancel()

    app = FastAPI(lifespan=lifespan)
    app.state.db = db if db is not None else connect(db_path)
    app.state.stats_cache = TtlCache()
    app.state.fban_control = (
        fban_control if fban_control is not None else FbanControl(fban_queue_path, timeout=fban_timeout_seconds)
    )
    app.state.cowrie_var_path = cowrie_var_path
    app.state.geo_lookup = GeoLookup(app.state.db, _open_geoip_reader(geoip_db_path))
    _backfill_geo_cache(app.state.db, app.state.geo_lookup)
    _backfill_ip_enrichment(app.state.db)
    app.state.abuseipdb_configured = abuseipdb_api_key is not None
    app.state.ip_enrichment = IpEnrichment(
        AsnLookup(_open_asn_reader(geoip_asn_db_path)),
        AbuseIpDbClient(abuseipdb_api_key),
    )
    _backfill_missing_asn(app.state.db, app.state.ip_enrichment.asn_lookup)
    app.state.enrichment_worker = EnrichmentWorker(app.state.db, app.state.ip_enrichment)
    app.state.cowrie_ingester = CowrieIngester(app.state.db, cowrie_json_path, app.state.geo_lookup)
    app.state.fail2ban_ingester = FailbanIngester(app.state.db, fail2ban_log_path)
    app.state.sshd_auth_ingester = SshdAuthIngester(app.state.db, sshd_auth_log_path)

    app.include_router(overview.router)
    app.include_router(sessions.router)
    app.include_router(correlation.router)
    app.include_router(ip.router)
    app.include_router(commands.router)
    if STATIC_DIR.exists():
        app.mount("/", NoCacheStaticFiles(directory=STATIC_DIR, html=True), name="static")
    return app


app = create_app()
