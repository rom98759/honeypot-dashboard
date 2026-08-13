# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hosted dashboard for a Cowrie SSH/Telnet honeypot running on the user's VPS. It tails Cowrie's
JSON event log, fail2ban's log, and an sshd auth log into a SQLite database, then serves an overview,
a session browser (with terminal replay), and an IP correlation view (honeypot sessions vs. real sshd
auth attempts vs. fail2ban bans) via a FastAPI backend + vanilla JS frontend.

## Commands

```bash
# Run the dev server (auto-reload)
.venv/bin/uvicorn app.main:app --reload

# Run all tests
.venv/bin/pytest

# Run a single test file / test
.venv/bin/pytest tests/test_ingester.py
.venv/bin/pytest tests/test_ingester.py::test_name -v

# Docker (production deployment on the VPS)
docker compose up -d --build
```

There's no separate lint/format command configured — match existing style.

## Architecture

**Ingestion is pull-based polling, not streaming.** `app/main.py`'s `_poll_loop` calls `.tick()` on
three ingesters (`CowrieIngester`, `FailbanIngester`, `SshdAuthIngester`, all in `app/ingester.py` /
`app/correlation.py`) every `POLL_INTERVAL_SECONDS` (5s). Each ingester wraps an `app/tailer.py`
`LogTailer`, which tracks a byte offset + inode per log source in the `ingest_offsets` table so it can
resume after restarts and detect rotation (inode change or size-shrink resets the offset to 0;
copytruncate-style rotation is a known unhandled gap, see comment in `tailer.py`). A tick's offset
update and the rows it inserts are committed together in one transaction — see the docstrings on
`LogTailer.read_new_lines` and `CowrieIngester.tick` for the crash-consistency reasoning.

**Cowrie events are parsed in two stages**: `app/cowrie_parser.py::parse_event` turns raw JSON dicts
into typed dataclasses (`SessionConnect`, `LoginAttempt`, `CommandInput`, `TTYLogClosed`,
`SessionClosed`); `app/ingester.py::apply_cowrie_record` writes each type to its SQLite table
(`sessions`, `commands`, `ttylogs`). Adding support for a new Cowrie event type means extending both
functions.

**`app/main.py::create_app`** builds the app with dependency-injectable `db` and
`start_background_tasks` params specifically so tests can use a `TestClient(app)` without triggering
real file I/O or the polling loop — request-serving state (`app.state.db`, `app.state.*_ingester`) is
set synchronously outside `lifespan`, since `TestClient` without a `with` block never runs lifespan
startup. `lifespan` is reserved solely for starting/cancelling the polling task. All path configuration
comes from env vars with Docker-oriented defaults (e.g. `/data/dashboard.sqlite3`); `tests/conftest.py`
overrides these to a repo-local `data/` dir before any test imports `app.main`, since bare imports of
that module trigger `create_app()` at module scope.

**Routers** (`app/routers/`) are thin — they read `request.app.state.db` directly and run raw SQL
inline (no ORM). `sessions.py` also holds `/api/sessions/{id}/replay`, which reads raw Cowrie ttylog
blobs off disk (mounted read-only at `app.state.cowrie_var_path`) and converts them via
`app/ttyplayer.py` into an asciinema v2 `.cast` stream for the frontend's asciinema-player. Cowrie logs
ttylog paths relative to its own root (`var/lib/cowrie/tty/...`); the mount points directly at that
`var/` dir, so the router strips the leading `var/` segment before resolving.

**`app/ttyplayer.py`** parses Cowrie's binary ttylog frame format (struct `<iLiiLL`) and mirrors
upstream `playlog`'s stream-direction selection logic (`_select_events`) to pick one I/O direction plus
always-shown interactive frames. Multiple ttylog files for one session (Cowrie rotates them) are
concatenated onto a single global timeline using their real Unix-epoch frame timestamps, not
per-file-relative time.

**GeoIP** (`app/geoip.py`) wraps a MaxMind reader with a SQLite-backed cache (`geo_cache` table);
lookups that fail (private IP, reader unavailable, IP not found) are cached as `NULL` rather than
retried every tick.

**Concurrency note**: route handlers are `async def` but do synchronous sqlite3 calls directly against
a single shared connection (`check_same_thread=False`, WAL mode, `busy_timeout=5000`) — this is
intentional (see commit `d1b5a29`) to avoid threadpool-based concurrent access to that connection, not
an oversight to "fix" by adding `await asyncio.to_thread(...)`.

## Frontend

Vanilla JS, no build step. `static/index.html` loads `/js/app.js` as an ES module plus `Chart.js` from
a CDN and a vendored `asciinema-player`. The UI is mid-rewrite (see `docs/superpowers/specs/` and
`docs/superpowers/plans/` for the design spec and implementation plan) — check `static/js/` for the
current module layout rather than assuming `static/app.js` (the old monolithic file) still exists.

## Deployment context

Runs via `docker-compose.yml` on the user's OVH VPS behind Nginx Proxy Manager, on the external
`nginx-proxy-network`. The container is hardened: `read_only: true`, `cap_drop: ALL`,
`no-new-privileges`, mounts the honeypot's log volume and GeoIP DB read-only. `scripts/` holds VPS-side
helpers (log export, firewall, backups) that run outside the container — see `scripts/*.sh` headers for
per-script details, and `docs/superpowers/specs/2026-08-12-honeypot-dashboard.md` for the original
design spec if deeper deployment rationale is needed.
