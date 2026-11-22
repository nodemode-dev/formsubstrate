import asyncio
import contextlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator

from app.core.binres import find_bin

FRAME_CAP = 64_000_000
STOP_WAIT = 2.0
VERSION_WAIT = 6
LOCAL_BIN_DIRS = ("node_modules/.bin", "frontend/node_modules/.bin", ".venv/bin", "venv/bin", ".venv/Scripts", "venv/Scripts")
LOCAL_TS_DIRS = ("node_modules/typescript", "frontend/node_modules/typescript")
WIN_SUFFIXES = ("", ".cmd", ".exe", ".bat")
MAX_PER_LANG = 2
MAX_TOTAL = 6
ENV_KEEP = (
    "PATH", "HOME", "USER", "LOGNAME", "LANG", "LANGUAGE", "TZ", "TMPDIR", "TEMP", "TMP",
    "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR",
    "SYSTEMROOT", "SystemDrive", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "ProgramFiles", "ProgramFiles(x86)",
    "FORMSUBSTRATE_BIN_DIR",
)


def minimal_env() -> dict[str, str]:
    env = {key: os.environ[key] for key in ENV_KEEP if key in os.environ}
    for key, value in os.environ.items():
        if key.startswith("LC_"):
            env[key] = value
    return env

LANGS: dict[str, dict] = {
    "typescript": {
        "label": "TypeScript and JavaScript",
        "exts": [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
        "install": [
            "npm install --save-dev typescript@7   (TypeScript 7 serves itself: tsc --lsp --stdio)",
            "npm install --global typescript-language-server typescript@6   (TypeScript 6 and older only)",
        ],
        "candidates": [
            {"name": "tsgo", "exe": "tsgo", "args": ["--lsp", "--stdio"], "kind": "native"},
            {"name": "tsc", "exe": "tsc", "args": ["--lsp", "--stdio"], "kind": "native", "min_major": 7},
            {"name": "typescript-language-server", "exe": "typescript-language-server", "args": ["--stdio"], "kind": "tsserver"},
        ],
    },
    "python": {
        "label": "Python",
        "exts": [".py", ".pyi"],
        "install": [
            "npm install --global pyright",
            "pip install pyright",
            "pip install python-lsp-server",
        ],
        "candidates": [
            {"name": "pyright-langserver", "exe": "pyright-langserver", "args": ["--stdio"], "kind": "pyright"},
            {"name": "basedpyright-langserver", "exe": "basedpyright-langserver", "args": ["--stdio"], "kind": "pyright"},
            {"name": "pylsp", "exe": "pylsp", "args": [], "kind": "pylsp"},
        ],
    },
}

_versions: dict[str, str | None] = {}
_live: set["LspProc"] = set()
_starting: list[str] = []


@dataclass
class Resolved:
    name: str
    path: str
    argv: list[str]
    kind: str
    version: str | None = None


@dataclass
class Report:
    lang: str
    label: str
    exts: list[str]
    install: list[str]
    active: Resolved | None
    candidates: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _local(root: str | None, exe: str) -> str | None:
    if not root:
        return None
    for folder in LOCAL_BIN_DIRS:
        base = Path(root) / folder
        for suffix in WIN_SUFFIXES:
            candidate = base / f"{exe}{suffix}"
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
    return None


def locate(root: str | None, exe: str, trust: bool = False) -> str | None:
    system = find_bin(exe)
    if not trust:
        return system
    return _local(root, exe) or system


def _version_of(path: str) -> str | None:
    if path in _versions:
        return _versions[path]
    found: str | None = None
    try:
        out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=VERSION_WAIT, check=False, stdin=subprocess.DEVNULL, env=minimal_env(), cwd=tempfile.gettempdir())
        for token in (out.stdout + " " + out.stderr).replace("\n", " ").split():
            head = token.lstrip("v")
            if head[:1].isdigit() and "." in head:
                found = head
                break
    except (OSError, subprocess.SubprocessError):
        found = None
    _versions[path] = found
    return found


def _major(version: str | None) -> int | None:
    try:
        return int((version or "").split(".")[0])
    except ValueError:
        return None


def workspace_typescript(root: str | None) -> str | None:
    if not root:
        return None
    for folder in LOCAL_TS_DIRS:
        manifest = Path(root) / folder / "package.json"
        try:
            return json.loads(manifest.read_text(encoding="utf-8")).get("version")
        except (OSError, ValueError):
            continue
    return None


def report(lang: str, root: str | None, trust: bool = False) -> Report:
    spec = LANGS[lang]
    out = Report(lang=lang, label=spec["label"], exts=spec["exts"], install=spec["install"], active=None)
    ws = workspace_typescript(root) if lang == "typescript" else None
    ws_new = ws is not None and (_major(ws) or 0) >= 7
    for cand in spec["candidates"]:
        local = _local(root, cand["exe"])
        path = locate(root, cand["exe"], trust)
        shown = path or local
        item = {"name": cand["name"], "kind": cand["kind"], "found": shown is not None, "path": shown, "local": shown is not None and shown == local, "version": None, "usable": False, "note": ""}
        out.candidates.append(item)
        if path is None:
            if local:
                item["note"] = "found in this workspace; it is not run until the workspace is trusted"
                out.notes.append(f"{cand['name']} is installed in this workspace and was not run; trust the workspace to use it")
            continue
        need = cand.get("min_major")
        if need or cand["kind"] == "native":
            item["version"] = _version_of(path)
        if need and (_major(item["version"]) or 0) < need:
            item["note"] = f"version {item['version'] or 'unknown'} has no built-in language server (needs {need} or newer)"
            continue
        if cand["kind"] == "tsserver" and ws_new:
            item["note"] = f"needs a TypeScript 6 or older installation, and this workspace has {ws}, which has no tsserver.js"
            out.notes.append("typescript-language-server cannot serve TypeScript 7; install TypeScript 7 as a dev dependency to use its built-in server")
            continue
        item["usable"] = True
        if out.active is None:
            out.active = Resolved(cand["name"], path, [path, *cand["args"]], cand["kind"], item["version"])
    return out


def listing(root: str | None) -> list[Report]:
    return [report(lang, root) for lang in LANGS]


def encode_msg(msg: dict) -> bytes:
    body = json.dumps(msg, separators=(",", ":")).encode("utf-8")
    return f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body


async def read_msg(reader: asyncio.StreamReader) -> dict | None:
    length = 0
    while True:
        line = await reader.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            break
        if line.lower().startswith(b"content-length:"):
            try:
                length = int(line.split(b":", 1)[1].strip())
            except ValueError:
                return None
    if length <= 0 or length > FRAME_CAP:
        return None
    try:
        body = await reader.readexactly(length)
    except asyncio.IncompleteReadError:
        return None
    try:
        msg = json.loads(body)
    except ValueError:
        return None
    return msg if isinstance(msg, dict) else None


@dataclass(eq=False)
class LspProc:
    lang: str
    resolved: Resolved
    proc: asyncio.subprocess.Process

    async def send(self, msg: dict) -> None:
        stdin = self.proc.stdin
        if stdin is None or stdin.is_closing():
            return
        stdin.write(encode_msg(msg))
        with contextlib.suppress(ConnectionError):
            await stdin.drain()

    async def messages(self) -> AsyncIterator[dict]:
        stdout = self.proc.stdout
        if stdout is None:
            return
        while True:
            msg = await read_msg(stdout)
            if msg is None:
                return
            yield msg

    def alive(self) -> bool:
        return self.proc.returncode is None

    def _signal(self, sig: int, hard: bool = False) -> None:
        if sys.platform == "win32":
            with contextlib.suppress(ProcessLookupError, OSError):
                if hard:
                    self.proc.kill()
                else:
                    self.proc.terminate()
            return
        with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
            os.killpg(self.proc.pid, sig)

    async def stop(self) -> None:
        _live.discard(self)
        if not self.alive():
            return
        self._signal(signal.SIGTERM)
        try:
            await asyncio.wait_for(self.proc.wait(), timeout=STOP_WAIT)
        except asyncio.TimeoutError:
            self._signal(getattr(signal, "SIGKILL", signal.SIGTERM), True)
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self.proc.wait(), timeout=STOP_WAIT)


class Unavailable(Exception):
    def __init__(self, message: str, install: list[str]) -> None:
        super().__init__(message)
        self.install = install


class Busy(Exception):
    pass


def _count(lang: str | None = None) -> int:
    live = [h.lang for h in _live if h.alive()]
    every = live + _starting
    return len(every) if lang is None else sum(1 for item in every if item == lang)


async def spawn(lang: str, root: str, trust: bool = False) -> LspProc:
    if lang not in LANGS:
        raise Unavailable(f"unknown language: {lang}", [])
    if _count() >= MAX_TOTAL:
        raise Busy(f"too many language servers are running (limit {MAX_TOTAL})")
    if _count(lang) >= MAX_PER_LANG:
        raise Busy(f"too many {lang} language servers are running (limit {MAX_PER_LANG})")
    _starting.append(lang)
    try:
        rep = await asyncio.to_thread(report, lang, root, trust)
        if rep.active is None:
            raise Unavailable(f"no language server for {rep.label} was found", rep.install)
        argv = rep.active.argv
        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=root,
            env=minimal_env(),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=sys.platform != "win32",
        )
        handle = LspProc(lang=lang, resolved=rep.active, proc=proc)
        _live.add(handle)
        return handle
    finally:
        _starting.remove(lang)


def live_count() -> int:
    return len(_live)


async def shutdown() -> None:
    for handle in list(_live):
        await handle.stop()
