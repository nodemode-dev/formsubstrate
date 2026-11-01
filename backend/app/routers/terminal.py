import asyncio
import base64
import fnmatch
import json
import os
import re
import secrets
import shutil
import struct
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.core import binres, config, workspace_root
from app.core.local_guard import require_window
from app.services import ptyhost_client
from app.services.ptyhost_client import PtyHostError, PtyHostMissing

router = APIRouter()

ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
ID_RE = re.compile(r"^[a-z0-9]{16}$")
SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
TITLE_RE = re.compile(rb"\x1b\][02];([^\x07\x1b]{0,200})(?:\x07|\x1b\\)")
OUTPUT_KIND = b"\x01"
SUB_QUEUE_CAP = 8 * 1024 * 1024
INPUT_CAP = 1024 * 1024


class TerminalCreate(BaseModel):
    kind: Literal["shell", "claude"] = "shell"
    cwd: str | None = None
    title: str | None = Field(default=None, max_length=120)
    sessionId: str | None = Field(default=None, max_length=64)
    cols: int = Field(default=100, ge=1, le=1000)
    rows: int = Field(default=30, ge=1, le=500)


class TerminalOwned(BaseModel):
    argv: list[str] = Field(min_length=1, max_length=16)
    title: str | None = Field(default=None, max_length=120)
    cols: int = Field(default=100, ge=1, le=1000)
    rows: int = Field(default=30, ge=1, le=500)


def owned_argv(argv: list[str]) -> list[str]:
    for part in argv:
        if len(part) > 2048 or any(ord(ch) < 32 or ord(ch) == 127 for ch in part):
            raise HTTPException(400, "bad command")
    program = argv[0]
    if not os.path.isabs(program) or not os.path.isfile(program):
        raise HTTPException(400, "the command must be the absolute path of an existing program")
    if sys.platform == "win32":
        if program.lower().endswith((".bat", ".cmd")):
            return [os.environ.get("COMSPEC") or "cmd.exe", "/c", *argv]
        return argv
    if not os.access(program, os.X_OK):
        raise HTTPException(400, "that program is not executable")
    return argv


def new_id() -> str:
    return "".join(secrets.choice(ID_ALPHABET) for _ in range(16))


def worktrees_root() -> str:
    return os.path.realpath(config.data_dir() / "worktrees")


def confine(cwd: str | None) -> str:
    try:
        if not cwd or cwd in (".", "./"):
            return workspace_root.real_root()
        flat = cwd.replace("\\", "/")
        if "\0" in cwd:
            raise workspace_root.Refused(400, "bad path")
        if os.path.isabs(cwd) or flat.startswith("/") or (len(flat) > 1 and flat[1] == ":"):
            real = os.path.realpath(cwd)
            allowed = [worktrees_root()]
            if workspace_root.current() is not None:
                allowed.append(workspace_root.real_root())
            if not any(workspace_root._inside(real, base) for base in allowed):
                raise workspace_root.Refused(403, "the terminal folder must be inside the open workspace or a session worktree")
            return real
        real, _ = workspace_root.resolve(cwd)
        return real
    except workspace_root.Refused as exc:
        raise HTTPException(exc.status, exc.detail) from exc


def shell_argv() -> list[str]:
    if sys.platform == "win32":
        return [os.environ.get("COMSPEC") or "cmd.exe"]
    shell = os.environ.get("SHELL") or "/bin/bash"
    if not os.path.isfile(shell):
        shell = shutil.which("bash") or "/bin/sh"
    return [shell, "-l"]


PARENT_DROP_PREFIX = ("CCR_", "AI_AGENT", "CLAUDE_AUTO", "CLAUDE_AFTER_", "CLAUDE_EFFORT", "CLAUDE_PID", "CLAUDE_PROJECT_", "CLAUDE_INTERNAL_", "CLAUDE_ENABLE_", "CLAUDE_CHROME_", "CLAUDE_CLIENT_", "CLAUDE_ADDITIONAL_")
PARENT_DROP_EXACT = frozenset(("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CONTAINER_ID", "CLAUDE_CODE_WORKER_EPOCH"))
PARENT_DROP_GLOB = ("*_SSE_PORT", "*_SESSION_*", "*_SESSION", "*_WEBSOCKET_*", "*_REMOTE*", "*_CCR_*", "*_MESSAGING_*")
PARENT_KEEP = frozenset(("CLAUDE_SESSION_INGRESS_TOKEN_FILE",))


def _parent_marker(key: str) -> bool:
    if key in PARENT_KEEP:
        return False
    if key in PARENT_DROP_EXACT or key.startswith(PARENT_DROP_PREFIX):
        return True
    return key.startswith("CLAUDE") and any(fnmatch.fnmatchcase(key, pattern) for pattern in PARENT_DROP_GLOB)


def inherited_env() -> dict[str, str]:
    return {key: value for key, value in os.environ.items() if not _parent_marker(key)}


def terminal_env() -> dict[str, str]:
    env = inherited_env()
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["SUBFORM_TERMINAL"] = "1"
    return env


def find_mcp_config(cwd: str, session_id: str) -> str | None:
    if not SESSION_RE.match(session_id):
        return None
    base = Path(worktrees_root())
    if base.is_dir():
        for found in base.glob(f"*/{session_id}/.subform/mcp.json"):
            return str(found)
    return None


def iso(stamp: float) -> str:
    return datetime.fromtimestamp(stamp, timezone.utc).isoformat(timespec="seconds")


def shape(item: dict) -> dict:
    meta = item.get("meta") or {}
    tid = item["id"]
    return {
        "id": tid,
        "title": hub.titles.get(tid) or meta.get("title") or tid,
        "kind": meta.get("kind") or "shell",
        "cwd": item.get("cwd"),
        "sessionId": meta.get("sessionId"),
        "alive": bool(item.get("alive")),
        "exitCode": item.get("exitCode"),
        "created": iso(item.get("created") or 0),
    }


class Sub:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.queue: asyncio.Queue = asyncio.Queue()
        self.next: dict[str, int | None] = {}
        self.owed: dict[str, int] = {}
        self.queued = 0
        self.task: asyncio.Task | None = None

    async def writer(self) -> None:
        try:
            while True:
                item = await self.queue.get()
                if item is None:
                    return
                if isinstance(item, tuple):
                    tid, size, frame = item
                    await self.ws.send_bytes(frame)
                    self.queued -= size
                    if tid in self.next:
                        self.owed[tid] = self.owed.get(tid, 0) + size
                    else:
                        try:
                            await ptyhost_client.get_client().send({"op": "ack", "id": tid, "bytes": size})
                        except PtyHostError:
                            pass
                else:
                    await self.ws.send_text(item)
        except (WebSocketDisconnect, RuntimeError, OSError):
            return

    def take(self, tid: str, count: int) -> int:
        have = self.owed.get(tid, 0)
        given = min(have, count)
        self.owed[tid] = have - given
        return given

    def text(self, obj: dict) -> None:
        self.queue.put_nowait(json.dumps(obj, separators=(",", ":")))


class Hub:
    def __init__(self) -> None:
        self.by_id: dict[str, list[Sub]] = {}
        self.pending: dict[str, deque[Sub]] = {}
        self.titles: dict[str, str] = {}
        self.task: asyncio.Task | None = None

    def start(self) -> None:
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self.pump())

    async def stop(self) -> None:
        task, self.task = self.task, None
        await ptyhost_client.close_client()
        if task is not None:
            try:
                await asyncio.wait_for(task, 2)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                task.cancel()
        self.by_id.clear()
        self.pending.clear()

    async def pump(self) -> None:
        client = ptyhost_client.get_client()
        async for msg in client.events():
            try:
                await self.dispatch(client, msg)
            except Exception:
                continue

    async def dispatch(self, client, msg: dict) -> None:
        op = msg.get("op")
        tid = msg.get("id")
        if op == "output":
            data = base64.b64decode(msg.get("data") or "")
            await self.output(client, tid, int(msg.get("seq", 0)), data)
        elif op == "attached":
            queue = self.pending.get(tid)
            if queue:
                sub = queue.popleft()
                sub.next[tid] = int(msg.get("from", 0))
        elif op == "exit":
            for sub in self.by_id.get(tid, []):
                sub.text({"t": "exit", "id": tid, "code": msg.get("code")})
        elif op == "error" and tid:
            targets = list(self.by_id.get(tid, []))
            queue = self.pending.get(tid)
            while queue:
                sub = queue.popleft()
                if sub not in targets:
                    targets.append(sub)
            for sub in targets:
                sub.text({"t": "error", "id": tid, "message": msg.get("message") or "terminal error"})
        elif op == "connected":
            for known, subs in list(self.by_id.items()):
                for sub in subs:
                    self.pending.setdefault(known, deque()).append(sub)
                    await client.send({"op": "attach", "id": known, "from": sub.next.get(known)})

    async def output(self, client, tid: str, seq: int, data: bytes) -> None:
        sent = 0
        header = OUTPUT_KIND + tid.encode("ascii")
        for sub in list(self.by_id.get(tid, [])):
            want = sub.next.get(tid)
            if want is None:
                continue
            end = seq + len(data)
            if end <= want:
                continue
            if sub.queued > SUB_QUEUE_CAP:
                await self.drop(sub)
                continue
            chunk = data[want - seq:] if want > seq else data
            start = max(seq, want)
            sub.queue.put_nowait((tid, len(chunk), header + struct.pack(">Q", start) + chunk))
            sub.queued += len(chunk)
            sub.next[tid] = end
            sent = max(sent, len(chunk))
        if len(data) > sent:
            await client.send({"op": "ack", "id": tid, "bytes": len(data) - sent})
        found = TITLE_RE.findall(data)
        if found:
            title = found[-1].decode("utf-8", "replace").strip()
            if title and self.titles.get(tid) != title:
                self.titles[tid] = title
                for sub in self.by_id.get(tid, []):
                    sub.text({"t": "title", "id": tid, "title": title})

    async def attach(self, sub: Sub, tid: str, start: int | None) -> None:
        client = ptyhost_client.get_client()
        if not await client.ensure(start=False):
            raise PtyHostMissing("there are no terminals")
        subs = self.by_id.setdefault(tid, [])
        if sub not in subs:
            subs.append(sub)
        sub.next[tid] = None
        self.pending.setdefault(tid, deque()).append(sub)
        await client.send({"op": "attach", "id": tid, "from": start})

    async def drop(self, sub: Sub) -> None:
        for known in list(sub.next):
            await self.detach(sub, known)
        sub.queue.put_nowait(None)
        try:
            await sub.ws.close(code=1013)
        except (RuntimeError, OSError):
            pass

    async def detach(self, sub: Sub, tid: str) -> None:
        subs = self.by_id.get(tid)
        if subs and sub in subs:
            subs.remove(sub)
        sub.next.pop(tid, None)
        queue = self.pending.get(tid)
        if queue and sub in queue:
            queue.remove(sub)
        left = sub.owed.pop(tid, 0)
        if left > 0 and subs:
            try:
                await ptyhost_client.get_client().send({"op": "ack", "id": tid, "bytes": left})
            except PtyHostError:
                pass
        if not subs:
            self.by_id.pop(tid, None)
            try:
                await ptyhost_client.get_client().send({"op": "detach", "id": tid})
            except PtyHostError:
                pass


hub = Hub()


def host_error(exc: PtyHostError) -> HTTPException:
    if isinstance(exc, PtyHostMissing):
        return HTTPException(503, str(exc))
    return HTTPException(502, str(exc))


async def launch(
    kind: str,
    cwd: str,
    title: str | None = None,
    session_id: str | None = None,
    cols: int = 100,
    rows: int = 30,
    argv: list[str] | None = None,
    env_extra: dict[str, str] | None = None,
) -> dict:
    if argv is None:
        if kind == "claude":
            found = binres.find_bin("claude")
            if not found:
                raise HTTPException(404, "the claude command was not found on this computer; install Claude Code or set SUBFORM_BIN_DIR")
            argv = [found]
            if session_id:
                mcp = find_mcp_config(cwd, session_id)
                if mcp:
                    argv += ["--mcp-config", mcp]
        else:
            argv = shell_argv()
    client = ptyhost_client.get_client()
    try:
        existing = await client.list(start=False)
        same = sum(1 for item in existing if (item.get("meta") or {}).get("kind", "shell") == kind)
        label = title or f"{'Claude' if kind == 'claude' else 'Terminal'} {same + 1}"
        tid = new_id()
        env = terminal_env()
        if env_extra:
            env.update(env_extra)
        await client.request(
            {"op": "spawn", "id": tid, "cwd": cwd, "argv": argv, "env": env, "cols": cols, "rows": rows,
             "meta": {"title": label, "kind": kind, "sessionId": session_id}},
            ("spawned",),
        )
        hub.start()
        items = await client.list()
    except PtyHostMissing as exc:
        raise host_error(exc) from exc
    except PtyHostError as exc:
        raise HTTPException(400, str(exc)) from exc
    for item in items:
        if item["id"] == tid:
            return shape(item)
    raise HTTPException(502, "the terminal did not start")


@router.get("/terminals")
async def list_terminals() -> dict:
    try:
        items = await ptyhost_client.get_client().list(start=False)
    except PtyHostError as exc:
        raise host_error(exc) from exc
    known = {item["id"] for item in items}
    for stale in [tid for tid in hub.titles if tid not in known]:
        hub.titles.pop(stale, None)
    return {"terminals": [shape(item) for item in items]}


@router.post("/terminals")
async def create_terminal(body: TerminalCreate) -> dict:
    cwd = confine(body.cwd)
    if not os.path.isdir(cwd):
        raise HTTPException(404, "that folder does not exist")
    if body.sessionId is not None and not SESSION_RE.match(body.sessionId):
        raise HTTPException(400, "bad session id")
    return await launch(body.kind, cwd, body.title, body.sessionId, body.cols, body.rows)


@router.post("/terminals/owned", dependencies=[Depends(require_window)])
async def create_owned_terminal(body: TerminalOwned) -> dict:
    home = os.path.realpath(os.path.expanduser("~"))
    if not os.path.isdir(home):
        raise HTTPException(404, "the home folder does not exist")
    return await launch("shell", home, body.title, None, body.cols, body.rows, argv=owned_argv(body.argv))


@router.delete("/terminals/{terminal_id}", status_code=204)
async def delete_terminal(terminal_id: str) -> None:
    if not ID_RE.match(terminal_id):
        raise HTTPException(404, "no such terminal")
    client = ptyhost_client.get_client()
    try:
        items = await client.list(start=False)
        if not any(item["id"] == terminal_id for item in items):
            raise HTTPException(404, "no such terminal")
        await client.request({"op": "kill", "id": terminal_id}, ("killed",))
    except PtyHostError as exc:
        raise host_error(exc) from exc
    hub.titles.pop(terminal_id, None)


@router.websocket("/terminals/ws")
async def terminals_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    sub = Sub(websocket)
    sub.task = asyncio.create_task(sub.writer())
    client = ptyhost_client.get_client()
    try:
        await client.ensure(start=False)
    except PtyHostError:
        pass
    hub.start()
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            kind = msg.get("t")
            tid = msg.get("id")
            if not isinstance(tid, str) or not ID_RE.match(tid):
                sub.text({"t": "error", "id": tid if isinstance(tid, str) else "", "message": "bad terminal id"})
                continue
            try:
                if kind == "attach":
                    start = msg.get("from")
                    await hub.attach(sub, tid, start if isinstance(start, int) and not isinstance(start, bool) and start >= 0 else None)
                elif kind == "input":
                    data = msg.get("data")
                    if isinstance(data, str):
                        raw_in = data.encode("utf-8")
                        if len(raw_in) > INPUT_CAP:
                            sub.text({"t": "error", "id": tid, "message": "input is too large"})
                            continue
                        await client.send({"op": "write", "id": tid, "data": base64.b64encode(raw_in).decode("ascii")})
                elif kind == "resize":
                    cols = min(max(int(msg.get("cols") or 0), 1), 1000)
                    rows = min(max(int(msg.get("rows") or 0), 1), 500)
                    await client.send({"op": "resize", "id": tid, "cols": cols, "rows": rows})
                elif kind == "ack":
                    count = msg.get("bytes")
                    if isinstance(count, int) and not isinstance(count, bool) and count > 0:
                        given = sub.take(tid, count)
                        if given > 0:
                            await client.send({"op": "ack", "id": tid, "bytes": given})
                elif kind == "detach":
                    await hub.detach(sub, tid)
            except PtyHostError as exc:
                sub.text({"t": "error", "id": tid, "message": str(exc)})
            except (TypeError, ValueError):
                sub.text({"t": "error", "id": tid, "message": "bad message"})
    except WebSocketDisconnect:
        pass
    finally:
        for tid in list(sub.next):
            await hub.detach(sub, tid)
        sub.queue.put_nowait(None)
        if sub.task is not None:
            try:
                await asyncio.wait_for(sub.task, 2)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                sub.task.cancel()


async def shutdown() -> None:
    await hub.stop()
