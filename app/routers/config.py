from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/api/config")
async def get_config(request: Request):
    return {"sshd_port": request.app.state.sshd_port, "ban_enabled": request.app.state.ban_enabled}
