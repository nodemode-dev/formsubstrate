import asyncio
import contextlib
import json

from fastapi import APIRouter, Body, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.core import debug, debug_launch, trust, workspace_root as ws
from app.core.local_guard import require_window

router = APIRouter()
OWNER = [Depends(require_window)]

CLOSE_BUSY = 4409
CLOSE_UNAVAILABLE = 4404
CLOSE_EXITED = 1000
CLOSE_ERROR = 4500


def current_root() -> str | None:
    try:
        return ws.real_root()
    except ws.Refused:
        return None


@router.get("/debug/adapters")
def adapters() -> dict:
    root = current_root()
    answer = debug.describe(root, None, root is not None and trust.is_trusted(root))
    answer["adapters"].append(debug.describe_node())
    return answer


@router.get("/debug/launch")
def launch_file() -> dict:
    return debug_launch.listing(current_root())


@router.post("/debug/launch", dependencies=OWNER)
def create_launch_file() -> dict:
    try:
        ws.real_root()
        return debug_launch.create()
    except ws.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)


@router.get("/debug/settings")
def read_settings() -> dict:
    return debug.settings()


@router.put("/debug/settings", dependencies=OWNER)
def write_settings(body: object = Body(...)) -> dict:
    try:
        return debug.save_settings(body)
    except ws.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)


def failure(request: dict, message: str) -> dict:
    return {"type": "response", "request_seq": request.get("seq", 0), "seq": 0, "success": False, "command": request.get("command", ""), "message": message}


def notice(event: str, body: dict) -> str:
    return json.dumps({"type": "event", "seq": 0, "event": event, "body": body})


async def refuse(socket: WebSocket, event: str, body: dict, code: int) -> None:
    await socket.send_text(notice(event, body))
    with contextlib.suppress(Exception):
        await socket.close(code)


@router.websocket("/debug/ws")
async def debug_ws(socket: WebSocket) -> None:
    await socket.accept()
    if debug.slot.busy:
        await refuse(socket, "formsubstrate/busy", {"message": "a debug session is already running"}, CLOSE_BUSY)
        return
    debug.slot.busy = True
    adapter: debug.Adapter | None = None
    try:
        root = current_root()
        if root is None:
            await refuse(socket, "formsubstrate/unavailable", {"message": "no workspace is open"}, CLOSE_UNAVAILABLE)
            return
        kind = "node" if socket.query_params.get("adapter") == "node" else "python"
        if kind == "node":
            tools = await run_in_threadpool(debug.resolve_node)
            if not tools["node"] or not tools["server"]:
                info = debug.describe_node(tools)
                await refuse(socket, "formsubstrate/unavailable", {"message": info["note"], "reason": info["reason"]}, CLOSE_UNAVAILABLE)
                return
            runtime = tools["node"]
        else:
            found = await run_in_threadpool(debug.resolve_python, root, trust.is_trusted(root))
            if found["adapter"] is None or found["debuggee"] is None:
                info = debug.describe(root, found)["adapters"][0]
                await refuse(socket, "formsubstrate/unavailable", {"message": info["note"], "install": info["install"]}, CLOSE_UNAVAILABLE)
                return
            runtime = found["debuggee"]
        try:
            adapter = await debug.spawn_node(tools["node"], tools["server"], root) if kind == "node" else await debug.spawn(found["adapter"]["python"], root)
        except OSError as err:
            await refuse(socket, "formsubstrate/unavailable", {"message": str(err)}, CLOSE_UNAVAILABLE)
            return
        debug.slot.adapter = adapter
        await relay(socket, adapter, root, kind, runtime)
    finally:
        if adapter is not None:
            await adapter.stop()
        if debug.slot.adapter is adapter:
            debug.slot.adapter = None
        debug.slot.busy = False
        with contextlib.suppress(Exception):
            await socket.close()


async def relay(socket: WebSocket, adapter: debug.Adapter, root: str, kind: str, runtime: str) -> None:
    async def upstream() -> None:
        while True:
            text = await socket.receive_text()
            try:
                message = json.loads(text)
            except ValueError:
                continue
            if not isinstance(message, dict):
                continue
            if message.get("type") != "request":
                continue
            command = message.get("command")
            if command not in debug.ALLOWED:
                await socket.send_text(json.dumps(failure(message, f"{command} is not offered")))
                continue
            if command == "launch":
                try:
                    message["arguments"] = await run_in_threadpool(debug.launch_arguments, message.get("arguments"), root, kind, runtime)
                except ws.Refused as err:
                    await socket.send_text(json.dumps(failure(message, err.detail)))
                    continue
            await adapter.send(message)

    async def downstream() -> None:
        while True:
            try:
                message = await adapter.receive()
            except debug.HeaderTooLong as err:
                await socket.send_text(notice("formsubstrate/adapterError", {"message": str(err)}))
                await socket.close(CLOSE_ERROR)
                return
            if message is None:
                tail = adapter.tail.decode("utf-8", "replace").strip()
                await socket.send_text(notice("formsubstrate/adapterExited", {"stderr": tail}))
                return
            if message.get("type") == "event" and message.get("event") == "process":
                pid = (message.get("body") or {}).get("systemProcessId")
                if isinstance(pid, int):
                    adapter.note_debuggee(pid)
            if message.get("type") == "event" and message.get("event") in ("exited", "terminated"):
                adapter.forget_debuggee()
            if message:
                await socket.send_text(json.dumps(message))

    tasks = [asyncio.create_task(upstream()), asyncio.create_task(downstream())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
