import os
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core import workspace_root as ws
from app.core.binres import find_bin
from app.core.local_guard import require_window
from app.routers import tools as tools_router
from app.services import mcp_tools
from app.services import formslot as formslot_service
from app.services.library.mcp_client import McpServerConfig, mcp_clients, valid_name

router = APIRouter(prefix="/mcp-servers")

HEADER_NAME_MAX = 64
HEADER_VALUE_MAX = 2048
HEADERS_MAX = 16


class ServerBody(BaseModel):
    name: str
    transport: str = "http"
    url: str = ""
    command: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    sessions: bool = False


class EnabledBody(BaseModel):
    enabled: bool


def builtin_rows() -> list[dict]:
    rows = [{"name": "subform", "origin": "builtin", "transport": "http", "url": "/mcp", "command": "", "status": "connected", "detail": "this engine", "tools": len(mcp_tools.TOOLS), "enabled": True}]
    from app.core import config

    launcher = config.REPO_DIR / ("subform.bat" if os.name == "nt" else "subform")
    rows.append({"name": "subform launcher", "origin": "builtin", "transport": "stdio", "url": "", "command": f"{launcher} mcp" if launcher.is_file() else "", "status": "connected" if launcher.is_file() else "missing", "detail": "written into session mcp.json" if launcher.is_file() else "not next to the engine", "tools": len(mcp_tools.TOOLS), "enabled": True})
    formmcp = os.environ.get("FORMMCP_BIN") or find_bin("formmcp")
    rows.append({"name": "formMCP", "origin": "builtin", "transport": "stdio", "url": "", "command": os.path.abspath(formmcp) if formmcp and os.path.isfile(formmcp) else "", "status": "connected" if formmcp and os.path.isfile(formmcp) else "missing", "detail": "written into session mcp.json" if formmcp else "not found", "tools": 0, "enabled": True})
    slot = formslot_service.binary()
    rows.append({"name": "formslot", "origin": "builtin", "transport": "stdio", "url": "", "command": f"{slot} mcp" if slot else "", "status": "connected" if slot else "missing", "detail": "written into session mcp.json" if slot else "not found", "tools": 0, "enabled": True})
    return rows


@router.get("")
async def list_servers() -> dict:
    await tools_router.ensure()
    return {"servers": mcp_clients.summary(), "builtin": builtin_rows()}


@router.post("", dependencies=[Depends(require_window)])
async def add_server(body: ServerBody) -> dict:
    await tools_router.ensure()
    try:
        name = valid_name(body.name)
    except ws.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)
    if body.transport not in ("http", "stdio"):
        raise HTTPException(400, "transport is http or stdio")
    if body.transport == "http":
        parts = urlsplit(body.url.strip())
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise HTTPException(400, "an http server needs an http:// or https:// url")
    elif not body.command.strip():
        raise HTTPException(400, "a stdio server needs a command")
    if len(body.headers) > HEADERS_MAX or any(not k or len(k) > HEADER_NAME_MAX or len(v) > HEADER_VALUE_MAX or "\n" in k + v for k, v in body.headers.items()):
        raise HTTPException(400, "headers are at most 16 short single-line pairs")
    cfg = McpServerConfig(name=name, transport=body.transport, url=body.url.strip(), command=body.command.strip(), enabled=body.enabled, sessions=body.sessions)
    try:
        srv = await mcp_clients.add(cfg, body.headers)
    except Exception as error:
        raise HTTPException(503, f"could not store the headers: {error.__class__.__name__}")
    return {"status": srv.status, "detail": srv.detail, "servers": mcp_clients.summary()}


@router.post("/{name}/refresh", dependencies=[Depends(require_window)])
async def refresh(name: str) -> dict:
    await tools_router.ensure()
    if name not in mcp_clients.servers:
        raise HTTPException(404, "no such server")
    srv = await mcp_clients.connect(name)
    return {"status": srv.status, "detail": srv.detail, "tools": len(srv.tools), "servers": mcp_clients.summary()}


@router.post("/{name}/enabled", dependencies=[Depends(require_window)])
async def enabled(name: str, body: EnabledBody) -> dict:
    await tools_router.ensure()
    if name not in mcp_clients.servers:
        raise HTTPException(404, "no such server")
    srv = await mcp_clients.set_enabled(name, body.enabled)
    return {"status": srv.status, "detail": srv.detail, "servers": mcp_clients.summary()}


@router.delete("/{name}", dependencies=[Depends(require_window)])
async def remove(name: str) -> dict:
    await tools_router.ensure()
    if not await mcp_clients.remove(name):
        raise HTTPException(404, "no such server")
    return {"removed": name, "servers": mcp_clients.summary()}
