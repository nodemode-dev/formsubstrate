import asyncio
import json
import os
import re
import subprocess
import sys
import threading
from pathlib import Path

import httpx

from app.core import runtime, workspace_root as ws
from app.core.binres import find_bin

SERVICE_FILE = "service.json"
START_WAIT = 5.0
COMMAND_TIMEOUT = 300
HTTP_TIMEOUT = 8.0
OUTPUT_MAX = 20000
ID_RE = re.compile(r"^[a-z0-9][a-z0-9.\-]{0,127}$")
MCP_TOOLS = ("slot_find", "slot_get", "slot_similar", "slot_usages", "slot_status", "slot_conventions", "slot_context_pack")
MODES = ("warn", "deny")
BATCH_MAX = 20

_start_lock = asyncio.Lock()


class Refused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def binary() -> str | None:
    forced = os.environ.get("FORMSLOT_BIN")
    if forced and os.path.isfile(forced) and os.access(forced, os.X_OK):
        return os.path.abspath(forced)
    return find_bin("formslot") or find_bin("formslot-cli")


def data_folder() -> Path:
    raw = os.environ.get("FORMSLOT_DATA_DIR")
    return Path(raw).expanduser() if raw else Path.home() / ".formslot"


def _discovery() -> dict | None:
    try:
        info = json.loads((data_folder() / SERVICE_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(info, dict):
        return None
    try:
        pid, port = int(info.get("pid", 0)), int(info.get("port", 0))
    except (TypeError, ValueError):
        return None
    if port <= 0 or not runtime._alive(pid) or not isinstance(info.get("token"), str):
        return None
    return {"pid": pid, "port": port, "token": info["token"], "version": info.get("version")}


def _headers(info: dict) -> dict:
    return {"Authorization": f"Bearer {info['token']}", "Host": f"127.0.0.1:{info['port']}"}


async def _get(info: dict, path: str):
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        reply = await client.get(f"http://127.0.0.1:{info['port']}{path}", headers=_headers(info))
    reply.raise_for_status()
    return reply.json()


def _clip(data: bytes) -> str:
    text = data.decode("utf-8", "replace")
    return text if len(text) <= OUTPUT_MAX else text[-OUTPUT_MAX:]


async def _split(argv: list[str], timeout: int = COMMAND_TIMEOUT) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(*argv, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=dict(os.environ), start_new_session=os.name == "posix")
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        try:
            if os.name == "posix":
                os.killpg(proc.pid, 9)
            else:
                proc.kill()
        except (ProcessLookupError, PermissionError):
            proc.kill()
        await proc.wait()
        return 124, "", "timed out"
    return proc.returncode or 0, out.decode("utf-8", "replace"), _clip(err)


async def _run(argv: list[str], timeout: int = COMMAND_TIMEOUT) -> tuple[int, str]:
    code, out, err = await _split(argv, timeout)
    return code, _clip(((out + err) if err else out).encode("utf-8"))


def _need_binary() -> str:
    found = binary()
    if not found:
        raise Refused(404, "formslot was not found on this computer; install formslot or set FORMSLOT_BIN")
    return found


def workspace(explicit: str | None = None) -> str:
    raw = explicit or ws.current()
    if not raw:
        raise Refused(409, "open a folder first")
    path = os.path.realpath(raw)
    if not os.path.isabs(raw) or not os.path.isdir(path):
        raise Refused(400, "the workspace must be an existing absolute folder")
    return path


def _inside(child: str, parent: str) -> bool:
    child, parent = os.path.realpath(child), os.path.realpath(parent)
    return child == parent or child.startswith(parent.rstrip(os.sep) + os.sep)


def _plugin_installed(root: str) -> bool:
    try:
        text = (Path(root) / ".claude" / "settings.json").read_text(encoding="utf-8")
        settings = json.loads(text)
    except (OSError, ValueError):
        return False
    hooks = settings.get("hooks") if isinstance(settings, dict) else None
    return isinstance(hooks, dict) and "formslot" in json.dumps(hooks)


async def status() -> dict:
    found = binary()
    out = {
        "installed": found is not None,
        "binary": found,
        "running": False,
        "port": None,
        "version": None,
        "pid": None,
        "corpora": [],
        "workspaceCorpus": None,
        "pluginInstalled": None,
        "note": "",
    }
    current = ws.current()
    if current and os.path.isdir(current):
        out["pluginInstalled"] = _plugin_installed(current)
    if not found:
        out["note"] = "formslot is not installed"
        return out
    info = _discovery()
    if info is None:
        out["note"] = "formslot is installed and not running"
        return out
    try:
        health = await _get(info, "/api/health")
        listing = await _get(info, "/api/corpus")
    except (httpx.HTTPError, ValueError):
        out["note"] = "formslot is installed; its service did not answer"
        return out
    out.update(running=True, port=info["port"], pid=info["pid"], version=health.get("version") or info.get("version"))
    corpora = listing.get("corpora") if isinstance(listing, dict) else []
    out["corpora"] = [{"name": c.get("name"), "path": c.get("path"), "head": c.get("head")} for c in corpora if isinstance(c, dict)]
    if current:
        best = None
        for corpus in out["corpora"]:
            path = corpus.get("path")
            if isinstance(path, str) and _inside(current, path) and (best is None or len(path) > len(best["path"])):
                best = corpus
        out["workspaceCorpus"] = best["name"] if best else None
    out["note"] = "formslot is running"
    return out


async def start() -> dict:
    found = _need_binary()
    async with _start_lock:
        if _discovery() is None:
            data_folder().mkdir(parents=True, exist_ok=True)
            kwargs: dict = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "env": dict(os.environ)}
            if sys.platform == "win32":
                kwargs["creationflags"] = 0x00000008 | 0x00000200
            else:
                kwargs["start_new_session"] = True
            try:
                proc = subprocess.Popen([found, "serve"], **kwargs)
            except OSError as err:
                raise Refused(500, f"formslot could not be started: {err}")
            threading.Thread(target=proc.wait, daemon=True).start()
            waited = 0.0
            while waited < START_WAIT and _discovery() is None:
                await asyncio.sleep(0.1)
                waited += 0.1
    result = await status()
    if not result["running"]:
        result["note"] = "formslot was started and has not answered yet"
    return result


def _allowed_roots() -> list[str]:
    from app.services import sessions

    roots = [str(item.get("worktree")) for item in sessions._sessions.values() if isinstance(item.get("worktree"), str) and item.get("worktree")]
    current = ws.current()
    if current:
        roots.append(current)
    return roots


async def index(path: str | None) -> dict:
    found = _need_binary()
    root = workspace(path)
    if path and not any(_inside(root, base) for base in _allowed_roots()):
        raise Refused(403, "only the open folder or a session worktree can be indexed")
    current = await status()
    name = None
    for corpus in current["corpora"]:
        if isinstance(corpus.get("path"), str) and os.path.realpath(corpus["path"]) == root:
            name = corpus["name"]
    argv = [found, "reindex", name] if name else [found, "add", root]
    code, output = await _run(argv)
    return {"ok": code == 0, "output": output.strip()}


async def install(mode: str) -> dict:
    found = _need_binary()
    if mode not in MODES:
        raise Refused(400, "mode must be warn or deny")
    code, output = await _run([found, "install", workspace(), "--mode", mode])
    return {"ok": code == 0, "output": output.strip()}


async def mcp(body: object):
    messages = body if isinstance(body, list) else [body]
    if not messages or len(messages) > BATCH_MAX:
        raise Refused(400, f"send between 1 and {BATCH_MAX} messages")
    info = _discovery()
    if info is None:
        raise Refused(409, "formslot is not running; start it first")
    for message in messages:
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or message.get("method") != "tools/call":
            raise Refused(400, "only JSON-RPC tools/call is forwarded")
        params = message.get("params")
        if not isinstance(params, dict) or params.get("name") not in MCP_TOOLS:
            raise Refused(400, "that formslot tool is not available through the window")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            reply = await client.post(f"http://127.0.0.1:{info['port']}/mcp", headers={**_headers(info), "Accept": "application/json, text/event-stream"}, json=body)
    except httpx.HTTPError as err:
        raise Refused(502, f"formslot did not answer: {err.__class__.__name__}")
    if reply.status_code == 202 or not reply.content:
        return None
    try:
        return reply.json()
    except ValueError:
        raise Refused(502, "formslot answered with something that is not JSON")


async def confirm(slot_id: str) -> dict:
    found = _need_binary()
    if not ID_RE.match(slot_id or ""):
        raise Refused(400, "that is not a slot id")
    code, output = await _run([found, "slot", "confirm", slot_id, "--owner"])
    return {"ok": code == 0, "output": output.strip()}


def _drift_files(data: object) -> list[dict]:
    rows = data.get("slots") if isinstance(data, dict) else data
    files: list[dict] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        slot = row.get("slot") or row.get("id")
        slot = slot if isinstance(slot, str) else None
        inner = row.get("files")
        if isinstance(inner, list):
            for entry in inner:
                if isinstance(entry, dict) and isinstance(entry.get("path"), str) and isinstance(entry.get("state"), str):
                    files.append({"path": entry["path"], "slot": slot, "state": entry["state"]})
            continue
        path = row.get("path") or row.get("file")
        if isinstance(path, str) and isinstance(row.get("state"), str):
            files.append({"path": path, "slot": slot, "state": row["state"]})
    return files


async def drift() -> dict:
    found = _need_binary()
    root = workspace()
    code, out, err = await _split([found, "slot", "drift", "--repo", root, "--json"])
    if code != 0 and "no slots.lock.json" in err + out:
        code, out, err = await _split([found, "slot", "drift", "--repo", root, "--infer", "--json"])
    files: list[dict] = []
    if code == 0:
        try:
            files = _drift_files(json.loads(out))
        except ValueError:
            files = []
    return {"ok": code == 0, "output": "" if code == 0 else (err + out).strip(), "files": files}
