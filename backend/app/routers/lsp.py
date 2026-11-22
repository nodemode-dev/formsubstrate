import asyncio
import contextlib
import json
import logging

from fastapi import APIRouter, Body, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.core import lsp, lsp_custom, trust, workspace_root
from app.core.local_guard import require_window

router = APIRouter()
OWNER = [Depends(require_window)]


class TrustBody(BaseModel):
    workspace: str = ""
    trusted: bool = False

CLOSE_BUSY = 4409

PASSIVE_REPLIES ={"client/registerCapability", "client/unregisterCapability", "window/workDoneProgress/create"}


def _root() -> str | None:
    try:
        return workspace_root.real_root()
    except workspace_root.Refused:
        return None


def _public(rep: lsp.Report) -> dict:
    active = rep.active
    return {
        "lang": rep.lang,
        "label": rep.label,
        "exts": rep.exts,
        "install": rep.install,
        "found": active is not None,
        "active": None if active is None else {"name": active.name, "path": active.path, "kind": active.kind, "version": active.version},
        "candidates": rep.candidates,
        "notes": rep.notes,
    }


def _answer(msg: dict) -> dict | None:
    method = msg.get("method")
    if "id" not in msg or not isinstance(method, str):
        return None
    if method in PASSIVE_REPLIES:
        return {"jsonrpc": "2.0", "id": msg["id"], "result": None}
    if method == "workspace/configuration":
        items = (msg.get("params") or {}).get("items")
        return {"jsonrpc": "2.0", "id": msg["id"], "result": [None] * (len(items) if isinstance(items, list) else 0)}
    return None


def _custom_public(entry: dict, root: str | None, trusted: bool) -> dict:
    path = lsp.custom_path(entry, root, trusted)
    return {**entry, "lang": f"{lsp_custom.PREFIX}{entry['id']}", "found": path is not None, "path": path, "install": lsp_custom.install_of(entry)}


def _custom_listing(root: str | None) -> dict:
    trusted = root is not None and trust.is_trusted(root)
    return {"root": root, "trusted": trusted, "servers": [_custom_public(e, root, trusted) for e in lsp_custom.all_servers()], "presets": lsp_custom.PRESETS}


def _refused(err: lsp_custom.Refused) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


@router.get("/lsp/servers")
async def servers() -> dict:
    root = _root()
    trusted = root is not None and trust.is_trusted(root)
    reports = await asyncio.to_thread(lsp.listing, root, trusted)
    custom = await asyncio.to_thread(_custom_listing, root)
    return {"root": root, "trusted": trusted, "running": lsp.live_count(), "servers": [_public(r) for r in reports], "custom": custom["servers"]}


@router.get("/lsp/custom")
async def custom_servers() -> dict:
    return await asyncio.to_thread(_custom_listing, _root())


@router.post("/lsp/custom", dependencies=OWNER)
async def add_custom(body: object = Body(...)) -> dict:
    try:
        entry = await asyncio.to_thread(lsp_custom.add, body)
    except lsp_custom.Refused as err:
        raise _refused(err)
    root = _root()
    return {"server": await asyncio.to_thread(_custom_public, entry, root, root is not None and trust.is_trusted(root))}


@router.put("/lsp/custom/{sid}", dependencies=OWNER)
async def change_custom(sid: str, body: object = Body(...)) -> dict:
    try:
        entry = await asyncio.to_thread(lsp_custom.change, sid, body)
    except lsp_custom.Refused as err:
        raise _refused(err)
    await lsp.stop_lang(f"{lsp_custom.PREFIX}{sid}")
    root = _root()
    return {"server": await asyncio.to_thread(_custom_public, entry, root, root is not None and trust.is_trusted(root))}


@router.delete("/lsp/custom/{sid}", dependencies=OWNER)
async def remove_custom(sid: str) -> dict:
    try:
        await asyncio.to_thread(lsp_custom.remove, sid)
    except lsp_custom.Refused as err:
        raise _refused(err)
    await lsp.stop_lang(f"{lsp_custom.PREFIX}{sid}")
    return {"removed": sid}


@router.post("/lsp/trust", dependencies=OWNER)
async def announce_trust(body: TrustBody) -> dict:
    answer = trust.set_trust(body.workspace, body.trusted)
    root = _root()
    if root is not None and not trust.is_trusted(root):
        await lsp.stop_trusted_only(root)
    return answer


@router.websocket("/lsp/ws")
async def lsp_ws(ws: WebSocket) -> None:
    await ws.accept()
    lang = ws.query_params.get("lang", "")
    root = _root()

    async def refuse(message: str, install: list[str], code: int = 1000, reason: str = "missing") -> None:
        with contextlib.suppress(Exception):
            await ws.send_text(json.dumps({"jsonrpc": "2.0", "method": "formsubstrate/serverUnavailable", "params": {"lang": lang, "error": message, "install": install, "reason": reason}}))
            await ws.close(code=code, reason=message[:120])

    if root is None:
        await refuse("no workspace is open", [])
        return
    try:
        proc = await lsp.spawn(lang, root, trust.is_trusted(root))
    except lsp.Unavailable as exc:
        await refuse(str(exc), exc.install, reason=exc.reason)
        return
    except lsp.Busy as exc:
        await refuse(str(exc), [], CLOSE_BUSY)
        return
    except OSError as exc:
        await refuse(f"the language server did not start: {exc}", [])
        return

    async def client_to_server() -> None:
        while True:
            text = await ws.receive_text()
            try:
                msg = json.loads(text)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            if proc.init is not None and msg.get("method") == "initialize" and isinstance(msg.get("params"), dict):
                msg["params"]["initializationOptions"] = proc.init
            await proc.send(msg)

    async def server_to_client() -> None:
        async for msg in proc.messages():
            reply = _answer(msg)
            if reply is not None:
                await proc.send(reply)
                continue
            if msg.get("method") == "textDocument/publishDiagnostics":
                lsp.record_diagnostics(root, msg.get("params"), proc)
            await ws.send_text(json.dumps(msg))

    tasks: list[asyncio.Task] = []
    try:
        await ws.send_text(json.dumps({"jsonrpc": "2.0", "method": "formsubstrate/serverStarted", "params": {"lang": lang, "name": proc.resolved.name, "kind": proc.resolved.kind, "version": proc.resolved.version, "root": root}}))
        if lang.startswith(lsp_custom.PREFIX):
            logging.getLogger("formsubstrate").info("started the custom language server %s: %s", lang, proc.resolved.path)
        tasks = [asyncio.create_task(client_to_server()), asyncio.create_task(server_to_client())]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    except Exception:
        logging.getLogger("formsubstrate").warning("a language server session for %s ended with an error", lang, exc_info=True)
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        await asyncio.shield(proc.stop())
        with contextlib.suppress(Exception):
            await ws.close()
