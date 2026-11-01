from fastapi import APIRouter, HTTPException, Query, Request

from app.campaigns_stats import SORT_KEYS, campaign_detail, campaign_page, compute_campaigns

router = APIRouter()

# Grouping every ttylog takes ~2 s on the VPS and campaigns move slowly.
CAMPAIGNS_TTL_SECONDS = 300


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
    aggregate = request.app.state.stats_cache.get_or_compute(
        ("campaigns",), CAMPAIGNS_TTL_SECONDS, lambda: compute_campaigns(db)
    )
    return campaign_page(db, aggregate, sort, limit, offset)


@router.get("/api/campaigns/{campaign_id}")
async def get_campaign(request: Request, campaign_id: str):
    detail = campaign_detail(request.app.state.db, campaign_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="campaign not found")
    return detail
