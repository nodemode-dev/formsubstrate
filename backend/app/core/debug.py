import asyncio
import contextlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile

from app.core import workspace_root as ws

PROBE = "import debugpy;print(debugpy.__version__)"
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


def describe(root: str | None, found: dict | None = None) -> dict:
    found = found if found is not None else resolve_python(root)
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


def launch_arguments(raw: object, root: str, python: str) -> dict:
    if not isinstance(raw, dict):
        raise ws.Refused(400, "launch needs arguments")
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
        "name": "formsubstrate",
        "type": "python",
        "request": "launch",
        "program": program,
        "args": args,
        "cwd": cwd,
        "python": [python],
        "console": "internalConsole",
        "redirectOutput": True,
        "justMyCode": raw.get("justMyCode") is not False,
        "stopOnEntry": raw.get("stopOnEntry") is True,
        "env": {"PYTHONUNBUFFERED": "1"},
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
