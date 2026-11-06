from fastapi import APIRouter, HTTPException, Request

from app.heatmap_stats import get_heatmap_stats
from app.overview_stats import get_overview_stats
from app.periods import VALID_PERIODS
from app.search_filter import FilterError, compile_filter

router = APIRouter()

# Longer periods cost more to aggregate and change less between two polls.
OVERVIEW_TTL_SECONDS = {"24h": 10, "7d": 30, "30d": 60, "all": 60}
HEATMAP_TTL_SECONDS = 300


@router.get("/api/overview")
async def get_overview(
    request: Request,
    period: str = "24h",
    country: str | None = None,
    protocol: str | None = None,
    ip: str | None = None,
    username: str | None = None,
    filter: str | None = None,
):
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"invalid period: {period}")
    try:
        _, _, canonical = compile_filter(filter, country=country, protocol=protocol, ip=ip, username=username)
    except FilterError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return request.app.state.stats_cache.get_or_compute(
        ("overview", period, canonical),
        OVERVIEW_TTL_SECONDS[period],
        lambda: get_overview_stats(request.app.state.db, period, {"filter": canonical}),
    )


@router.get("/api/overview/heatmap")
async def get_overview_heatmap(request: Request):
    return request.app.state.stats_cache.get_or_compute(
        ("heatmap",),
        HEATMAP_TTL_SECONDS,
        lambda: {"cells": get_heatmap_stats(request.app.state.db)},
    )
