import asyncio
import contextlib
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core import lsp, workspace_root

router = APIRouter()

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


@router.get("/lsp/servers")
async def servers() -> dict:
    root = _root()
    reports = await asyncio.to_thread(lsp.listing, root)
    return {"root": root, "running": lsp.live_count(), "servers": [_public(r) for r in reports]}


@router.websocket("/lsp/ws")
async def lsp_ws(ws: WebSocket) -> None:
    await ws.accept()
    lang = ws.query_params.get("lang", "")
    root = _root()

    async def refuse(message: str, install: list[str], code: int = 1000) -> None:
        with contextlib.suppress(Exception):
            await ws.send_text(json.dumps({"jsonrpc": "2.0", "method": "formsubstrate/serverUnavailable", "params": {"lang": lang, "error": message, "install": install}}))
            await ws.close(code=code, reason=message[:120])

    if root is None:
        await refuse("no workspace is open", [])
        return
    trust = ws.query_params.get("trust") == "1"
    try:
        proc = await lsp.spawn(lang, root, trust)
    except lsp.Unavailable as exc:
        await refuse(str(exc), exc.install)
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
            if isinstance(msg, dict):
                await proc.send(msg)

    async def server_to_client() -> None:
        async for msg in proc.messages():
            reply = _answer(msg)
            if reply is not None:
                await proc.send(reply)
                continue
            await ws.send_text(json.dumps(msg))

    tasks: list[asyncio.Task] = []
    try:
        await ws.send_text(json.dumps({"jsonrpc": "2.0", "method": "formsubstrate/serverStarted", "params": {"lang": lang, "name": proc.resolved.name, "kind": proc.resolved.kind, "version": proc.resolved.version, "root": root}}))
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
