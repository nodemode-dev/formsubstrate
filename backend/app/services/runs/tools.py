import asyncio
import difflib
import json
import os
from typing import Any

from app.core import workspace_root as ws

LIST_MAX = 500
READ_MAX = 200_000
WRITE_MAX = 2_000_000
SHELL_TIMEOUT = 60
SHELL_OUT = 20_000
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "target", "dist", ".subform"}
READ_ONLY = {"list_files", "read_file"}
ALWAYS_APPROVE = {"write_file", "run_shell"}
PROTECTED = {".git", ".subform", ".claude", ".mcp.json", "package.json", ".husky", ".gitmodules", ".envrc"}
DIFF_MAX = 200_000
ARGS_MAX = 8_000


class Refusal(Exception):
    pass

DEFINITIONS = [
    {"name": "list_files", "description": "List files in the workspace.", "args": {}},
    {"name": "read_file", "description": "Read a text file from the workspace.", "args": {"path": "relative path"}},
    {"name": "write_file", "description": "Create or overwrite a file in the workspace.", "args": {"path": "relative path", "content": "file text"}},
    {"name": "run_shell", "description": "Run a shell command in the workspace (60 second limit). Always waits for approval.", "args": {"command": "shell command"}},
]


def names() -> list[str]:
    return [d["name"] for d in DEFINITIONS]


def needs_approval(name: str, cfg: dict) -> bool:
    return name not in READ_ONLY


def protected_target(path: str) -> tuple[str, str]:
    real, rel = ws.resolve(path, write=True)
    base = ws.real_root()
    inner = os.path.relpath(real, base).replace(os.sep, "/")
    for part in rel.split("/") + inner.split("/"):
        if part.lower() in PROTECTED:
            raise Refusal(f"{part} is protected and cannot be written from a graph tool")
    return real, rel


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
    try:
        real, rel = protected_target(path)
    except Refusal as err:
        return {"error": str(err)}
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


def preview_diff(args: dict) -> str:
    path = args.get("path")
    content = args.get("content")
    if not isinstance(path, str) or not isinstance(content, str):
        raise Refusal("write_file needs a path and content as text")
    if len(content) > WRITE_MAX:
        raise Refusal("content is too large to review")
    real, _ = protected_target(path)
    before = ""
    if os.path.isfile(real):
        if os.path.getsize(real) > READ_MAX:
            raise Refusal("the existing file is too large to show a full diff")
        with open(real, "r", encoding="utf-8", errors="replace") as fh:
            before = fh.read()
    lines = difflib.unified_diff(before.splitlines(keepends=True), content.splitlines(keepends=True), fromfile=f"a/{path}", tofile=f"b/{path}", n=3)
    text = "".join(lines) or "(no textual difference)"
    if len(text) > DIFF_MAX:
        raise Refusal("the change is too large to review in full; split it into smaller writes")
    return text


def check_args(args: dict) -> None:
    if len(json.dumps(args, default=str)) > ARGS_MAX:
        raise Refusal("the arguments are too long to review in full")


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
