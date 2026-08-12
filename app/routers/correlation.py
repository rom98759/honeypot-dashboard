from fastapi import APIRouter, Request

from app.correlation import get_correlation_rows

router = APIRouter()


@router.get("/api/correlation")
async def get_correlation(request: Request):
    return get_correlation_rows(request.app.state.db)
