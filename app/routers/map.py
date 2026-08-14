from fastapi import APIRouter, HTTPException, Request

from app.attack_map import VALID_PERIODS, get_map_points

router = APIRouter()


@router.get("/api/map")
async def get_map(request: Request, period: str = "24h"):
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"invalid period: {period}")

    db = request.app.state.db
    points = get_map_points(db, period)

    vps_latitude = request.app.state.vps_latitude
    vps_longitude = request.app.state.vps_longitude
    destination = (
        {"latitude": vps_latitude, "longitude": vps_longitude}
        if vps_latitude is not None and vps_longitude is not None
        else None
    )

    return {"points": points, "destination": destination}
