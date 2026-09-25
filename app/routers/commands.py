from fastapi import APIRouter, HTTPException, Query, Request

from app.commands_stats import get_commands_stats
from app.periods import VALID_PERIODS

router = APIRouter()


@router.get("/api/commands")
async def list_commands(
    request: Request,
    period: str = "24h",
    q: str = "",
    limit: int = Query(25, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"invalid period: {period}")
    return get_commands_stats(request.app.state.db, period, q, limit, offset)
