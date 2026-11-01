from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core import workspace_root as ws
from app.core.local_guard import require_window
from app.services.cogentics import checkpoints, usage
from app.services.cogentics.paths import root as ws_root


def need_workspace() -> None:
    try:
        ws.real_root()
    except ws.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)


router = APIRouter(prefix="/insight", dependencies=[Depends(need_workspace)])


def _path(rel: str, write: bool = False) -> str:
    try:
        return ws.resolve(rel, write=write)[1]
    except ws.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)


def _known(scope: str) -> None:
    if not any(s["id"] == scope for s in checkpoints.scopes(ws_root(), 500)):
        raise HTTPException(404, f"no checkpoint scope: {scope}")


@router.get("/usage/summary")
async def usage_summary(days: int = 7) -> dict:
    return usage.meter(ws_root()).summary(days=max(1, min(days, 90)))


@router.get("/usage/scope/{prefix:path}")
async def usage_scope(prefix: str, days: int = 30) -> dict:
    return usage.meter(ws_root()).for_scope(prefix, days=max(1, min(days, 90)))


@router.get("/scopes")
async def scopes(limit: int = 60) -> dict:
    return {"scopes": checkpoints.scopes(ws_root(), max(1, min(limit, 200)))}


@router.get("/scopes/{scope}/changes")
async def changes(scope: str) -> dict:
    _known(scope)
    return {"scope": scope, "changes": checkpoints.changes(ws_root(), scope)}


@router.get("/scopes/{scope}/file")
async def file_versions(scope: str, path: str) -> dict:
    _known(scope)
    rel = _path(path)
    return {"path": rel, **checkpoints.file_versions(ws_root(), scope, rel)}


@router.get("/scopes/{scope}/diff")
async def diff(scope: str, path: str) -> dict:
    _known(scope)
    rel = _path(path)
    return {"path": rel, "diff": checkpoints.diff(ws_root(), scope, rel)}


class RevertBody(BaseModel):
    path: str


@router.post("/scopes/{scope}/revert", dependencies=[Depends(require_window)])
async def revert(scope: str, body: RevertBody) -> dict:
    _known(scope)
    rel = _path(body.path, write=True)
    res = checkpoints.revert(ws_root(), scope, rel)
    if res.get("error"):
        raise HTTPException(400, res["error"])
    return res
