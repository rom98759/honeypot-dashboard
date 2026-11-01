from fastapi import APIRouter, HTTPException, Query, Request

from app.campaigns_stats import (
    SORT_KEYS,
    UNIQUE_SORT_KEYS,
    campaign_detail,
    campaign_page,
    compute_campaigns,
    unique_sessions,
    unique_sessions_page,
)

router = APIRouter()

# Grouping every ttylog takes ~2 s on the VPS and campaigns move slowly.
CAMPAIGNS_TTL_SECONDS = 300


def cached_aggregate(app) -> dict:
    db = app.state.db
    return app.state.stats_cache.get_or_compute(
        ("campaigns",), CAMPAIGNS_TTL_SECONDS, lambda: compute_campaigns(db)
    )


@router.get("/api/campaigns")
async def list_campaigns(
    request: Request,
    sort: str = "sessions",
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    if sort not in SORT_KEYS:
        raise HTTPException(status_code=400, detail=f"invalid sort: {sort}")
    db = request.app.state.db
    cache = request.app.state.stats_cache
    aggregate = cached_aggregate(request.app)
    # The page itself is costly too: the 30-day activity of the biggest campaign alone
    # scans ~100k sessions.
    return cache.get_or_compute(
        ("campaigns-page", sort, limit, offset),
        CAMPAIGNS_TTL_SECONDS,
        lambda: campaign_page(db, aggregate, sort, limit, offset),
    )


# Declared before /api/campaigns/{campaign_id} so "unique" is not taken for an id.
@router.get("/api/campaigns/unique")
async def list_unique_sessions(
    request: Request,
    sort: str = "commands",
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    if sort not in UNIQUE_SORT_KEYS:
        raise HTTPException(status_code=400, detail=f"invalid sort: {sort}")
    db = request.app.state.db
    cache = request.app.state.stats_cache
    aggregate = cached_aggregate(request.app)
    sessions = cache.get_or_compute(
        ("unique-sessions",),
        CAMPAIGNS_TTL_SECONDS,
        lambda: unique_sessions(db, aggregate["unique_session_ids"]),
    )
    return unique_sessions_page(sessions, sort, limit, offset)


@router.get("/api/campaigns/{campaign_id}")
async def get_campaign(request: Request, campaign_id: str):
    db = request.app.state.db
    cache = request.app.state.stats_cache
    aggregate = cached_aggregate(request.app)
    detail = cache.get_or_compute(
        ("campaign", campaign_id), CAMPAIGNS_TTL_SECONDS, lambda: campaign_detail(db, aggregate, campaign_id)
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="campaign not found")
    return detail
