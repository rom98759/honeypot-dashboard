import sqlite3

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.admin_ips import add_admin_network, export_admin_networks, list_admin_networks, remove_admin_network
from app.routers.ip import verify_dashboard_origin

router = APIRouter()


class AdminNetworkIn(BaseModel):
    value: str
    note: str | None = None


@router.get("/api/settings/admin-ips")
async def get_admin_ips(request: Request):
    return {
        "items": list_admin_networks(request.app.state.db),
        "env": [str(n) for n in request.app.state.admin_networks],
    }


@router.post("/api/settings/admin-ips", status_code=201)
async def post_admin_ip(request: Request, body: AdminNetworkIn):
    verify_dashboard_origin(request)
    try:
        cidr = add_admin_network(request.app.state.db, body.value, body.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="already listed") from exc
    export_admin_networks(request.app)
    return {"cidr": cidr}


@router.delete("/api/settings/admin-ips", status_code=204)
async def delete_admin_ip(request: Request, cidr: str):
    verify_dashboard_origin(request)
    if not remove_admin_network(request.app.state.db, cidr):
        raise HTTPException(status_code=404, detail="not listed")
    export_admin_networks(request.app)
    return Response(status_code=204)
