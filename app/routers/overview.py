from fastapi import APIRouter, HTTPException, Request

from app.heatmap_stats import get_heatmap_stats
from app.overview_stats import get_overview_stats
from app.periods import VALID_PERIODS

router = APIRouter()


@router.get("/api/overview")
async def get_overview(
    request: Request,
    period: str = "24h",
    country: str | None = None,
    protocol: str | None = None,
    ip: str | None = None,
    username: str | None = None,
):
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"invalid period: {period}")
    filters = {"country": country, "protocol": protocol, "ip": ip, "username": username}
    return get_overview_stats(request.app.state.db, period, filters)


@router.get("/api/overview/heatmap")
async def get_overview_heatmap(request: Request):
    return {"cells": get_heatmap_stats(request.app.state.db)}
