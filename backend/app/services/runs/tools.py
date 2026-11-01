import asyncio
import difflib
import os
from typing import Any

from app.core import workspace_root as ws

LIST_MAX = 500
READ_MAX = 200_000
WRITE_MAX = 2_000_000
SHELL_TIMEOUT = 60
SHELL_OUT = 20_000
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "target", "dist", ".subform"}
ALWAYS_APPROVE = {"run_shell"}

DEFINITIONS = [
    {"name": "list_files", "description": "List files in the workspace.", "args": {}},
    {"name": "read_file", "description": "Read a text file from the workspace.", "args": {"path": "relative path"}},
    {"name": "write_file", "description": "Create or overwrite a file in the workspace.", "args": {"path": "relative path", "content": "file text"}},
    {"name": "run_shell", "description": "Run a shell command in the workspace (60 second limit). Always waits for approval.", "args": {"command": "shell command"}},
]


def names() -> list[str]:
    return [d["name"] for d in DEFINITIONS]


def needs_approval(name: str, cfg: dict) -> bool:
    return name in ALWAYS_APPROVE or bool(cfg.get("approve"))


def _list() -> list[str]:
    base = ws.real_root()
    out: list[str] = []
    for here, dirs, files in os.walk(base, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not os.path.islink(os.path.join(here, d)))
        for name in sorted(files):
            out.append(os.path.relpath(os.path.join(here, name), base).replace(os.sep, "/"))
            if len(out) >= LIST_MAX:
                return out
    return out


def _read(path: str) -> str:
    real, _ = ws.resolve(path)
    with open(real, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read(READ_MAX)


def _write(path: str, content: str) -> dict:
    if len(content) > WRITE_MAX:
        return {"error": "content is too large"}
    real, rel = ws.resolve(path, write=True)
    if rel.split("/")[0] == ".subform":
        return {"error": "the .subform folder is not writable from a graph tool"}
    os.makedirs(os.path.dirname(real), exist_ok=True)
    with open(real, "w", encoding="utf-8") as fh:
        fh.write(content)
    return {"written": rel, "bytes": len(content.encode("utf-8"))}


async def _shell(command: str) -> dict:
    base = ws.real_root()
    proc = await asyncio.create_subprocess_shell(
        command, cwd=base, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), SHELL_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return {"error": f"timed out after {SHELL_TIMEOUT}s"}
    return {"exit": proc.returncode, "output": out.decode("utf-8", "replace")[-SHELL_OUT:]}


def preview_diff(args: dict) -> str | None:
    path = args.get("path")
    if not isinstance(path, str):
        return None
    try:
        before = _read(path)
    except (OSError, ws.Refused):
        before = ""
    lines = difflib.unified_diff(before.splitlines(keepends=True), str(args.get("content") or "").splitlines(keepends=True), fromfile=f"a/{path}", tofile=f"b/{path}", n=3)
    return "".join(lines)[:40_000]


async def call(name: str, args: dict, simulate: bool) -> Any:
    try:
        if name == "list_files":
            return await asyncio.to_thread(_list)
        if name == "read_file":
            return await asyncio.to_thread(_read, str(args.get("path") or ""))
        if name == "write_file":
            if simulate:
                return {"simulated": True, "would_write": args.get("path"), "bytes": len(str(args.get("content") or ""))}
            return await asyncio.to_thread(_write, str(args.get("path") or ""), str(args.get("content") or ""))
        if name == "run_shell":
            if simulate:
                return {"simulated": True, "would_run": str(args.get("command") or "")[:200]}
            return await _shell(str(args.get("command") or ""))
    except ws.Refused as err:
        return {"error": err.detail}
    except OSError as err:
        return {"error": str(err)}
    return await shared(name, args, simulate)


async def shared(name: str, args: dict, simulate: bool) -> Any:
    from app.routers.tools import ensure
    from app.services.library.registry import jsonable, tools as registry
    await ensure()
    if registry.get(name) is None:
        return {"error": f"unknown tool: {name}"}
    if simulate:
        return {"simulated": True, "would_call": name}
    return jsonable(await registry.call(name, args))


async def catalog() -> list[dict]:
    from app.routers.tools import ensure
    from app.services.library.registry import tools as registry
    await ensure()
    out = [dict(d) for d in DEFINITIONS]
    taken = {d["name"] for d in out}
    for definition in registry.definitions():
        fn = definition.get("function") or {}
        if fn.get("name") and fn["name"] not in taken:
            props = (fn.get("parameters") or {}).get("properties") or {}
            out.append({"name": fn["name"], "description": str(fn.get("description") or "")[:200], "args": {k: str((v or {}).get("description") or (v or {}).get("type") or "") for k, v in props.items()}})
    return out
