from fastapi import APIRouter, Request

from app.proxied_ip import PROXIED_SOURCE_IP

router = APIRouter()


@router.get("/api/config")
async def get_config(request: Request):
    return {
        "sshd_port": request.app.state.sshd_port,
        "ban_enabled": request.app.state.ban_enabled,
        "proxied_source_ip": PROXIED_SOURCE_IP,
    }
