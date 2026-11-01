from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool

from app.core.local_guard import require_window
from app.routers import tools as tools_router
from app.services.library import plugins as plugin_service
from app.services.presets import GROUPS, store

router = APIRouter()


def _fail(err: store.PresetError) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


@router.get("/presets")
async def summary() -> dict:
    return {"groups": list(GROUPS), "counts": await run_in_threadpool(store.counts)}


@router.get("/presets/{group}")
async def group_list(group: str) -> dict:
    try:
        return {"presets": await run_in_threadpool(store.listing, group)}
    except store.PresetError as err:
        raise _fail(err)


@router.get("/presets/{group}/{name}")
async def one(group: str, name: str) -> dict:
    try:
        return await run_in_threadpool(store.read, group, name)
    except store.PresetError as err:
        raise _fail(err)


@router.post("/presets/{group}/{name}/install", dependencies=[Depends(require_window)])
async def install(group: str, name: str, trust: bool = False, replace: bool = False) -> dict:
    try:
        out = await run_in_threadpool(store.install, group, name, replace, trust)
    except store.PresetError as err:
        raise _fail(err)
    if group == "plugins":
        await tools_router.ensure()
        listing = await run_in_threadpool(plugin_service.reload, True)
        me = next((p for p in listing if p.path.endswith(f"/{name}.py")), None)
        out["tools"] = me.tools if me else []
        out["error"] = me.error if me else None
    return out
