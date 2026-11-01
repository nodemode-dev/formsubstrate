from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.core import workspace_root as ws
from app.core.local_guard import require_window
from app.services.library import plugins as svc
from app.routers import tools as tools_router

router = APIRouter(prefix="/plugins")


class EnabledIn(BaseModel):
    enabled: bool


class SettingsIn(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


async def _run(fn, *args):
    try:
        return await run_in_threadpool(fn, *args)
    except ws.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)


@router.get("")
async def list_plugins(trust: bool = False) -> dict:
    await tools_router.ensure()
    return {"plugins": await _run(svc.listing, trust)}


@router.post("/reload", dependencies=[Depends(require_window)])
async def reload_plugins(trust: bool = False) -> dict:
    await tools_router.ensure()
    await _run(svc.reload, trust)
    return {"plugins": await _run(svc.listing, trust)}


@router.post("/{name}/enabled", dependencies=[Depends(require_window)])
async def enabled(name: str, body: EnabledIn, trust: bool = False) -> dict:
    await tools_router.ensure()
    return {"plugins": await _run(svc.set_enabled, name, body.enabled, trust)}


@router.get("/{name}/settings")
async def get_settings(name: str) -> dict:
    await tools_router.ensure()
    return await _run(svc.settings_view, name)


@router.post("/{name}/settings", dependencies=[Depends(require_window)])
async def save_settings(name: str, body: SettingsIn, trust: bool = False) -> dict:
    await tools_router.ensure()
    await _run(svc.save_settings, name, body.values)
    await _run(svc.reload, trust)
    return {"plugins": await _run(svc.listing, trust), "settings": await _run(svc.settings_view, name)}
