import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from app.core.local_guard import WINDOW_HEADER
from app.services import mcp_tools

router = APIRouter()

BODY_MAX = 1024 * 1024
BATCH_MAX = 20
SESSION_HEADER = "x-formsubstrate-session"
VERSION_HEADER = "mcp-protocol-version"
BATCHLESS = "2025-06-18"


def _token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer ") and auth[7:].strip():
        return auth[7:].strip()
    return request.headers.get(SESSION_HEADER) or request.headers.get(WINDOW_HEADER.lower())


def _problem(status: int, code: int, message: str, extra: dict | None = None) -> JSONResponse:
    headers = {"WWW-Authenticate": 'Bearer realm="formsubstrate"'} if status == 401 else {}
    headers.update(extra or {})
    return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": code, "message": message}}, status_code=status, headers=headers)


@router.post("/mcp")
async def mcp_post(request: Request) -> Response:
    token = _token(request)
    if not token:
        return _problem(401, -32001, "send Authorization: Bearer <token>: the session token from FORMSUBSTRATE_GATE_TOKEN, a client token from FORMSUBSTRATE_MCP_TOKEN, or the window token; add a client in Substrate's Preferences, Agents, MCP clients")
    who = mcp_tools.principal(token)
    if who is None:
        return _problem(403, -32001, "that token is not valid for this engine; add a client in Substrate's Preferences, Agents, MCP clients, and use the token it shows")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > BODY_MAX:
        return _problem(413, -32600, "the request is larger than 1 MiB")
    raw = await request.body()
    if len(raw) > BODY_MAX:
        return _problem(413, -32600, "the request is larger than 1 MiB")
    try:
        parsed = json.loads(raw)
    except ValueError:
        return _problem(400, -32700, "the body is not JSON")
    version = request.headers.get(VERSION_HEADER)
    if version is not None and version.strip() not in mcp_tools.VERSIONS:
        ident = parsed.get("id") if isinstance(parsed, dict) else None
        shown = "".join(c for c in version.strip()[:40] if c.isprintable())
        message = f"unsupported MCP-Protocol-Version {shown}; Substrate follows 2025-11-25 and 2025-06-18; send initialize"
        return JSONResponse(mcp_tools._rpc_error(ident if mcp_tools._ident_ok(ident) else None, -32600, message), status_code=400)
    if isinstance(parsed, list) and version is not None and version.strip() >= BATCHLESS:
        return _problem(400, -32600, f"MCP {version.strip()} has no batches; send one JSON-RPC message per request")
    headers: dict = {}
    if isinstance(parsed, list):
        if not parsed:
            return _problem(400, -32600, "an empty batch is not a request")
        if len(parsed) > BATCH_MAX:
            return _problem(400, -32600, "a batch holds at most 20 messages")
        answers = []
        for message in parsed:
            answer, extra = await mcp_tools.handle(message, who)
            headers.update(extra)
            if answer is not None:
                answers.append(answer)
        if not answers:
            return Response(status_code=202)
        return JSONResponse(answers, headers=headers)
    answer, headers = await mcp_tools.handle(parsed, who)
    if answer is None:
        return Response(status_code=202)
    return JSONResponse(answer, headers=headers)


@router.api_route("/mcp", methods=["GET", "DELETE"])
async def mcp_other() -> Response:
    return Response(status_code=405, headers={"Allow": "POST"})
