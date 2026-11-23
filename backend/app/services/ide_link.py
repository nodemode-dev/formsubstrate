import asyncio
import atexit
import contextlib
import json
import logging
import os
import secrets
import threading
from http import HTTPStatus
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response

from app.core import config, local_guard, lsp, startup, workspace_root

IDE_NAME = "Substrate"
SERVER_NAME = "formsubstrate-ide"
AUTH_HEADER = "X-Claude-Code-Ide-Authorization"
SUBPROTOCOL = "mcp"
PORT_MIN = 10000
PORT_MAX = 65535
PORT_TRIES = 64
MAX_CLIENTS = 8
MAX_FRAME = 16 * 1024 * 1024
MAX_TEXT = 4 * 1024 * 1024
MAX_SELECTION = 200_000
MAX_EDITORS = 400
MAX_PATH = 4096
WINDOW_WAIT = 10.0
SETTINGS_NAME = "ide.json"
PROTOCOLS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
FALLBACK_PROTOCOL = "2024-11-05"
SEVERITY = {1: "Error", 2: "Warning", 3: "Info", 4: "Hint"}
LANGUAGE_IDS = {
    "py": "python", "ts": "typescript", "tsx": "typescriptreact", "js": "javascript", "jsx": "javascriptreact", "mjs": "javascript", "cjs": "javascript",
    "rs": "rust", "go": "go", "json": "json", "md": "markdown", "css": "css", "html": "html", "toml": "toml", "yaml": "yaml", "yml": "yaml",
    "sh": "shellscript", "c": "c", "h": "c", "cpp": "cpp", "hpp": "cpp", "java": "java", "rb": "ruby", "php": "php", "sql": "sql", "xml": "xml",
}

log = logging.getLogger("formsubstrate.ide")


class Refused(Exception):
    pass


class Client:
    def __init__(self, ws: ServerConnection, number: int) -> None:
        self.ws = ws
        self.number = number
        self.pid: int | None = None
        self.tasks: set[asyncio.Task] = set()
        self.diffs: dict[str, str] = {}


_guard = asyncio.Lock()
_file_lock = threading.Lock()
_server = None
_port = 0
_token = ""
_lock_path: Path | None = None
_lock_folders: list[str] = []
_clients: dict[int, Client] = {}
_numbers = 0
_subscribers: set[asyncio.Queue] = set()
_pending: dict[str, asyncio.Future] = {}
_diffs: dict[str, dict] = {}
_state: dict = {"editors": [], "active": None, "selection": None}
_last_selection: dict | None = None
_sent_selection = ""
_enabled: bool | None = None
_exit_hooked = False


def _settings_file() -> Path:
    return config.data_dir() / SETTINGS_NAME


def enabled() -> bool:
    global _enabled
    if _enabled is None:
        try:
            raw = json.loads(_settings_file().read_text(encoding="utf-8"))
            _enabled = raw.get("enabled") is True if isinstance(raw, dict) else False
        except (OSError, ValueError):
            _enabled = False
    return _enabled


def _save_enabled(value: bool) -> None:
    global _enabled
    _enabled = value
    target = _settings_file()
    temp = target.with_name(target.name + ".tmp")
    temp.write_text(json.dumps({"enabled": value}, indent=2), encoding="utf-8")
    os.replace(temp, target)


def lock_dir() -> Path:
    raw = os.environ.get("CLAUDE_CONFIG_DIR")
    base = Path(raw).expanduser() if raw else Path.home() / ".claude"
    return base / "ide"


def _root() -> str | None:
    try:
        return workspace_root.real_root()
    except workspace_root.Refused:
        return None


def _worktrees() -> list[str]:
    from app.services import sessions

    try:
        roots = sessions.worktree_roots()
    except Exception:
        return []
    return [os.path.realpath(path) for path in roots if isinstance(path, str) and os.path.isdir(path)]


def _folders() -> list[str]:
    root = _root()
    if root is None:
        return []
    seen = [root]
    for path in _worktrees():
        if path not in seen:
            seen.append(path)
    return seen


def _clean_stale(folder: Path) -> None:
    try:
        names = [item for item in folder.iterdir() if item.suffix == ".lock"]
    except OSError:
        return
    for item in names:
        try:
            data = json.loads(item.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict) or data.get("ideName") != IDE_NAME:
            continue
        pid = data.get("pid")
        if isinstance(pid, int) and not isinstance(pid, bool) and pid != os.getpid() and startup.alive(pid):
            continue
        if isinstance(pid, int) and pid == os.getpid() and item == _lock_path:
            continue
        with contextlib.suppress(OSError):
            item.unlink()


def _write_lock() -> None:
    global _lock_path, _lock_folders
    if not _port or not _token:
        return
    folders = _folders()
    with _file_lock:
        if _lock_path is not None and folders == _lock_folders:
            return
        folder = lock_dir()
        made = not folder.is_dir()
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        if made:
            with contextlib.suppress(OSError):
                os.chmod(folder, 0o700)
        target = folder / f"{_port}.lock"
        temp = folder / f".{_port}.lock.{os.getpid()}.tmp"
        body = json.dumps({
            "pid": os.getpid(),
            "workspaceFolders": folders,
            "ideName": IDE_NAME,
            "transport": "ws",
            "useWebSocket": True,
            "runningInWindows": os.name == "nt",
            "authToken": _token,
        })
        fd = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, body.encode("utf-8"))
        finally:
            os.close(fd)
        with contextlib.suppress(OSError):
            os.chmod(temp, 0o600)
        os.replace(temp, target)
        _lock_path = target
        _lock_folders = folders


def _remove_lock() -> None:
    global _lock_path, _lock_folders
    with _file_lock:
        path, _lock_path, _lock_folders = _lock_path, None, []
    if path is not None:
        with contextlib.suppress(OSError):
            path.unlink()


def _reject(status: HTTPStatus, text: str) -> Response:
    body = text.encode("utf-8")
    return Response(status.value, status.phrase, Headers([("Content-Type", "text/plain; charset=utf-8"), ("Content-Length", str(len(body))), ("Connection", "close")]), body)


def _admit(connection: ServerConnection, request: Request) -> Response | None:
    headers = request.headers
    if local_guard._host_of(headers.get("Host", "")) not in local_guard.LOOPBACK:
        return _reject(HTTPStatus.FORBIDDEN, "Substrate answers this computer only")
    if headers.get("Origin") is not None or headers.get("Sec-Fetch-Site", "").strip().lower() == "cross-site":
        return _reject(HTTPStatus.FORBIDDEN, "web pages are refused")
    given = headers.get(AUTH_HEADER) or ""
    if not _token or not given or not secrets.compare_digest(given.encode("utf-8"), _token.encode("utf-8")):
        return _reject(HTTPStatus.UNAUTHORIZED, "the token of the lock file is required")
    if len(_clients) >= MAX_CLIENTS:
        return _reject(HTTPStatus.SERVICE_UNAVAILABLE, "too many connections")
    return None


def _subprotocol(connection: ServerConnection, offered) -> str | None:
    return SUBPROTOCOL if SUBPROTOCOL in offered else None


async def _start() -> None:
    global _server, _port, _token, _exit_hooked
    _clean_stale(lock_dir())
    _token = secrets.token_hex(32)
    last: OSError | None = None
    for _ in range(PORT_TRIES):
        port = PORT_MIN + secrets.randbelow(PORT_MAX - PORT_MIN + 1)
        try:
            _server = await serve(_serve, "127.0.0.1", port, origins=[None], select_subprotocol=_subprotocol, process_request=_admit, max_size=MAX_FRAME, server_header=None, ping_interval=30, ping_timeout=30)
        except OSError as exc:
            last = exc
            continue
        _port = port
        break
    else:
        _token = ""
        raise Refused(f"no free port on 127.0.0.1: {last}")
    try:
        _write_lock()
    except OSError as exc:
        await _stop()
        raise Refused(f"the lock file could not be written: {exc}") from exc
    if not _exit_hooked:
        _exit_hooked = True
        atexit.register(_remove_lock)
    log.info("IDE connection listening on 127.0.0.1:%s", _port)
    _publish("status", status())


async def _stop() -> None:
    global _server, _port, _token, _sent_selection
    server, _server = _server, None
    _remove_lock()
    _port = 0
    _token = ""
    _sent_selection = ""
    for client in list(_clients.values()):
        _drop(client)
    if server is not None:
        server.close(close_connections=True)
        with contextlib.suppress(Exception):
            await asyncio.wait_for(server.wait_closed(), 3)
    _publish("status", status())


async def sync() -> dict:
    async with _guard:
        want = enabled() and _root() is not None
        if want and _server is None:
            try:
                await _start()
            except Refused as exc:
                log.warning("IDE connection not started: %s", exc)
        elif not want and _server is not None:
            await _stop()
        elif _server is not None:
            with contextlib.suppress(OSError):
                _write_lock()
    return status()


async def set_enabled(value: bool) -> dict:
    _save_enabled(bool(value))
    return await sync()


async def shutdown() -> None:
    async with _guard:
        await _stop()


def status() -> dict:
    return {"enabled": enabled(), "running": _server is not None, "port": _port or None, "clients": len(_clients), "ideName": IDE_NAME, "lockFile": str(_lock_path).replace("\\", "/") if _lock_path else None}


def add_env(env: dict[str, str]) -> None:
    if _server is None or not _port:
        return
    with contextlib.suppress(OSError):
        _write_lock()
    env["CLAUDE_CODE_SSE_PORT"] = str(_port)
    env["ENABLE_IDE_INTEGRATION"] = "true"
    env.setdefault("CLAUDE_CODE_AUTO_CONNECT_IDE", "true")


def subscribe() -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.add(queue)
    queue.put_nowait(("status", status()))
    for item in _diffs.values():
        queue.put_nowait(("diff", item))
    return queue


def unsubscribe(queue: asyncio.Queue) -> None:
    _subscribers.discard(queue)


def _publish(event: str, payload: dict) -> None:
    for queue in list(_subscribers):
        queue.put_nowait((event, payload))


def _uri(path: str) -> str:
    flat = path.replace("\\", "/")
    return "file://" + quote(flat if flat.startswith("/") else "/" + flat, safe="/:")


def _path_of(value: str) -> str:
    if value.startswith("file://"):
        raw = unquote(urlsplit(value).path)
        if os.name == "nt" and len(raw) > 2 and raw[0] == "/" and raw[2] == ":":
            raw = raw[1:]
        return raw
    return value


def _same(a: str, b: str) -> bool:
    return os.path.normcase(os.path.normpath(a)) == os.path.normcase(os.path.normpath(b))


def _absolute(rel: str) -> str | None:
    try:
        real, _ = workspace_root.resolve(rel)
    except workspace_root.Refused:
        return None
    return real


def _relative(path: object) -> str:
    if not isinstance(path, str) or not path or "\0" in path or len(path) > MAX_PATH:
        raise Refused("a file path is required")
    root = _root()
    if root is None:
        raise Refused("no workspace is open in Substrate")
    raw = _path_of(path)
    real = os.path.realpath(raw if os.path.isabs(raw) else os.path.join(root, raw))
    if not workspace_root._inside(real, root) or real == root:
        raise Refused("the file is outside the workspace open in Substrate")
    return os.path.relpath(real, root).replace("\\", "/")


def _readable(path: object) -> str:
    if not isinstance(path, str) or not path or "\0" in path or len(path) > MAX_PATH:
        raise Refused("a file path is required")
    raw = _path_of(path)
    folders = _folders()
    if not folders:
        raise Refused("no workspace is open in Substrate")
    real = os.path.realpath(raw if os.path.isabs(raw) else os.path.join(folders[0], raw))
    if not any(workspace_root._inside(real, base) for base in folders):
        raise Refused("the file is outside the workspace open in Substrate")
    return real


def _read_text(real: str) -> str:
    try:
        if os.path.getsize(real) > MAX_TEXT:
            raise Refused("the file is too large to show as a diff")
        with open(real, "rb") as handle:
            return handle.read().decode("utf-8", errors="replace")
    except FileNotFoundError:
        return ""
    except OSError as exc:
        raise Refused(f"the file could not be read: {exc}") from exc


def _position(raw: object) -> dict:
    data = raw if isinstance(raw, dict) else {}
    line, character = data.get("line"), data.get("character")
    return {
        "line": line if isinstance(line, int) and not isinstance(line, bool) and line >= 0 else 0,
        "character": character if isinstance(character, int) and not isinstance(character, bool) and character >= 0 else 0,
    }


def _selection_params(sel: dict) -> dict:
    return {"text": sel["text"], "filePath": sel["filePath"], "fileUrl": _uri(sel["filePath"]), "selection": {"start": sel["start"], "end": sel["end"], "isEmpty": sel["isEmpty"]}}


def set_state(body: dict) -> None:
    global _last_selection, _sent_selection
    editors: list[dict] = []
    raw_editors = body.get("editors")
    for item in (raw_editors if isinstance(raw_editors, list) else [])[:MAX_EDITORS]:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            continue
        real = _absolute(item["path"])
        if real is not None:
            editors.append({"path": real, "dirty": item.get("dirty") is True})
    active = _absolute(body["active"]) if isinstance(body.get("active"), str) else None
    selection = None
    raw = body.get("selection")
    if isinstance(raw, dict) and isinstance(raw.get("path"), str) and isinstance(raw.get("text"), str):
        real = _absolute(raw["path"])
        if real is not None:
            start, end = _position(raw.get("start")), _position(raw.get("end"))
            selection = {"filePath": real, "text": raw["text"][:MAX_SELECTION], "start": start, "end": end, "isEmpty": start == end}
    _state["editors"] = editors
    _state["active"] = active
    _state["selection"] = selection
    if selection is None:
        return
    _last_selection = selection
    key = json.dumps(selection, sort_keys=True)
    if key == _sent_selection:
        return
    _sent_selection = key
    _notify("selection_changed", _selection_params(selection))


def mention(body: dict) -> int:
    path = body.get("path")
    real = _absolute(path) if isinstance(path, str) else None
    if real is None:
        raise Refused("a file of the workspace is required")
    first, last = body.get("lineStart"), body.get("lineEnd")
    params: dict = {"filePath": real}
    if isinstance(first, int) and isinstance(last, int) and not isinstance(first, bool) and not isinstance(last, bool) and 0 <= first <= last:
        params["lineStart"] = first
        params["lineEnd"] = last
    return _notify("at_mentioned", params)


def _notify(method: str, params: dict) -> int:
    text = json.dumps({"jsonrpc": "2.0", "method": method, "params": params})
    sent = 0
    for client in list(_clients.values()):
        task = asyncio.ensure_future(_send(client, text))
        client.tasks.add(task)
        task.add_done_callback(client.tasks.discard)
        sent += 1
    return sent


async def _send(client: Client, text: str) -> None:
    with contextlib.suppress(ConnectionClosed, OSError):
        await client.ws.send(text)


def reply(body: dict) -> bool:
    future = _pending.get(body.get("id")) if isinstance(body.get("id"), str) else None
    if future is None or future.done():
        return False
    future.set_result(body)
    return True


async def _ask_window(event: str, payload: dict, wait: float | None) -> dict:
    if not _subscribers:
        raise Refused("the Substrate window is not listening")
    rid = secrets.token_hex(8)
    future: asyncio.Future = asyncio.get_running_loop().create_future()
    _pending[rid] = future
    try:
        _publish(event, {**payload, "id": rid})
        if wait is None:
            return await future
        return await asyncio.wait_for(future, wait)
    except asyncio.TimeoutError as exc:
        raise Refused("the Substrate window did not answer in time") from exc
    finally:
        _pending.pop(rid, None)


def _text(value: str) -> dict:
    return {"content": [{"type": "text", "text": value}]}


def _json(value: object) -> dict:
    return _text(json.dumps(value))


def _fail(message: str) -> dict:
    return {"content": [{"type": "text", "text": message}], "isError": True}


def _diagnostics(args: dict) -> dict:
    root = _root()
    docs = lsp.diagnostics_of(root) if root else None
    wanted = args.get("uri") if isinstance(args.get("uri"), str) and args.get("uri") else None
    out: list[dict] = []
    for doc in docs or []:
        if wanted is not None and doc["uri"] != wanted and not _same(_path_of(doc["uri"]), _path_of(wanted)):
            continue
        rows = []
        for item in doc["items"]:
            at = {"line": item["line"], "character": item["character"]}
            row = {"message": item["message"], "severity": SEVERITY.get(item["severity"], "Info"), "range": {"start": at, "end": dict(at)}}
            if item.get("source"):
                row["source"] = item["source"]
            if item.get("code"):
                row["code"] = item["code"]
            rows.append(row)
        out.append({"uri": doc["uri"], "diagnostics": rows})
    if wanted is not None and not out:
        out.append({"uri": wanted, "diagnostics": []})
    return _json(out)


def _open_editors() -> dict:
    tabs = []
    for item in _state["editors"]:
        name = os.path.basename(item["path"])
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        tabs.append({"uri": _uri(item["path"]), "isActive": item["path"] == _state["active"], "label": name, "languageId": LANGUAGE_IDS.get(ext, "plaintext"), "isDirty": item["dirty"]})
    return _json({"tabs": tabs})


def _selection_result(sel: dict | None, missing: str) -> dict:
    if sel is None:
        return _json({"success": False, "message": missing})
    return _json({"success": True, "text": sel["text"], "filePath": sel["filePath"], "fileUrl": _uri(sel["filePath"]), "selection": {"start": sel["start"], "end": sel["end"], "isEmpty": sel["isEmpty"]}})


def _workspace_folders() -> dict:
    folders = _folders()
    return _json({"success": True, "folders": [{"name": workspace_root.display_name(path), "uri": _uri(path), "path": path.replace("\\", "/")} for path in folders], "rootPath": folders[0].replace("\\", "/") if folders else None})


def _editor_of(path: object) -> dict | None:
    if not isinstance(path, str) or not path:
        return None
    raw = _path_of(path)
    for item in _state["editors"]:
        if _same(item["path"], raw) or _same(item["path"], os.path.realpath(raw)):
            return item
    return None


async def _open_file(args: dict) -> dict:
    rel = _relative(args.get("filePath"))
    front = args.get("makeFrontmost") is not False
    answer = await _ask_window("open-file", {
        "path": rel,
        "startText": args.get("startText") if isinstance(args.get("startText"), str) else None,
        "endText": args.get("endText") if isinstance(args.get("endText"), str) else None,
        "toLineEnd": args.get("selectToEndOfLine") is True,
    }, WINDOW_WAIT)
    if answer.get("ok") is not True:
        raise Refused(str(answer.get("message") or "the file could not be opened")[:400])
    real = _absolute(rel) or rel
    if front:
        return _text(f"Opened file: {real}")
    name = os.path.basename(real)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    lines = answer.get("lineCount")
    return _json({"success": True, "filePath": real, "languageId": LANGUAGE_IDS.get(ext, "plaintext"), "lineCount": lines if isinstance(lines, int) else 0})


async def _save_document(args: dict) -> dict:
    item = _editor_of(args.get("filePath"))
    if item is None:
        return _json({"success": False, "message": f"Document not open: {args.get('filePath')}"})
    answer = await _ask_window("save", {"path": _relative(item["path"])}, WINDOW_WAIT)
    saved = answer.get("ok") is True
    return _json({"success": saved, "filePath": item["path"], "saved": saved, "message": "Document saved successfully" if saved else str(answer.get("message") or "the document was not saved")[:400]})


def _close_diff(client: Client, tab: str) -> bool:
    rid = client.diffs.pop(tab, None)
    if rid is None:
        return False
    _diffs.pop(rid, None)
    future = _pending.get(rid)
    if future is not None and not future.done():
        future.cancel()
    _publish("diff-close", {"id": rid})
    return True


async def _open_diff(client: Client, args: dict) -> dict:
    proposed = args.get("new_file_contents")
    tab = args.get("tab_name")
    target = args.get("new_file_path") if isinstance(args.get("new_file_path"), str) and args.get("new_file_path") else args.get("old_file_path")
    if not isinstance(proposed, str) or not isinstance(tab, str) or not tab or len(tab) > 400:
        raise Refused("openDiff needs new_file_contents and tab_name")
    if len(proposed) > MAX_TEXT:
        raise Refused("the proposed text is too large to show as a diff")
    real = _readable(target)
    source = args.get("old_file_path") if isinstance(args.get("old_file_path"), str) and args.get("old_file_path") else target
    original = await asyncio.to_thread(_read_text, _readable(source))
    if not _subscribers:
        raise Refused("the Substrate window is not listening")
    _close_diff(client, tab)
    rid = secrets.token_hex(8)
    future: asyncio.Future = asyncio.get_running_loop().create_future()
    _pending[rid] = future
    item = {"id": rid, "tab": tab, "path": real.replace("\\", "/"), "name": os.path.basename(real), "original": original, "proposed": proposed}
    _diffs[rid] = item
    client.diffs[tab] = rid
    _publish("diff", item)
    try:
        answer = await future
    finally:
        _pending.pop(rid, None)
        _diffs.pop(rid, None)
        if client.diffs.get(tab) == rid:
            client.diffs.pop(tab, None)
    if answer.get("choice") == "accept":
        return {"content": [{"type": "text", "text": "FILE_SAVED"}, {"type": "text", "text": proposed}]}
    return {"content": [{"type": "text", "text": "DIFF_REJECTED"}, {"type": "text", "text": tab}]}


NO_INPUT = {"type": "object", "properties": {}, "additionalProperties": False}
FILE_INPUT = {"type": "object", "properties": {"filePath": {"type": "string", "description": "Path of the file"}}, "required": ["filePath"], "additionalProperties": False}
TOOLS = [
    {"name": "getDiagnostics", "description": "Get language diagnostics (errors, warnings) from the editor's Problems list", "inputSchema": {"type": "object", "properties": {"uri": {"type": "string", "description": "Optional file URI. Without it, diagnostics for every file are returned."}}, "additionalProperties": False}},
    {"name": "openFile", "description": "Open a file in the editor and optionally select a range of text", "inputSchema": {"type": "object", "properties": {
        "filePath": {"type": "string", "description": "Path of the file to open"},
        "preview": {"type": "boolean", "default": False},
        "startText": {"type": "string", "description": "Text where the selection starts"},
        "endText": {"type": "string", "description": "Text where the selection ends"},
        "selectToEndOfLine": {"type": "boolean", "default": False},
        "makeFrontmost": {"type": "boolean", "default": True},
    }, "required": ["filePath"], "additionalProperties": False}},
    {"name": "openDiff", "description": "Show a proposed change as a diff and wait for the person to accept or reject it", "inputSchema": {"type": "object", "properties": {
        "old_file_path": {"type": "string"}, "new_file_path": {"type": "string"}, "new_file_contents": {"type": "string"}, "tab_name": {"type": "string"},
    }, "required": ["old_file_path", "new_file_path", "new_file_contents", "tab_name"], "additionalProperties": False}},
    {"name": "getCurrentSelection", "description": "Get the current text selection in the active editor", "inputSchema": NO_INPUT},
    {"name": "getLatestSelection", "description": "Get the most recent text selection, even when its editor is not active", "inputSchema": NO_INPUT},
    {"name": "getOpenEditors", "description": "Get the open editor tabs", "inputSchema": NO_INPUT},
    {"name": "getWorkspaceFolders", "description": "Get the workspace folders open in the editor", "inputSchema": NO_INPUT},
    {"name": "checkDocumentDirty", "description": "Check whether a document has unsaved changes", "inputSchema": FILE_INPUT},
    {"name": "saveDocument", "description": "Save a document with unsaved changes", "inputSchema": FILE_INPUT},
    {"name": "close_tab", "description": "Close a diff tab by name", "inputSchema": {"type": "object", "properties": {"tab_name": {"type": "string"}}, "required": ["tab_name"], "additionalProperties": False}},
    {"name": "closeAllDiffTabs", "description": "Close all diff tabs", "inputSchema": NO_INPUT},
]
TOOL_NAMES = frozenset(tool["name"] for tool in TOOLS)


async def _call(client: Client, name: str, args: dict) -> dict:
    if name == "getDiagnostics":
        return _diagnostics(args)
    if name == "getOpenEditors":
        return _open_editors()
    if name == "getCurrentSelection":
        sel = _state["selection"]
        return _selection_result(sel if sel is not None and sel["filePath"] == _state["active"] else None, "No active editor found")
    if name == "getLatestSelection":
        return _selection_result(_last_selection, "No selection available")
    if name == "getWorkspaceFolders":
        return _workspace_folders()
    if name == "checkDocumentDirty":
        item = _editor_of(args.get("filePath"))
        if item is None:
            return _json({"success": False, "message": f"Document not open: {args.get('filePath')}"})
        return _json({"success": True, "filePath": item["path"], "isDirty": item["dirty"], "isUntitled": False})
    if name == "saveDocument":
        return await _save_document(args)
    if name == "openFile":
        return await _open_file(args)
    if name == "openDiff":
        return await _open_diff(client, args)
    if name == "close_tab":
        tab = args.get("tab_name")
        if isinstance(tab, str):
            _close_diff(client, tab)
        return _text("TAB_CLOSED")
    count = 0
    for tab in list(client.diffs):
        count += 1 if _close_diff(client, tab) else 0
    return _text(f"CLOSED_{count}_DIFF_TABS")


async def _run_tool(client: Client, rid: object, params: dict) -> None:
    name = params.get("name")
    args = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
    if name not in TOOL_NAMES:
        await _send(client, json.dumps({"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": f"unknown tool: {name}"}}))
        return
    try:
        result = await _call(client, name, args)
    except Refused as exc:
        result = _fail(str(exc))
    except asyncio.CancelledError:
        return
    except Exception:
        log.exception("IDE tool %s failed", name)
        result = _fail("the tool failed inside Substrate")
    await _send(client, json.dumps({"jsonrpc": "2.0", "id": rid, "result": result}))


def _answer(client: Client, msg: dict) -> dict | None:
    method = msg.get("method")
    rid = msg.get("id")
    params = msg.get("params") if isinstance(msg.get("params"), dict) else {}
    if not isinstance(method, str):
        return None
    if "id" not in msg:
        if method == "ide_connected":
            pid = params.get("pid")
            client.pid = pid if isinstance(pid, int) and not isinstance(pid, bool) else None
        return None
    if method == "initialize":
        asked = params.get("protocolVersion")
        return {"jsonrpc": "2.0", "id": rid, "result": {
            "protocolVersion": asked if asked in PROTOCOLS else FALLBACK_PROTOCOL,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "title": IDE_NAME, "version": config.VERSION},
        }}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": rid, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": rid, "result": {"tools": TOOLS}}
    if method == "prompts/list":
        return {"jsonrpc": "2.0", "id": rid, "result": {"prompts": []}}
    if method == "resources/list":
        return {"jsonrpc": "2.0", "id": rid, "result": {"resources": []}}
    if method == "tools/call":
        task = asyncio.ensure_future(_run_tool(client, rid, params))
        client.tasks.add(task)
        task.add_done_callback(client.tasks.discard)
        return None
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"method not found: {method}"}}


def _drop(client: Client) -> None:
    _clients.pop(client.number, None)
    for tab in list(client.diffs):
        _close_diff(client, tab)
    for task in list(client.tasks):
        task.cancel()


async def _serve(ws: ServerConnection) -> None:
    global _numbers
    _numbers += 1
    client = Client(ws, _numbers)
    _clients[client.number] = client
    _publish("status", status())
    try:
        async for raw in ws:
            if not isinstance(raw, str):
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                await _send(client, json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}))
                continue
            if not isinstance(msg, dict):
                continue
            answer = _answer(client, msg)
            if answer is not None:
                await _send(client, json.dumps(answer))
            if msg.get("method") == "notifications/initialized" and _state["selection"] is not None:
                await _send(client, json.dumps({"jsonrpc": "2.0", "method": "selection_changed", "params": _selection_params(_state["selection"])}))
    except ConnectionClosed:
        pass
    finally:
        _drop(client)
        _publish("status", status())
