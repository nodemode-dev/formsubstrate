import asyncio
import base64
import hashlib
import json
import os
import random
import re
import string
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.core import config, workspace_root as ws
from app.core.binres import find_bin
from app.services import formslot as formslot_service
from app.services import gitops

REGISTRY_NAME = "sessions.json"
WORKTREES_NAME = "worktrees"
MCP_DIR = ".subform"
MCP_NAME = "mcp.json"
SETTINGS_FOLDER = "session-settings"
SETTINGS_BODY = {"includeCoAuthoredBy": False, "attribution": {"commit": "", "pr": ""}}
COMMENTS_MAX = 200
PASTE_START = "\x1b[200~"
PASTE_END = "\x1b[201~"
PASTE_GAP = 0.15
ID_ALPHABET = string.ascii_lowercase + string.digits
ID_RE = re.compile(r"^[a-z0-9]{16}$")
LIVE_STATES = ("working", "needs-input")
KNOWN_STATES = ("working", "needs-input", "done", "failed", "stopped")
REQUIRED_KEYS = ("state", "mode", "title", "repo", "worktree", "branch")
MESSAGE_MAX = 600
TAIL_MAX = 4000
LINE_MAX = 4 * 1024 * 1024
TAIL_OFFSET = 1 << 62
GIT_TIMEOUT = 60
COLS = 200
ROWS = 50
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
PROJECT_KEY_RE = re.compile(r"[^A-Za-z0-9]")
INPUT_TOOLS = ("AskUserQuestion",)
INPUT_SUBTYPES = ("permission_request", "input_request", "permission_denied")
SESSION_FIELDS = ("id", "title", "repo", "branch", "worktree", "mode", "state", "terminalId", "claudeSessionId", "created", "updated", "lastMessage", "notes", "repoName", "base", "permissionMode")
PERMISSION_MODES = ("default", "acceptEdits", "plan")
DEFAULT_PERMISSION_MODE = "acceptEdits"
RUN_KIND = "run"
RUN_PREFIX = "run"


class Refused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


_lock = threading.Lock()
_sessions: dict[str, dict] = {}
_loaded = False
_subscribers: set[asyncio.Queue] = set()
_closing = False
CLOSE = "close"
_streams: dict[str, dict] = {}
_terminal_owner: dict[str, str] = {}
_consumer: asyncio.Task | None = None
_host_client = None
_offsets: dict[str, int] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _registry_file() -> Path:
    return config.data_dir() / REGISTRY_NAME


def _load() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True
    path = _registry_file()
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    try:
        data = json.loads(text)
    except ValueError:
        _set_aside(path)
        return
    items = data.get("sessions") if isinstance(data, dict) else None
    if not isinstance(items, list):
        _set_aside(path)
        return
    dropped = False
    for item in items:
        if isinstance(item, dict) and isinstance(item.get("id"), str) and ID_RE.match(item["id"]) and all(isinstance(item.get(k), str) for k in REQUIRED_KEYS):
            item.setdefault("lastMessage", "")
            if item["state"] not in KNOWN_STATES:
                item["state"] = "failed"
            if item["mode"] not in ("interactive", "headless"):
                item["mode"] = "interactive"
            _sessions[item["id"]] = item
        else:
            dropped = True
    if dropped:
        _set_aside(path, copy=True)


def _set_aside(path: Path, copy: bool = False) -> None:
    target = path.with_name(f"{path.name}.corrupt-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}")
    try:
        if copy:
            target.write_bytes(path.read_bytes())
        else:
            os.replace(path, target)
    except OSError:
        pass


def _save() -> None:
    target = _registry_file()
    temp = target.with_name(target.name + ".tmp")
    with _lock:
        temp.write_text(json.dumps({"sessions": [item for item in _sessions.values() if item.get("kind") != RUN_KIND]}, indent=2), encoding="utf-8")
        os.replace(temp, target)


def public(item: dict) -> dict:
    out = {key: item.get(key) for key in SESSION_FIELDS}
    out["notes"] = list(item.get("notes") or [])
    out["comments"] = len(item.get("comments") or [])
    out["snapshots"] = int(item.get("snapshotCount") or 0)
    out["tokensSaved"] = int(item.get("tokensSaved") or 0)
    return out


def list_sessions() -> list[dict]:
    _load()
    return sorted((public(item) for item in _sessions.values() if item.get("kind") != RUN_KIND), key=lambda s: s["created"] or "", reverse=True)


def get_session(session_id: str) -> dict | None:
    _load()
    item = _sessions.get(session_id)
    return public(item) if item else None


def worktree_roots() -> list[str]:
    _load()
    return [item["worktree"] for item in _sessions.values() if item.get("worktree")]


def _entry(session_id: str) -> dict:
    _load()
    item = _sessions.get(session_id)
    if item is None and session_id.startswith(RUN_PREFIX):
        from app.services.runs import worktree

        worktree.restore(session_id)
        item = _sessions.get(session_id)
    if item is None:
        raise Refused(404, "no such session")
    return item


def _publish(event: str, payload: dict) -> None:
    for queue in list(_subscribers):
        queue.put_nowait((event, payload))


def subscribe() -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue()
    if _closing:
        queue.put_nowait((CLOSE, {}))
    _subscribers.add(queue)
    return queue


def close_streams() -> None:
    global _closing
    _closing = True
    for queue in list(_subscribers):
        queue.put_nowait((CLOSE, {}))


def unsubscribe(queue: asyncio.Queue) -> None:
    _subscribers.discard(queue)


def _changed(item: dict) -> None:
    item["updated"] = _now()
    if item.get("kind") == RUN_KIND:
        return
    _save()
    _publish("session", public(item))


def _notice(item: dict, kind: str, text: str) -> None:
    if item.get("kind") == RUN_KIND:
        return
    _publish("notice", {"sessionId": item["id"], "kind": kind, "text": text})


def _clip(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= MESSAGE_MAX else text[: MESSAGE_MAX - 1].rstrip() + "..."


def _set_state(item: dict, state: str, message: str | None = None, notice: bool = True) -> None:
    before = item["state"]
    item["state"] = state
    if message is not None:
        item["lastMessage"] = _clip(message)
    _changed(item)
    if not notice or before == state:
        return
    text = item.get("lastMessage") or item["title"]
    if state == "needs-input":
        _notice(item, "needs-input", text)
    elif state == "done":
        _notice(item, "completed", text)
    elif state == "failed":
        _notice(item, "failed", text)


def new_id() -> str:
    while True:
        value = "".join(random.choices(ID_ALPHABET, k=16))
        if value not in _sessions:
            return value


async def _run(argv: list[str], cwd: str | None = None, timeout: int = GIT_TIMEOUT) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(*argv, cwd=cwd, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 124, "", "timed out"
    return proc.returncode or 0, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")


def _git() -> str:
    found = find_bin("git")
    if not found:
        raise Refused(404, "git was not found on this computer")
    return found


def _claude() -> str:
    found = find_bin("claude")
    if not found:
        raise Refused(404, "the claude command was not found on this computer; install Claude Code and try again")
    return found


async def _repo_of(path: str) -> tuple[str, str]:
    git = _git()
    code, out, err = await _run([git, "rev-parse", "--show-toplevel"], cwd=path)
    if code != 0:
        raise Refused(409, "the open workspace is not inside a git repository")
    top = os.path.realpath(out.strip())
    code, _, err = await _run([git, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"], cwd=top)
    if code != 0:
        raise Refused(409, "the repository has no commits yet; make a first commit before starting a session")
    return top, os.path.basename(top)


def _worktree_path(top: str, name: str, session_id: str) -> Path:
    digest = hashlib.sha1(top.encode("utf-8")).hexdigest()[:8]
    return config.data_dir() / WORKTREES_NAME / f"{name}-{digest}" / session_id


async def _exclude_subform(top: str) -> None:
    code, out, _ = await _run([_git(), "rev-parse", "--git-common-dir"], cwd=top)
    if code != 0:
        return
    common = Path(out.strip())
    if not common.is_absolute():
        common = Path(top) / common
    target = common / "info" / "exclude"
    try:
        current = target.read_text(encoding="utf-8") if target.is_file() else ""
        lines = [line.strip() for line in current.splitlines()]
        if f"{MCP_DIR}/" in lines or MCP_DIR in lines:
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        prefix = "" if not current or current.endswith("\n") else "\n"
        target.write_text(current + prefix + f"{MCP_DIR}/\n", encoding="utf-8")
    except OSError:
        return


async def _formslot_has_mcp(path: str) -> bool:
    try:
        code, out, err = await _run([path, "--help"], timeout=10)
    except OSError:
        return False
    return re.search(r"(?m)^\s+mcp\b", out + err) is not None


async def _mcp_config() -> tuple[dict, list[str]]:
    servers: dict[str, dict] = {}
    notes: list[str] = []
    formmcp = os.environ.get("FORMMCP_BIN") or find_bin("formmcp")
    if formmcp and os.path.isfile(formmcp):
        servers["formMCP"] = {"command": os.path.abspath(formmcp), "args": []}
    else:
        notes.append("formMCP was not found (set FORMMCP_BIN or install formMCP); the session runs without it")
    formslot = formslot_service.binary()
    if formslot and await _formslot_has_mcp(formslot):
        servers["formslot"] = {"command": os.path.abspath(formslot), "args": ["mcp"]}
    elif formslot:
        notes.append("formslot is installed but its mcp command is not available yet; the session runs without it")
    else:
        notes.append("formslot was not found; the session runs without it")
    launcher = config.REPO_DIR / ("subform.bat" if os.name == "nt" else "subform")
    if launcher.is_file():
        servers["subform"] = {
            "command": str(launcher),
            "args": ["mcp"],
            "env": {
                "SUBFORM_GATE_TOKEN": "${SUBFORM_GATE_TOKEN}",
                "SUBFORM_ENGINE": "${SUBFORM_ENGINE}",
                "SUBFORM_DATA_DIR": str(config.data_dir()),
            },
        }
    else:
        notes.append("the subform launcher was not found next to the engine; the session runs without the subform MCP server")
    from app.services.library.mcp_client import mcp_clients

    await mcp_clients.ensure_loaded()
    mine, mine_notes = mcp_clients.session_entries()
    for key, entry in mine.items():
        servers.setdefault(key, entry)
    notes.extend(mine_notes)
    return {"mcpServers": servers}, notes


def _write_mcp(worktree: Path, config_obj: dict) -> Path:
    folder = worktree / MCP_DIR
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / MCP_NAME
    temp = target.with_name(target.name + ".tmp")
    temp.write_text(json.dumps(config_obj, indent=2), encoding="utf-8")
    os.replace(temp, target)
    return target


def _settings_path(worktree: Path) -> Path:
    digest = hashlib.sha1(str(worktree).encode("utf-8")).hexdigest()[:16]
    return config.data_dir() / SETTINGS_FOLDER / f"{digest}.json"


def _write_settings(worktree: Path) -> Path:
    target = _settings_path(worktree)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + ".tmp")
    from app.services import gates

    temp.write_text(json.dumps(gates.merged_settings({}), indent=2), encoding="utf-8")
    os.replace(temp, target)
    return target


def _host():
    global _host_client
    if _host_client is None:
        from app.services.ptyhost_client import PtyHostClient

        _host_client = PtyHostClient()
    return _host_client


def _fresh_stream(session_id: str) -> dict:
    return {"buffer": bytearray(), "tail": "", "result": False, "input": False, "session": session_id}


async def _watch(terminal_id: str, session_id: str, start: int | None) -> None:
    _terminal_owner[terminal_id] = session_id
    reply = await _host().request({"op": "attach", "id": terminal_id, "from": TAIL_OFFSET if start is None else start}, ("attached",))
    _offsets[terminal_id] = int(reply.get("from", 0))
    _ensure_consumer()


async def _launch(item: dict, argv: list[str], headless: bool) -> str:
    from fastapi import HTTPException

    from app.routers.terminal import launch
    from app.services import gates

    try:
        made = await launch("claude", item["worktree"], item["title"], item["id"], COLS if headless else 120, ROWS if headless else 32, argv=argv, env_extra=gates.session_env(item))
    except HTTPException as err:
        raise Refused(err.status_code, str(err.detail))
    terminal_id = made["id"]
    if headless:
        _streams[terminal_id] = _fresh_stream(item["id"])
    try:
        await _watch(terminal_id, item["id"], 0 if headless else None)
    except Exception:
        _streams.pop(terminal_id, None)
        _terminal_owner.pop(terminal_id, None)
        raise
    return terminal_id


def _mcp_arg(item: dict) -> list[str]:
    worktree = Path(item["worktree"])
    settings = _settings_path(worktree)
    try:
        _write_settings(worktree)
    except OSError:
        pass
    return ["--mcp-config", str(worktree / MCP_DIR / MCP_NAME), "--settings", str(settings)]


async def _start_claude_terminal(item: dict, args: list[str] | None = None) -> str:
    return await _launch(item, [_claude(), *_mcp_arg(item), *(args or [])], False)


async def _start_headless(item: dict, prompt: str, resume: str | None = None) -> str:
    mode = item.get("permissionMode")
    if mode not in PERMISSION_MODES:
        mode = DEFAULT_PERMISSION_MODE
    argv = [_claude(), "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", mode, *_mcp_arg(item), *(["--resume", resume] if resume else []), "--", prompt]
    return await _launch(item, argv, True)


def _ensure_consumer() -> None:
    global _consumer
    if _consumer is not None and not _consumer.done():
        return
    _consumer = asyncio.get_running_loop().create_task(_consume())


async def _consume() -> None:
    host = _host()
    async for event in host.events():
        if not isinstance(event, dict):
            continue
        op = event.get("op")
        if op == "connected":
            await _reattach()
            continue
        try:
            _on_event(event)
        except Exception:
            pass
        if op == "output" and isinstance(event.get("id"), str) and event["id"] in _terminal_owner:
            try:
                size = len(base64.b64decode(event.get("data") or ""))
                await host.send({"op": "ack", "id": event["id"], "bytes": size})
            except Exception:
                pass


async def _reattach() -> None:
    for terminal_id, session_id in list(_terminal_owner.items()):
        try:
            await _watch(terminal_id, session_id, _offsets.get(terminal_id, 0))
        except Exception:
            _on_exit(session_id, terminal_id, None)


def _on_event(event: dict) -> None:
    if not isinstance(event, dict):
        return
    terminal_id = event.get("id")
    session_id = _terminal_owner.get(terminal_id) if isinstance(terminal_id, str) else None
    if session_id is None:
        return
    if event.get("op") == "output":
        stream = _streams.get(terminal_id)
        if stream is not None:
            try:
                raw = base64.b64decode(event.get("data") or "")
            except ValueError:
                return
            _offsets[terminal_id] = int(event.get("seq", 0)) + len(raw)
            _feed(session_id, stream, raw)
    elif event.get("op") == "exit":
        _on_exit(session_id, terminal_id, event.get("code"))


def _feed(session_id: str, stream: dict, raw: bytes) -> None:
    item = _sessions.get(session_id)
    if item is None:
        return
    buffer: bytearray = stream["buffer"]
    buffer.extend(raw)
    while True:
        cut = buffer.find(b"\n")
        if cut < 0:
            break
        line = bytes(buffer[:cut]).decode("utf-8", "replace").strip()
        del buffer[: cut + 1]
        if line:
            _on_line(item, stream, line)
    if len(buffer) > LINE_MAX:
        buffer.clear()


def _on_line(item: dict, stream: dict, line: str) -> None:
    event = None
    if line.startswith("{"):
        try:
            event = json.loads(line)
        except ValueError:
            event = None
    if not isinstance(event, dict):
        plain = ANSI_RE.sub("", line).strip()
        if plain:
            stream["tail"] = (stream["tail"] + "\n" + plain)[-TAIL_MAX:]
        return
    kind = event.get("type")
    subtype = event.get("subtype")
    changed = False
    if kind == "system" and subtype == "init":
        sid = event.get("session_id")
        if isinstance(sid, str) and sid and sid != item.get("claudeSessionId"):
            item["claudeSessionId"] = sid
            changed = True
    elif kind == "assistant":
        message = event.get("message") or {}
        content = message.get("content") if isinstance(message, dict) else None
        texts: list[str] = []
        asks = False
        if isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text" and isinstance(block.get("text"), str):
                    texts.append(block["text"])
                elif block.get("type") == "tool_use" and block.get("name") in INPUT_TOOLS:
                    asks = True
        text = " ".join(texts).strip()
        if text:
            item["lastMessage"] = _clip(text)
            changed = True
        if asks and item["state"] != "needs-input":
            stream["input"] = True
            _set_state(item, "needs-input", item.get("lastMessage") or "Waiting for your answer")
            return
    elif kind == "result":
        stream["result"] = True
        sid = event.get("session_id")
        if isinstance(sid, str) and sid:
            item["claudeSessionId"] = sid
        text = event.get("result") if isinstance(event.get("result"), str) else ""
        if not text and isinstance(event.get("errors"), list):
            text = "; ".join(str(entry) for entry in event["errors"])
        denials = event.get("permission_denials")
        if event.get("is_error") or (isinstance(subtype, str) and subtype.startswith("error")):
            stream["input"] = False
            _set_state(item, "failed", text or f"The run ended with {subtype or 'an error'}")
        elif isinstance(denials, list) and denials:
            names = sorted({str(d.get("tool_name")) for d in denials if isinstance(d, dict) and d.get("tool_name")})
            stream["input"] = True
            _set_state(item, "needs-input", (text + " " if text else "") + ("Permission needed for " + ", ".join(names) if names else "Permission needed"))
        else:
            _set_state(item, "done", text or item.get("lastMessage") or "Finished")
        return
    elif isinstance(subtype, str) and subtype in INPUT_SUBTYPES:
        stream["input"] = True
        _set_state(item, "needs-input", str(event.get("message") or item.get("lastMessage") or "Waiting for input"))
        return
    if changed:
        _changed(item)


async def _release(terminal_id: str, headless: bool) -> None:
    op = {"op": "kill", "id": terminal_id} if headless else {"op": "detach", "id": terminal_id}
    try:
        if headless:
            await _host().request(op, ("killed",), start=False)
        else:
            await _host().send(op)
    except Exception:
        pass


def _on_exit(session_id: str, terminal_id: str, code: object) -> None:
    headless = terminal_id in _streams
    try:
        asyncio.get_running_loop().create_task(_release(terminal_id, headless))
    except RuntimeError:
        pass
    item = _sessions.get(session_id)
    _finish_exit(session_id, terminal_id, code)
    if headless and item is not None and item.get("terminalId") == terminal_id:
        try:
            asyncio.get_running_loop().create_task(_snapshot(item, "after run"))
        except RuntimeError:
            pass


def _finish_exit(session_id: str, terminal_id: str, code: object) -> None:
    item = _sessions.get(session_id)
    _terminal_owner.pop(terminal_id, None)
    _offsets.pop(terminal_id, None)
    stream = _streams.pop(terminal_id, None)
    if item is None or item.get("terminalId") != terminal_id:
        return
    if item["state"] in ("stopped", "done", "failed"):
        return
    if stream is not None:
        if stream["buffer"]:
            _feed(session_id, stream, b"\n")
            if item["state"] in ("done", "failed"):
                return
        if stream["result"]:
            if item["state"] == "working":
                _set_state(item, "done")
            return
        tail = stream["tail"].strip()
        if code == 0:
            _set_state(item, "failed", tail or "The run ended without a result")
        else:
            _set_state(item, "failed", tail or f"The claude process exited with code {code} and printed nothing")
        return
    _discover_claude_session(item)
    if code == 0:
        _set_state(item, "done", item.get("lastMessage") or "The terminal closed")
    else:
        _set_state(item, "stopped", item.get("lastMessage") or "The terminal closed; the session can be resumed")


def _discover_claude_session(item: dict) -> None:
    if item.get("claudeSessionId"):
        return
    key = PROJECT_KEY_RE.sub("-", os.path.realpath(item["worktree"]))
    folder = Path.home() / ".claude" / "projects" / key
    try:
        files = sorted(folder.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return
    if files:
        item["claudeSessionId"] = files[0].stem


async def prepare_worktree(root: str, base: str, tag: str, branch: str) -> tuple[str, str, Path, list[str]]:
    top, name = await _repo_of(root)
    git = _git()
    code, _, err = await _run([git, "rev-parse", "--verify", "--quiet", f"{base}^{{commit}}"], cwd=top)
    if code != 0:
        raise Refused(400, f"base {base} is not a branch or commit of this repository")
    path = _worktree_path(top, name, tag)
    path.parent.mkdir(parents=True, exist_ok=True)
    code, _, err = await _run([git, "worktree", "add", "-b", branch, str(path), base], cwd=top)
    if code != 0:
        raise Refused(409, "git could not create the worktree: " + (err.strip() or "unknown error"))
    await _exclude_subform(top)
    config_obj, notes = await _mcp_config()
    _write_mcp(path, config_obj)
    _write_settings(path)
    try:
        await gitops.configure_worktree(top, str(path))
    except gitops.Refused as err:
        notes.append("the commit identity and hook could not be set up for this worktree: " + err.detail)
    return top, name, path, notes


def register_target(item: dict) -> None:
    _load()
    _sessions[item["id"]] = item


def drop_target(session_id: str) -> None:
    with _lock:
        _sessions.pop(session_id, None)


def mcp_args(item: dict) -> list[str]:
    return _mcp_arg(item)


def _need_title(title: object) -> str:
    text = " ".join(str(title or "").split())
    return text[:120] if text else "Untitled session"


async def create(title: str, mode: str, prompt: str | None, base: str | None, permission_mode: str | None = None) -> dict:
    _load()
    if mode not in ("interactive", "headless"):
        raise Refused(400, "mode must be interactive or headless")
    permission_mode = (permission_mode or "").strip() or DEFAULT_PERMISSION_MODE
    if permission_mode not in PERMISSION_MODES:
        raise Refused(400, "permissionMode must be one of " + ", ".join(PERMISSION_MODES))
    prompt = (prompt or "").strip()
    if mode == "headless" and not prompt:
        raise Refused(400, "a headless session needs a prompt")
    base = (base or "").strip() or "HEAD"
    if base.startswith("-"):
        raise Refused(400, "bad base")
    _claude()
    try:
        root = ws.real_root()
    except ws.Refused as err:
        raise Refused(err.status, err.detail)
    session_id = new_id()
    branch = f"sf/{session_id}"
    top, name, path, notes = await prepare_worktree(root, base, session_id, branch)
    item = {
        "id": session_id,
        "title": _need_title(title),
        "repo": top,
        "repoName": name,
        "branch": branch,
        "base": base,
        "permissionMode": permission_mode,
        "worktree": str(path),
        "mode": mode,
        "state": "working",
        "terminalId": None,
        "claudeSessionId": None,
        "created": _now(),
        "updated": _now(),
        "lastMessage": _clip(prompt) if prompt else None,
        "notes": notes,
    }
    _sessions[session_id] = item
    await _snapshot(item, "session start")
    try:
        if mode == "headless":
            item["terminalId"] = await _start_headless(item, prompt)
        else:
            item["terminalId"] = await _start_claude_terminal(item)
    except Exception as err:
        item["state"] = "failed"
        item["lastMessage"] = _clip(f"The agent could not be started: {err}")
        _changed(item)
        _notice(item, "failed", item["lastMessage"])
        return public(item)
    _changed(item)
    _ensure_consumer()
    return public(item)


async def _snapshot(item: dict, label: str) -> None:
    try:
        await gitops.snapshot_for_item(item, label)
    except Exception:
        pass


def note_snapshots(session_id: str, count: int) -> None:
    item = _sessions.get(session_id)
    if item is None or item.get("snapshotCount") == count:
        return
    item["snapshotCount"] = count
    _changed(item)


def record_comment(session_id: str, path: str, line: int | None, hunk: str | None, text: str, keep: int = COMMENTS_MAX) -> dict:
    item = _entry(session_id)
    comment = {"id": "".join(random.choices(ID_ALPHABET, k=12)), "path": path, "line": line, "hunk": hunk, "text": text, "created": _now()}
    items = list(item.get("comments") or [])
    items.append(comment)
    item["comments"] = items[-keep:]
    _changed(item)
    return comment


async def send_feedback(session_id: str, text: str) -> str:
    item = _entry(session_id)
    text = gitops.CONTROL_RE.sub("", text)
    terminal_id = item.get("terminalId")
    if item["mode"] == "interactive" and item["state"] == "working" and terminal_id and terminal_id in _terminal_owner:
        try:
            host = _host()
            await host.send({"op": "write", "id": terminal_id, "data": base64.b64encode((PASTE_START + text + PASTE_END).encode("utf-8")).decode("ascii")})
            await asyncio.sleep(PASTE_GAP)
            await host.send({"op": "write", "id": terminal_id, "data": base64.b64encode(b"\r").decode("ascii")})
            return "terminal"
        except Exception:
            return "stored"
    if item["mode"] == "headless" and item["state"] not in LIVE_STATES and item.get("claudeSessionId") and os.path.isdir(item["worktree"]):
        before = item["state"]
        item["state"] = "working"
        try:
            item["terminalId"] = await _start_headless(item, text, item["claudeSessionId"])
        except Exception:
            item["state"] = before
            return "stored"
        item["lastMessage"] = _clip(text)
        _changed(item)
        _ensure_consumer()
        return "headless"
    return "stored"


def _forget(terminal_id: str | None) -> None:
    if terminal_id:
        _terminal_owner.pop(terminal_id, None)
        _streams.pop(terminal_id, None)
        _offsets.pop(terminal_id, None)


async def _kill_terminal(item: dict) -> None:
    terminal_id = item.get("terminalId")
    if not terminal_id:
        return
    try:
        await _host().request({"op": "kill", "id": terminal_id}, ("killed",))
    except Exception:
        pass


async def stop(session_id: str) -> dict:
    from app.services import gates

    item = _entry(session_id)
    terminal_id = item.get("terminalId")
    gates.close_session(session_id)
    item["state"] = "stopped"
    item["lastMessage"] = _clip(item.get("lastMessage") or "Stopped")
    _forget(terminal_id)
    await _kill_terminal(item)
    _discover_claude_session(item)
    _changed(item)
    if item["mode"] == "interactive":
        await _snapshot(item, "at stop")
    return public(item)


async def resume(session_id: str) -> dict:
    item = _entry(session_id)
    if item["state"] in LIVE_STATES:
        raise Refused(409, "the session is already running")
    if not os.path.isdir(item["worktree"]):
        raise Refused(409, "the worktree of this session no longer exists")
    _discover_claude_session(item)
    args = ["--resume", item["claudeSessionId"]] if item.get("claudeSessionId") else ["--continue"]
    before = item["state"]
    item["state"] = "working"
    try:
        item["terminalId"] = await _start_claude_terminal(item, args)
    except BaseException:
        item["state"] = before
        raise
    item["mode"] = "interactive"
    item["lastMessage"] = _clip("Resumed" + (f" ({item['claudeSessionId']})" if item.get("claudeSessionId") else " (most recent conversation in the worktree)"))
    _changed(item)
    _ensure_consumer()
    return public(item)


async def _dirty(path: str) -> list[str]:
    code, out, err = await _run([_git(), "status", "--porcelain"], cwd=path)
    if code != 0:
        raise Refused(409, "could not read the worktree status: " + (err.strip() or "unknown error"))
    return [line for line in out.splitlines() if line.strip()]


async def delete(session_id: str, remove_worktree: bool, force: bool) -> None:
    from app.services import gates

    item = _entry(session_id)
    gates.close_session(session_id)
    exists = os.path.isdir(item["worktree"])
    if remove_worktree and exists and not force:
        changes = await _dirty(item["worktree"])
        if changes:
            raise Refused(409, f"the worktree has {len(changes)} uncommitted change(s); commit or discard them, or delete with force")
    _forget(item.get("terminalId"))
    await _kill_terminal(item)
    if remove_worktree and exists:
        argv = [_git(), "worktree", "remove"] + (["--force"] if force else []) + [item["worktree"]]
        code, _, err = await _run(argv, cwd=item["repo"] if os.path.isdir(item["repo"]) else None)
        if code != 0:
            if item.get("state") in LIVE_STATES:
                item["state"] = "stopped"
                item["lastMessage"] = _clip("Stopped; the worktree could not be removed")
                _changed(item)
            raise Refused(409, "git could not remove the worktree: " + (err.strip() or "unknown error"))
        await _run([_git(), "worktree", "prune"], cwd=item["repo"] if os.path.isdir(item["repo"]) else None)
        await _run([_git(), "branch", "-d", item["branch"]], cwd=item["repo"] if os.path.isdir(item["repo"]) else None)
    with _lock:
        _sessions.pop(session_id, None)
    _save()
    _publish("removed", {"id": session_id})


async def reconcile() -> None:
    _load()
    from app.services.runs import worktree

    worktree.start_sweeper()
    live = [item for item in _sessions.values() if item["state"] in LIVE_STATES]
    if not live:
        return
    known: dict[str, dict] = {}
    try:
        for entry in await _host().list(start=False):
            if isinstance(entry, dict) and isinstance(entry.get("id"), str):
                known[entry["id"]] = entry
    except Exception:
        known = {}
    for item in live:
        terminal_id = item.get("terminalId")
        headless = item["mode"] == "headless"
        if not os.path.isdir(item["worktree"]):
            _set_state(item, "failed", "The worktree of this session is gone", notice=False)
            continue
        if terminal_id and terminal_id in known:
            if headless:
                _streams[terminal_id] = _fresh_stream(item["id"])
            try:
                await _watch(terminal_id, item["id"], 0 if headless else None)
                continue
            except Exception:
                _forget(terminal_id)
        _discover_claude_session(item)
        _set_state(item, "stopped", "The agent process is gone; resume the session to continue", notice=False)


async def shutdown() -> None:
    global _consumer, _host_client
    if _consumer is not None:
        _consumer.cancel()
        try:
            await _consumer
        except (asyncio.CancelledError, Exception):
            pass
        _consumer = None
    if _host_client is not None:
        client, _host_client = _host_client, None
        await client.close()


def _front_matter(text: str) -> dict[str, str]:
    lines = text.lstrip("﻿").splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    block: list[str] = []
    for line in lines[1:]:
        if line.strip() == "---":
            break
        block.append(line)
    else:
        return {}
    out: dict[str, str] = {}
    index = 0
    while index < len(block):
        line = block[index]
        index += 1
        match = re.match(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$", line)
        if not match:
            continue
        key, value = match.group(1), match.group(2).strip()
        if value[:1] in (">", "|"):
            folded = value[0] == ">"
            parts: list[str] = []
            while index < len(block) and (block[index].startswith((" ", "\t")) or not block[index].strip()):
                parts.append(block[index].strip())
                index += 1
            value = (" " if folded else "\n").join(part for part in parts if part)
        elif len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            pieces = [value]
            while index < len(block) and block[index].startswith((" ", "\t")) and block[index].strip():
                pieces.append(block[index].strip())
                index += 1
            value = " ".join(piece for piece in pieces if piece)
        out[key] = value
    return out


def _scan_skills(folder: Path, source: str, base: Path | None) -> list[dict]:
    found: list[dict] = []
    try:
        children = sorted(folder.iterdir(), key=lambda p: p.name.lower())
    except OSError:
        return found
    for child in children:
        manifest = child / "SKILL.md"
        try:
            if not child.is_dir() or not manifest.is_file() or manifest.stat().st_size > 512 * 1024:
                continue
            if base is not None and not os.path.realpath(manifest).startswith(os.path.realpath(base) + os.sep):
                continue
            meta = _front_matter(manifest.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        shown = manifest.relative_to(base).as_posix() if base is not None else str(manifest)
        found.append({"name": meta.get("name") or child.name, "description": meta.get("description", ""), "path": shown, "source": source})
    return found


def list_skills() -> list[dict]:
    skills: list[dict] = []
    try:
        root = Path(ws.real_root())
    except ws.Refused:
        root = None
    if root is not None:
        skills.extend(_scan_skills(root / ".claude" / "skills", "project", root))
    skills.extend(_scan_skills(Path.home() / ".claude" / "skills", "user", None))
    return skills
