from fastapi import APIRouter, HTTPException, Request

from app.heatmap_stats import get_heatmap_stats
from app.overview_stats import get_overview_stats
from app.periods import VALID_PERIODS

router = APIRouter()


@router.get("/api/overview")
async def get_overview(request: Request, period: str = "24h"):
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"invalid period: {period}")
    return get_overview_stats(request.app.state.db, period)


@router.get("/api/overview/heatmap")
async def get_overview_heatmap(request: Request):
    return {"cells": get_heatmap_stats(request.app.state.db)}
