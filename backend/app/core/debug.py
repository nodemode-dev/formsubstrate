import asyncio
import contextlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from app.core import config, debug_launch, workspace_root as ws

SETTINGS_NAME = "debug.json"
SETTINGS_PATH_MAX = 1024
JS_DEBUG_ENTRY = "dapDebugServer.js"
JS_DEBUG_INSIDE = ((), ("src",), ("js-debug", "src"), ("js-debug",))
JS_DEBUG_ENV = "FORMSUBSTRATE_JS_DEBUG"
JS_DEBUG_HOST = "127.0.0.1"
CONNECT_WAIT = 15.0
CHILD_WAIT = 20.0
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
ROOT_ONLY = frozenset({"initialize", "launch", "configurationDone", "disconnect", "terminate"})
BROADCAST = frozenset({"setBreakpoints", "setExceptionBreakpoints", "setFunctionBreakpoints"})
RESUMES = frozenset({"continue", "next", "stepIn", "stepOut"})
PROBE ="import debugpy;print(debugpy.__version__)"
PROBE_TIMEOUT = 12
MESSAGE_MAX = 16 * 1024 * 1024
ARGS_MAX = 256
ARG_LEN_MAX = 4096
STDERR_KEEP = 4096
KILL_GRACE = 2.0
DISCONNECT_GRACE = 0.8
VENV_NAMES = (".venv", "venv")
INSTALL_HINT = "{python} -m pip install debugpy"
ENV_KEEP = (
    "PATH", "HOME", "USER", "LOGNAME", "LANG", "LANGUAGE", "TZ", "TMPDIR", "TEMP", "TMP",
    "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR",
    "SYSTEMROOT", "SystemDrive", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
)
TRUSTED_NOTE = "a workspace venv was found and was not run; trust the workspace to use it"
ALLOWED = frozenset({
    "initialize", "launch", "configurationDone", "disconnect", "terminate", "terminateThreads", "cancel",
    "setBreakpoints", "setFunctionBreakpoints", "setExceptionBreakpoints", "setDataBreakpoints", "setInstructionBreakpoints",
    "dataBreakpointInfo", "breakpointLocations", "exceptionInfo",
    "continue", "next", "stepIn", "stepOut", "stepBack", "reverseContinue", "restartFrame", "goto", "gotoTargets", "stepInTargets", "pause",
    "threads", "stackTrace", "scopes", "variables", "setVariable", "setExpression", "evaluate", "completions", "source", "loadedSources", "modules",
    "disassemble", "readMemory",
})
HEADER_MAX = 65536


class HeaderTooLong(Exception):
    pass


def minimal_env() -> dict[str, str]:
    env = {key: os.environ[key] for key in ENV_KEEP if key in os.environ}
    for key, value in os.environ.items():
        if key.startswith("LC_"):
            env[key] = value
    return env


def venv_python(root: str) -> str | None:
    tails = (("bin", "python"), ("bin", "python3"), ("Scripts", "python.exe"))
    for name in VENV_NAMES:
        for tail in tails:
            candidate = os.path.join(root, name, *tail)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    return None


def system_pythons() -> list[str]:
    found: list[str] = []
    for name in ("python3", "python"):
        path = shutil.which(name)
        if path and path not in found:
            found.append(path)
    return found


def probe(python: str) -> str | None:
    try:
        done = subprocess.run([python, "-c", PROBE], capture_output=True, text=True, timeout=PROBE_TIMEOUT, cwd=tempfile.gettempdir(), env=minimal_env(), stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    return done.stdout.strip().splitlines()[-1] if done.stdout.strip() else None


def python_version(python: str) -> str | None:
    try:
        done = subprocess.run([python, "-c", "import sys;print('.'.join(map(str,sys.version_info[:3])))"], capture_output=True, text=True, timeout=PROBE_TIMEOUT, cwd=tempfile.gettempdir(), env=minimal_env(), stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout.strip() or None if done.returncode == 0 else None


def resolve_python(root: str | None, trust: bool = False) -> dict:
    candidates: list[dict] = []
    venv = venv_python(root) if root else None
    if venv:
        candidates.append({"python": venv, "source": "workspace venv", "runnable": trust})
    for path in system_pythons():
        candidates.append({"python": path, "source": "system", "runnable": True})
    for item in candidates:
        if item["runnable"]:
            item["debugpy"] = probe(item["python"])
            item["version"] = python_version(item["python"]) if item["debugpy"] else None
        else:
            item["debugpy"] = None
            item["version"] = None
    runnable = [c for c in candidates if c["runnable"]]
    debuggee = runnable[0]["python"] if runnable else None
    adapter = next((c for c in runnable if c["debugpy"]), None)
    return {"candidates": candidates, "debuggee": debuggee, "adapter": adapter}


_settings_lock = threading.Lock()


def _settings_file() -> Path:
    return config.data_dir() / SETTINGS_NAME


def settings() -> dict:
    try:
        with open(_settings_file(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        data = None
    path = data.get("jsDebugPath") if isinstance(data, dict) else None
    return {"jsDebugPath": path if isinstance(path, str) and len(path) <= SETTINGS_PATH_MAX and not CONTROL.search(path) else ""}


def save_settings(body: object) -> dict:
    path = body.get("jsDebugPath") if isinstance(body, dict) else None
    if not isinstance(path, str):
        raise ws.Refused(400, "jsDebugPath must be text")
    path = path.strip()
    if len(path) > SETTINGS_PATH_MAX or CONTROL.search(path):
        raise ws.Refused(400, "the path is too long or has a control character")
    if path and not os.path.isabs(os.path.expanduser(path)):
        raise ws.Refused(400, "give an absolute path to the js-debug folder or to dapDebugServer.js")
    with _settings_lock:
        target = _settings_file()
        target.parent.mkdir(parents=True, exist_ok=True)
        holding = target.with_name(target.name + ".tmp")
        with open(holding, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps({"version": 1, "jsDebugPath": path}, indent=1) + "\n")
        os.replace(holding, target)
    return {"jsDebugPath": path}


def js_debug_entry(path: str) -> str | None:
    if not path:
        return None
    full = os.path.expanduser(path)
    if os.path.isfile(full):
        return os.path.realpath(full) if os.path.basename(full) == JS_DEBUG_ENTRY else None
    for inner in JS_DEBUG_INSIDE:
        candidate = os.path.join(full, *inner, JS_DEBUG_ENTRY)
        if os.path.isfile(candidate):
            return os.path.realpath(candidate)
    return None


def js_debug_places() -> list[str]:
    home = os.path.expanduser("~")
    places = [
        os.path.join(home, ".local", "share", "js-debug"),
        os.path.join(home, "js-debug"),
        os.path.join(home, ".local", "share", "nvim", "mason", "packages", "js-debug-adapter"),
        os.path.join(home, "Library", "Application Support", "js-debug"),
        "/usr/local/lib/js-debug",
        "/usr/local/share/js-debug",
        "/opt/js-debug",
    ]
    for key in ("LOCALAPPDATA", "PROGRAMFILES"):
        base = os.environ.get(key)
        if base:
            places.append(os.path.join(base, "js-debug"))
    local = os.environ.get("LOCALAPPDATA")
    if local:
        places.append(os.path.join(local, "nvim-data", "mason", "packages", "js-debug-adapter"))
    return places


def node_version(node: str) -> str | None:
    try:
        done = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=PROBE_TIMEOUT, cwd=tempfile.gettempdir(), env=minimal_env(), stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout.strip().lstrip("v") or None if done.returncode == 0 else None


def resolve_node() -> dict:
    configured = settings()["jsDebugPath"]
    server = js_debug_entry(configured)
    source = "configured" if server else None
    if server is None:
        for place in (os.environ.get(JS_DEBUG_ENV, ""), *js_debug_places()):
            server = js_debug_entry(place)
            if server:
                source = "known place"
                break
    node = shutil.which("node")
    return {"node": node, "server": server, "source": source, "configured": configured, "configuredFound": bool(configured) and source == "configured"}


def describe_node(found: dict | None = None) -> dict:
    found = found if found is not None else resolve_node()
    ready = bool(found["node"] and found["server"])
    reason = "" if ready else ("no-node" if not found["node"] else "no-js-debug")
    return {
        "id": "node",
        "label": "Node.js (js-debug)",
        "available": ready,
        "python": None,
        "adapterPython": None,
        "debugpy": None,
        "source": found["source"],
        "candidates": [],
        "install": None,
        "note": "" if ready else ("node was not found on this computer" if not found["node"] else "js-debug was not found; set its folder in Preferences"),
        "reason": reason,
        "node": found["node"],
        "nodeVersion": node_version(found["node"]) if found["node"] else None,
        "server": found["server"],
        "configured": found["configured"],
        "configuredFound": found["configuredFound"],
    }


def describe(root: str | None, found: dict | None = None, trusted: bool = False) -> dict:
    found = found if found is not None else resolve_python(root, trusted)
    adapter = found["adapter"]
    held = any(not c["runnable"] for c in found["candidates"])
    target = found["debuggee"] or "python3"
    entry = {
        "id": "python",
        "label": "Python (debugpy)",
        "available": adapter is not None,
        "python": found["debuggee"],
        "adapterPython": adapter["python"] if adapter else None,
        "debugpy": adapter["debugpy"] if adapter else None,
        "source": adapter["source"] if adapter else None,
        "candidates": [{"python": c["python"], "source": c["source"], "debugpy": c["debugpy"], "probed": c["runnable"]} for c in found["candidates"]],
        "install": None if adapter else INSTALL_HINT.format(python=target),
        "note": ("" if adapter else ("no python was found on this computer" if not found["candidates"] else "debugpy is not installed for any python that was found")) + (("; " if not adapter else "") + TRUSTED_NOTE if held else ""),
    }
    entry["reason"] = "" if adapter else "no-debugpy"
    return {"root": root, "adapters": [entry]}


def confine(value: object, root: str, *, must_be_file: bool = False) -> str:
    if not isinstance(value, str) or not value or "\0" in value:
        raise ws.Refused(400, "bad path")
    flat = value.replace("\\", "/")
    if os.path.isabs(value) or flat.startswith("/") or (len(flat) > 1 and flat[1] == ":"):
        real = os.path.realpath(value)
        if not ws._inside(real, root):
            raise ws.Refused(403, "the path leaves the workspace")
    else:
        real, _ = ws.resolve(value)
    if must_be_file and not os.path.isfile(real):
        raise ws.Refused(404, "the program file does not exist")
    return real


def launch_fields(raw: object, root: str, kind: str) -> dict:
    if not isinstance(raw, dict):
        raise ws.Refused(400, "launch needs arguments")
    picked = raw.get("configuration")
    if picked is None:
        return {**window_fields(raw, root), "kind": kind}
    if not isinstance(picked, dict):
        raise ws.Refused(400, "bad configuration")
    fields = debug_launch.resolve(root, picked.get("index"), picked.get("name"), raw.get("file"))
    if fields["kind"] != kind:
        raise ws.Refused(400, "the configuration is for another debugger")
    return fields


def launch_arguments(raw: object, root: str, kind: str, runtime: str) -> dict:
    fields = launch_fields(raw, root, kind)
    if kind == "node":
        return {
            "name": "formsubstrate",
            "type": "pwa-node",
            "request": "launch",
            "program": fields["program"],
            "args": fields["args"],
            "cwd": fields["cwd"],
            "runtimeExecutable": runtime,
            "console": "internalConsole",
            "outputCapture": "std",
            "stopOnEntry": fields["stopOnEntry"],
            "skipFiles": ["<node_internals>/**"] if fields["justMyCode"] else [],
            "env": dict(fields["env"]),
            "__workspaceFolder": root,
        }
    return {
        "name": "formsubstrate",
        "type": "python",
        "request": "launch",
        "program": fields["program"],
        "args": fields["args"],
        "cwd": fields["cwd"],
        "python": [runtime],
        "console": "internalConsole",
        "redirectOutput": True,
        "justMyCode": fields["justMyCode"],
        "stopOnEntry": fields["stopOnEntry"],
        "env": {"PYTHONUNBUFFERED": "1", **fields["env"]},
    }


def window_fields(raw: dict, root: str) -> dict:
    program = confine(raw.get("program"), root, must_be_file=True)
    cwd_in = raw.get("cwd")
    cwd = confine(cwd_in, root) if cwd_in else root
    if not os.path.isdir(cwd):
        raise ws.Refused(404, "the working folder does not exist")
    args_in = raw.get("args") or []
    if not isinstance(args_in, list) or len(args_in) > ARGS_MAX:
        raise ws.Refused(400, "bad arguments")
    args = []
    for item in args_in:
        if not isinstance(item, str) or len(item) > ARG_LEN_MAX or "\0" in item:
            raise ws.Refused(400, "bad arguments")
        args.append(item)
    return {
        "program": program,
        "args": args,
        "cwd": cwd,
        "env": {},
        "justMyCode": raw.get("justMyCode") is not False,
        "stopOnEntry": raw.get("stopOnEntry") is True,
    }


def encode(message: dict) -> bytes:
    body = json.dumps(message, separators=(",", ":")).encode("utf-8")
    return b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n\r\n" + body


async def read_message(reader: asyncio.StreamReader) -> dict | None:
    length = -1
    while True:
        try:
            line = await reader.readline()
        except (ValueError, asyncio.LimitOverrunError) as err:
            raise HeaderTooLong("the adapter sent a header line that is too long") from err
        if not line:
            return None
        if len(line) > HEADER_MAX:
            raise HeaderTooLong("the adapter sent a header line that is too long")
        line = line.strip()
        if not line:
            if length < 0:
                continue
            break
        name, _, value = line.partition(b":")
        if name.strip().lower() == b"content-length":
            try:
                length = int(value.strip())
            except ValueError:
                length = -1
    if length < 0 or length > MESSAGE_MAX:
        return None
    try:
        body = await reader.readexactly(length)
    except asyncio.IncompleteReadError:
        return None
    try:
        parsed = json.loads(body)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def start_of(pid: int) -> str | None:
    try:
        with open(f"/proc/{pid}/stat", "rb") as handle:
            raw = handle.read().decode("utf-8", "replace")
    except OSError:
        return None
    tail = raw.rpartition(")")[2].split()
    return tail[19] if len(tail) > 19 else None


class Adapter:
    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        self.proc = proc
        self.tail = b""
        self.debuggee: int | None = None
        self.debuggee_ident: tuple[int, str | None] | None = None
        self.drain = asyncio.create_task(self._drain())

    async def _drain(self) -> None:
        err = self.proc.stderr
        if err is None:
            return
        while True:
            chunk = await err.read(1024)
            if not chunk:
                return
            self.tail = (self.tail + chunk)[-STDERR_KEEP:]

    async def send(self, message: dict) -> None:
        stdin = self.proc.stdin
        if stdin is None or stdin.is_closing():
            return
        stdin.write(encode(message))
        await stdin.drain()

    async def receive(self) -> dict | None:
        if self.proc.stdout is None:
            return None
        return await read_message(self.proc.stdout)

    async def stop(self) -> None:
        proc = self.proc
        if proc.returncode is None:
            with contextlib.suppress(Exception):
                await self.send({"seq": 1 << 30, "type": "request", "command": "disconnect", "arguments": {"terminateDebuggee": True}})
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(proc.wait(), DISCONNECT_GRACE)
        if proc.returncode is None:
            self._signal(signal.SIGTERM if sys.platform != "win32" else None)
            try:
                await asyncio.wait_for(proc.wait(), KILL_GRACE)
            except asyncio.TimeoutError:
                self._signal(signal.SIGKILL if sys.platform != "win32" else None, force=True)
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(proc.wait(), KILL_GRACE)
        elif sys.platform.startswith("linux") and start_of(proc.pid) is None:
            self._signal(signal.SIGKILL, force=True)
        self._kill_debuggee()
        self.drain.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await self.drain

    def note_debuggee(self, pid: int) -> None:
        self.debuggee = pid
        try:
            self.debuggee_ident = (os.getpgid(pid), start_of(pid)) if sys.platform != "win32" else None
        except OSError:
            self.debuggee = None
            self.debuggee_ident = None

    def forget_debuggee(self) -> None:
        self.debuggee = None
        self.debuggee_ident = None

    def _kill_debuggee(self) -> None:
        pid = self.debuggee
        ident = self.debuggee_ident
        self.forget_debuggee()
        if pid is None or pid <= 1:
            return
        if sys.platform == "win32":
            with contextlib.suppress(OSError, subprocess.SubprocessError):
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=10)
            return
        if ident is None:
            return
        try:
            now = (os.getpgid(pid), start_of(pid))
        except OSError:
            return
        if now != ident:
            return
        if ident[0] == pid:
            with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
                os.killpg(pid, signal.SIGKILL)
        with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
            os.kill(pid, signal.SIGKILL)

    def _signal(self, sig, force: bool = False) -> None:
        pid = self.proc.pid
        if sys.platform == "win32":
            with contextlib.suppress(OSError, subprocess.SubprocessError):
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=10)
            return
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(pid, sig)


async def spawn(adapter_python: str, root: str) -> Adapter:
    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    env = minimal_env()
    env["PYTHONUNBUFFERED"] = "1"
    proc = await asyncio.create_subprocess_exec(
        adapter_python, "-m", "debugpy.adapter",
        cwd=root, env=env,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        **kwargs,
    )
    return Adapter(proc)


class Link:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.reader = reader
        self.writer = writer
        self.seq = 0
        self.waiting: dict[int, asyncio.Future] = {}
        self.routes: dict[int, int] = {}
        self.ready = asyncio.Event()
        self.stopped: dict | None = None
        self.task: asyncio.Task | None = None

    async def send(self, message: dict) -> None:
        if self.writer.is_closing():
            return
        self.writer.write(encode(message))
        await self.writer.drain()

    async def call(self, command: str, arguments: object) -> dict:
        self.seq += 1
        seq = self.seq
        answer: asyncio.Future = asyncio.get_running_loop().create_future()
        self.waiting[seq] = answer
        try:
            await self.send({"seq": seq, "type": "request", "command": command, "arguments": arguments})
            reply = await asyncio.wait_for(answer, CHILD_WAIT)
        finally:
            self.waiting.pop(seq, None)
        if reply.get("success") is not True:
            raise RuntimeError(str(reply.get("message") or f"{command} failed"))
        return reply

    def close(self) -> None:
        for answer in self.waiting.values():
            if not answer.done():
                answer.set_exception(ConnectionError("the debug session closed"))
        self.waiting.clear()
        with contextlib.suppress(Exception):
            self.writer.close()


class NodeAdapter(Adapter):
    def __init__(self, proc: asyncio.subprocess.Process, port: int) -> None:
        super().__init__(proc)
        self.port = port
        self.out: asyncio.Queue = asyncio.Queue()
        self.root: Link | None = None
        self.children: list[Link] = []
        self.focus: Link | None = None
        self.init_args: dict = {}
        self.breakpoints: dict[str, dict] = {}
        self.broadcasts: dict[str, object] = {}
        self.jobs: set[asyncio.Task] = set()
        self.quiet = asyncio.create_task(self._quiet())

    async def _quiet(self) -> None:
        out = self.proc.stdout
        if out is None:
            return
        while True:
            chunk = await out.read(1024)
            if not chunk:
                return

    async def connect(self) -> None:
        loop = asyncio.get_running_loop()
        until = loop.time() + CONNECT_WAIT
        while True:
            if self.proc.returncode is not None:
                raise OSError(self.tail.decode("utf-8", "replace").strip() or "js-debug stopped before it listened")
            try:
                reader, writer = await asyncio.open_connection(JS_DEBUG_HOST, self.port, limit=HEADER_MAX)
                break
            except OSError:
                if loop.time() > until:
                    raise OSError("js-debug did not start listening") from None
                await asyncio.sleep(0.1)
        self.root = Link(reader, writer)
        self.root.task = asyncio.create_task(self._pump(self.root))

    def _target(self) -> Link | None:
        if self.focus is not None:
            return self.focus
        return self.children[0] if self.children else self.root

    async def _forward(self, link: Link, message: dict, answer: bool = True) -> None:
        link.seq += 1
        if answer:
            link.routes[link.seq] = message.get("seq", 0)
        await link.send({**message, "seq": link.seq})

    async def send(self, message: dict) -> None:
        root = self.root
        if root is None:
            return
        command = message.get("command")
        arguments = message.get("arguments")
        if command == "initialize":
            arguments = {**(arguments if isinstance(arguments, dict) else {}), "supportsStartDebuggingRequest": True}
            self.init_args = arguments
            message = {**message, "arguments": arguments}
        if command in ROOT_ONLY:
            await self._forward(root, message)
            return
        if command in BROADCAST:
            if command == "setBreakpoints":
                source = arguments.get("source") if isinstance(arguments, dict) else None
                path = source.get("path") if isinstance(source, dict) else None
                if isinstance(path, str):
                    self.breakpoints[path] = arguments
            else:
                self.broadcasts[command] = arguments
            first = self._target() or root
            for link in (root, *self.children):
                await self._forward(link, message, link is first)
            return
        link = self._target() or root
        if command in RESUMES:
            link.stopped = None
        await self._forward(link, message)
        if command == "continue":
            await self._refocus(link)

    async def _refocus(self, left: Link) -> None:
        if self.focus is not left and self.focus is not None:
            return
        other = next((child for child in self.children if child is not left and child.stopped is not None), None)
        if other is None:
            if left not in self.children:
                self.focus = None
            return
        self.focus = other
        await self.out.put(other.stopped)

    async def receive(self) -> dict | None:
        return await self.out.get()

    async def _pump(self, link: Link) -> None:
        try:
            while True:
                message = await read_message(link.reader)
                if message is None:
                    break
                kind = message.get("type")
                if kind == "response":
                    seq = message.get("request_seq")
                    answer = link.waiting.pop(seq, None)
                    if answer is not None:
                        if not answer.done():
                            answer.set_result(message)
                        continue
                    wanted = link.routes.pop(seq, None)
                    if wanted is not None:
                        await self.out.put({**message, "request_seq": wanted})
                elif kind == "request":
                    if message.get("command") == "startDebugging":
                        job = asyncio.create_task(self._start_child(link, message))
                        self.jobs.add(job)
                        job.add_done_callback(self.jobs.discard)
                    else:
                        await self._reply(link, message, False, "this request is not supported")
                elif kind == "event":
                    await self._event(link, message)
        except (HeaderTooLong, OSError, asyncio.IncompleteReadError):
            pass
        finally:
            link.close()
            if link is self.root:
                await self.out.put(None)
            elif link in self.children:
                self.children.remove(link)
                await self._refocus(link)

    async def _event(self, link: Link, message: dict) -> None:
        event = message.get("event")
        if link is not self.root:
            if event == "initialized":
                link.ready.set()
                return
            if event == "terminated":
                return
            if event == "stopped":
                link.stopped = message
                self.focus = link
            elif event == "continued":
                link.stopped = None
        await self.out.put(message)

    async def _reply(self, link: Link, request: dict, success: bool, text: str = "") -> None:
        link.seq += 1
        reply = {"seq": link.seq, "type": "response", "request_seq": request.get("seq", 0), "success": success, "command": request.get("command", "")}
        if text:
            reply["message"] = text
        with contextlib.suppress(OSError):
            await link.send(reply)

    async def _start_child(self, parent: Link, request: dict) -> None:
        arguments = request.get("arguments")
        arguments = arguments if isinstance(arguments, dict) else {}
        configuration = arguments.get("configuration")
        child: Link | None = None
        try:
            if not isinstance(configuration, dict):
                raise RuntimeError("the child session has no configuration")
            reader, writer = await asyncio.open_connection(JS_DEBUG_HOST, self.port, limit=HEADER_MAX)
            child = Link(reader, writer)
            self.children.append(child)
            child.task = asyncio.create_task(self._pump(child))
            await child.call("initialize", self.init_args)
            starting = asyncio.create_task(child.call("attach" if arguments.get("request") == "attach" else "launch", configuration))
            try:
                await asyncio.wait_for(child.ready.wait(), CHILD_WAIT)
                for held in list(self.breakpoints.values()):
                    await child.call("setBreakpoints", held)
                for command, held in list(self.broadcasts.items()):
                    await child.call(command, held)
                await child.call("configurationDone", {})
                await starting
            finally:
                if not starting.done():
                    starting.cancel()
        except (RuntimeError, OSError, asyncio.TimeoutError) as err:
            if child is not None:
                child.close()
            text = str(err) or "timed out"
            await self.out.put({"type": "event", "seq": 0, "event": "output", "body": {"category": "stderr", "output": f"A child debug session could not start: {text}\n"}})
            await self._reply(parent, request, False, text)
            return
        await self._reply(parent, request, True)

    async def stop(self) -> None:
        for job in list(self.jobs):
            job.cancel()
        await super().stop()
        for link in (self.root, *self.children):
            if link is None:
                continue
            link.close()
            if link.task is not None:
                link.task.cancel()
        self.quiet.cancel()
        for task in [self.quiet, *self.jobs, *[link.task for link in (self.root, *self.children) if link is not None and link.task is not None]]:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe_socket:
        probe_socket.bind((JS_DEBUG_HOST, 0))
        return int(probe_socket.getsockname()[1])


async def spawn_node(node: str, server: str, root: str) -> NodeAdapter:
    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    port = free_port()
    proc = await asyncio.create_subprocess_exec(
        node, server, str(port), JS_DEBUG_HOST,
        cwd=root, env=minimal_env(),
        stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        **kwargs,
    )
    adapter = NodeAdapter(proc, port)
    try:
        await adapter.connect()
    except OSError:
        await adapter.stop()
        raise
    return adapter


class Slot:
    def __init__(self) -> None:
        self.adapter: Adapter | None = None
        self.busy = False


slot = Slot()


async def shutdown() -> None:
    current = slot.adapter
    slot.adapter = None
    if current is not None:
        await current.stop()
