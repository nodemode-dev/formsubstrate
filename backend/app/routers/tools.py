from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.local_guard import require_window
from app.services.library import activity, builtin, plugins
from app.services.library.mcp_client import mcp_clients
from app.services.library.registry import jsonable, tools

router = APIRouter()

_ready = False


async def ensure() -> None:
    global _ready
    if not _ready:
        _ready = True
        builtin.install()
        plugins.reload(False)
    await mcp_clients.ensure_loaded()


class ToolCall(BaseModel):
    name: str
    args: dict[str, Any] = Field(default_factory=dict)


class EventIn(BaseModel):
    label: str
    phase: str = "output"
    note: str | None = None
    source: str = "window"


@router.get("/tools")
async def list_tools() -> dict:
    await ensure()
    return {"tools": tools.definitions()}


@router.post("/tools/call", dependencies=[Depends(require_window)])
async def call_tool(body: ToolCall) -> dict:
    await ensure()
    if tools.get(body.name) is None:
        raise HTTPException(status_code=404, detail=f"unknown tool: {body.name}")
    activity.emit(body.name, "tool", None, "tools")
    result = jsonable(await tools.call(body.name, body.args))
    failed = isinstance(result, dict) and "error" in result
    activity.emit(body.name, "error" if failed else "output", str(result.get("error") if failed else result)[:300], "tools")
    return {"result": result}


@router.get("/activity")
async def feed(since: int = 0, limit: int = 200) -> dict:
    return activity.since(max(0, since), max(1, min(limit, 500)))


@router.post("/activity", dependencies=[Depends(require_window)])
async def push(body: EventIn) -> dict:
    return {"event": activity.emit(body.label, body.phase, body.note, body.source)}


@router.delete("/activity", dependencies=[Depends(require_window)])
async def clear() -> dict:
    return {"cleared": activity.clear()}
