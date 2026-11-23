import asyncio
import base64
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path

from app.core import binres, debug_launch, lsp, trust
from app.core import workspace_root as ws

OWN = ".formsubstrate/tasks.json"
VSCODE = ".vscode/tasks.json"
PACKAGE = "package.json"
FILE_MAX = 262144
TASKS_MAX = 64
SCRIPTS_MAX = 64
LABEL_MAX = 120
COMMAND_MAX = 4096
ARGS_MAX = 256
ARG_LEN_MAX = 4096
ENV_MAX = 128
ENV_VALUE_MAX = 8192
MATCHERS_MAX = 4
PATTERNS_MAX = 3
REGEXP_MAX = 1000
LINE_MAX = 2000
PROBLEMS_MAX = 1000
FRAMES_MAX = 200
RUNS_MAX = 32
TAIL_ROWS = 2000
POLL_SECONDS = 0.4
STOP_GRACE = 2.0
ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
SCRIPT_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.:@/-]{0,99}$")
VARIABLE = re.compile(r"\$\{([^}]*)\}")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
BATCH_UNSAFE = re.compile(r'["&|<>^%!\r\n]')
SEVERITIES = {"error": 1, "warning": 2, "warn": 2, "info": 3, "information": 3, "note": 3, "hint": 3}
GROUPS = ("build", "test")
TYPES = ("shell", "process")
IGNORED = ("dependsOn", "dependsOrder", "isBackground", "runOptions", "windows", "osx", "linux")
UNTRUSTED = "the workspace is not trusted, so its tasks are not read or run"
STARTER = {
    "version": "2.0.0",
    "tasks": [
        {
            "label": "build",
            "type": "shell",
            "command": "npm run build",
            "group": {"kind": "build", "isDefault": True},
            "problemMatcher": "$tsc",
        }
    ],
}
BUILTIN: dict[str, dict] = {
    "$tsc": {
        "patterns": [
            {
                "regexp": r"^(.*?)[(:](\d+)[,:](\d+)\)?(?::\s+|\s+-\s+)(error|warning|info)\s+(TS\d+)\s*:\s*(.*)$",
                "file": 1, "line": 2, "column": 3, "severity": 4, "code": 5, "message": 6,
            }
        ],
    },
    "$eslint-stylish": {
        "patterns": [
            {"regexp": r"^([^\s].*)$", "file": 1},
            {"regexp": r"^\s+(\d+):(\d+)\s+(error|warning|info)\s+(.*?)(?:\s\s+(\S+))?$", "line": 1, "column": 2, "severity": 3, "message": 4, "code": 5, "loop": True},
        ],
    },
    "$python": {"python": True},
}
PY_FRAME = re.compile(r'^\s*File "(.+?)", line (\d+)')
PY_FINAL = re.compile(r"^[A-Za-z_][\w.]*(?:Error|Exception|Warning|Interrupt|Exit)[\w.]*(?::.*)?$")


class Bad(Exception):
    pass


def _root() -> str | None:
    try:
        return ws.real_root()
    except ws.Refused:
        return None


def locate() -> tuple[str, str] | None:
    for rel in (OWN, VSCODE):
        try:
            real, _ = ws.resolve(rel)
        except ws.Refused:
            continue
        if os.path.isfile(real):
            return rel, real
    return None


def _read_json(real: str, name: str) -> object:
    try:
        if os.path.getsize(real) > FILE_MAX:
            raise ws.Refused(413, f"{name} is too large")
        with open(real, "r", encoding="utf-8-sig") as handle:
            text = handle.read(FILE_MAX + 1)
    except (OSError, UnicodeDecodeError) as err:
        raise ws.Refused(400, f"{name} could not be read: {err}") from err
    try:
        return json.loads(debug_launch.strip_trailing_commas(debug_launch.strip_comments(text)))
    except ValueError as err:
        raise ws.Refused(400, f"{name} is not valid JSON: {err}") from err
    except ws.Refused as err:
        raise ws.Refused(400, f"a comment in {name} is not closed") from err


def _text(value: object, name: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise Bad(f"{name} must be text")
    if len(value) > limit:
        raise Bad(f"{name} is longer than {limit} characters")
    if "\0" in value:
        raise Bad(f"{name} holds a NUL character")
    return value


def _variables(value: str, name: str) -> None:
    for found in VARIABLE.findall(value):
        if found not in ("workspaceFolder", "workspaceFolderBasename"):
            raise Bad(f"{name} uses ${{{found}}}, which is not supported; only ${{workspaceFolder}} and ${{workspaceFolderBasename}} are")


def _expand(value: str, root: str) -> str:
    return value.replace("${workspaceFolderBasename}", os.path.basename(root)).replace("${workspaceFolder}", root)


def _index(raw: dict, key: str, groups: int, default: int | None) -> int | None:
    value = raw.get(key)
    if value is None:
        return default if default is not None and default <= groups else None
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise Bad(f"the problem matcher's {key} must be a group number")
    if value > groups:
        raise Bad(f"the problem matcher's {key} is group {value}, but the pattern has {groups}")
    return value


def _pattern(raw: object, first: bool, last: bool) -> dict:
    if not isinstance(raw, dict):
        raise Bad("a problem matcher pattern must be an object with a regexp")
    source = raw.get("regexp")
    if not isinstance(source, str) or not source:
        raise Bad("a problem matcher pattern needs a regexp")
    if len(source) > REGEXP_MAX:
        raise Bad(f"a problem matcher regexp is longer than {REGEXP_MAX} characters")
    try:
        groups = re.compile(source).groups
    except (re.error, RecursionError, OverflowError) as err:
        raise Bad(f"the problem matcher regexp is not one Python's re accepts: {err}") from err
    return {
        "regexp": source,
        "file": _index(raw, "file", groups, 1 if first else None),
        "line": _index(raw, "line", groups, 2 if first and last else None),
        "column": _index(raw, "column", groups, None),
        "severity": _index(raw, "severity", groups, None),
        "code": _index(raw, "code", groups, None),
        "message": _index(raw, "message", groups, None),
        "loop": raw.get("loop") is True and last,
    }


def _matchers(raw: object) -> list[dict]:
    if raw is None:
        return []
    items = raw if isinstance(raw, list) else [raw]
    if len(items) > MATCHERS_MAX:
        raise Bad(f"a task takes at most {MATCHERS_MAX} problem matchers")
    out: list[dict] = []
    for item in items:
        if isinstance(item, str):
            if item not in BUILTIN:
                raise Bad(f"the problem matcher {item[:40]} is not known; use {', '.join(BUILTIN)} or a custom pattern")
            out.append({"name": item, **BUILTIN[item]})
            continue
        if not isinstance(item, dict):
            raise Bad("a problem matcher is a name or an object with a pattern")
        base = item.get("base")
        if base is not None and "pattern" not in item:
            if base not in BUILTIN:
                raise Bad("the problem matcher's base is not known")
            out.append({"name": base, **BUILTIN[base]})
            continue
        found = item.get("pattern")
        rows = found if isinstance(found, list) else [found]
        if not rows or len(rows) > PATTERNS_MAX:
            raise Bad(f"a problem matcher takes 1 to {PATTERNS_MAX} patterns")
        severity = item.get("severity")
        if severity is not None and severity not in SEVERITIES:
            raise Bad("the problem matcher's severity must be error, warning or info")
        patterns = [_pattern(row, at == 0, at == len(rows) - 1) for at, row in enumerate(rows)]
        if all(p["file"] is None for p in patterns):
            raise Bad("the problem matcher needs a file group")
        out.append({"name": "custom", "patterns": patterns, "severity": SEVERITIES.get(severity or "error", 1)})
    return out


def _group(raw: object) -> tuple[str | None, bool]:
    if raw is None:
        return None, False
    if isinstance(raw, str):
        return (raw, False) if raw in GROUPS else (None, False)
    if isinstance(raw, dict):
        kind = raw.get("kind")
        return (kind, raw.get("isDefault") is True) if kind in GROUPS else (None, False)
    raise Bad("the group must be build, test or an object with kind")


def clean(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise Bad("a task must be an object")
    label = _text(raw.get("label"), "the label", LABEL_MAX).strip()
    if CONTROL.search(label):
        raise Bad("the label holds a control character")
    kind = raw.get("type", "shell")
    if kind not in TYPES:
        raise Bad(f"the type {str(kind)[:40]} is not supported; use shell or process")
    command = raw.get("command")
    if isinstance(command, dict):
        raise Bad("a command with quoting rules is not supported; write the command as text")
    command = _text(command, "the command", COMMAND_MAX)
    _variables(command, "the command")
    args = raw.get("args", [])
    if not isinstance(args, list) or len(args) > ARGS_MAX:
        raise Bad(f"args must be a list of at most {ARGS_MAX} text values")
    for arg in args:
        if not isinstance(arg, str) or len(arg) > ARG_LEN_MAX or "\0" in arg:
            raise Bad("every argument must be text; arguments with quoting rules are not supported")
        _variables(arg, "an argument")
    options = raw.get("options", {})
    if not isinstance(options, dict):
        raise Bad("options must be an object")
    cwd = options.get("cwd")
    if cwd is not None:
        cwd = _text(cwd, "options.cwd", COMMAND_MAX)
        _variables(cwd, "options.cwd")
    env = options.get("env", {})
    if not isinstance(env, dict) or len(env) > ENV_MAX:
        raise Bad(f"options.env must be an object of at most {ENV_MAX} names")
    for key, value in env.items():
        if not ENV_NAME.match(key) or not isinstance(value, str) or len(value) > ENV_VALUE_MAX or "\0" in value:
            raise Bad(f"options.env has a name or value that is not usable: {key[:60]}")
        _variables(value, f"options.env.{key}")
    group, default = _group(raw.get("group"))
    return {
        "label": label,
        "type": kind,
        "command": command,
        "args": list(args),
        "cwd": cwd,
        "env": dict(env),
        "group": group,
        "isDefault": default,
        "matchers": _matchers(raw.get("problemMatcher")),
        "origin": "file",
        "notes": [f"{key} is not supported and is ignored" for key in IGNORED if key in raw],
    }


def _file_tasks(real: str, name: str) -> list[dict]:
    data = _read_json(real, name)
    if not isinstance(data, dict):
        raise ws.Refused(400, f"{name} must be a JSON object")
    rows = data.get("tasks")
    if not isinstance(rows, list):
        raise ws.Refused(400, f"{name} needs a tasks list")
    if len(rows) > TASKS_MAX:
        raise ws.Refused(400, f"{name} has more than {TASKS_MAX} tasks")
    out: list[dict] = []
    seen: set[str] = set()
    for at, row in enumerate(rows):
        shown = row.get("label") if isinstance(row, dict) and isinstance(row.get("label"), str) else ""
        shown = CONTROL.sub(" ", shown).strip()[:LABEL_MAX] or f"task {at + 1}"
        try:
            task = clean(row)
            if task["label"] in seen:
                raise Bad("another task has the same label")
        except Bad as err:
            if shown not in seen:
                seen.add(shown)
                out.append({"label": shown, "origin": "file", "error": str(err)})
            continue
        seen.add(task["label"])
        out.append(task)
    return out


def _script_matchers(text: str) -> list[dict]:
    out = []
    if re.search(r"\btsc\b", text):
        out.append({"name": "$tsc", **BUILTIN["$tsc"]})
    if re.search(r"\beslint\b", text):
        out.append({"name": "$eslint-stylish", **BUILTIN["$eslint-stylish"]})
    return out


def _npm_tasks(root: str, taken: set[str]) -> list[dict]:
    real = os.path.join(root, PACKAGE)
    if not os.path.isfile(real) or os.path.islink(real):
        return []
    try:
        data = _read_json(real, PACKAGE)
    except ws.Refused:
        return []
    scripts = data.get("scripts") if isinstance(data, dict) else None
    if not isinstance(scripts, dict):
        return []
    out: list[dict] = []
    for name, text in list(scripts.items())[:SCRIPTS_MAX]:
        label = f"npm: {name}"
        if not isinstance(text, str) or not SCRIPT_NAME.match(name) or label in taken:
            continue
        group = "build" if name in ("build", "compile", "watch") else "test" if name == "test" else None
        out.append({
            "label": label, "type": "process", "command": "npm", "args": ["run", name], "cwd": None, "env": {},
            "group": group, "isDefault": False, "matchers": _script_matchers(text), "origin": "npm", "notes": [], "script": text[:COMMAND_MAX],
        })
    return out


def _all(root: str) -> tuple[str | None, str | None, list[dict]]:
    found = locate()
    tasks: list[dict] = []
    error = None
    if found is not None:
        try:
            tasks = _file_tasks(found[1], found[0])
        except ws.Refused as err:
            error = err.detail
    tasks += _npm_tasks(root, {task["label"] for task in tasks})
    return (found[0] if found else None), error, tasks


def _public(task: dict) -> dict:
    if "error" in task:
        return {"label": task["label"], "origin": task["origin"], "error": task["error"], "detail": "", "type": None, "group": None, "isDefault": False, "matchers": [], "notes": []}
    shown = task.get("script") or " ".join([task["command"], *task["args"]])
    return {
        "label": task["label"], "origin": task["origin"], "error": None, "detail": CONTROL.sub(" ", shown)[:400], "type": task["type"],
        "group": task["group"], "isDefault": task["isDefault"], "matchers": [m["name"] for m in task["matchers"]], "notes": task["notes"],
    }


def listing() -> dict:
    root = _root()
    if root is None:
        return {"root": None, "trusted": False, "file": None, "error": None, "tasks": []}
    if not trust.is_trusted(root):
        return {"root": root, "trusted": False, "file": None, "error": UNTRUSTED, "tasks": []}
    name, error, tasks = _all(root)
    return {"root": root, "trusted": True, "file": name, "error": error, "tasks": [_public(task) for task in tasks]}


def create_file() -> dict:
    ws.real_root()
    found = locate()
    if found is not None:
        return {"path": found[0], "created": False}
    real, rel = ws.resolve(OWN, write=True)
    if os.path.lexists(real):
        raise ws.Refused(409, "the task file exists but is not a regular file inside the workspace")
    try:
        os.makedirs(os.path.dirname(real), exist_ok=True)
        with open(real, "x", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(STARTER, indent=2) + "\n")
    except OSError as err:
        raise ws.Refused(409, f"the task file could not be written: {err}") from err
    return {"path": rel, "created": True}


def _cwd(task: dict, root: str) -> str:
    written = task["cwd"]
    if not written:
        return root
    expanded = _expand(written, root)
    flat = expanded.replace("\\", "/")
    if os.path.isabs(expanded) or flat.startswith("/") or (len(flat) > 1 and flat[1] == ":"):
        real = os.path.realpath(expanded)
        if not ws._inside(real, root):
            raise ws.Refused(403, "the task's folder must be inside the open workspace")
    else:
        real, _ = ws.resolve(expanded)
    if not os.path.isdir(real):
        raise ws.Refused(404, "the task's folder does not exist")
    return real


def _program(command: str, cwd: str, root: str, env: dict[str, str]) -> str:
    flat = command.replace("\\", "/")
    if os.path.isabs(command):
        found = command if os.path.isfile(command) else None
    elif "/" in flat:
        real = os.path.realpath(os.path.join(cwd, command))
        found = real if ws._inside(real, root) and os.path.isfile(real) else None
    else:
        found = shutil.which(command, path=env.get("PATH") or binres.wide_path())
    if not found:
        raise ws.Refused(404, f"the program {command[:120]} was not found")
    return os.path.abspath(found)


def plan(task: dict, root: str) -> tuple[list[str], str, dict[str, str]]:
    from app.routers import terminal

    cwd = _cwd(task, root)
    env = {key: _expand(value, root) for key, value in task["env"].items()}
    command = _expand(task["command"], root)
    args = [_expand(arg, root) for arg in task["args"]]
    windows = sys.platform == "win32"
    if task["type"] == "shell":
        line = command if not args else (subprocess.list2cmdline([command, *args]) if windows else " ".join([command, *(shlex.quote(arg) for arg in args)]))
        if windows:
            return [os.environ.get("COMSPEC") or "cmd.exe", "/d", "/s", "/c", line], cwd, env
        return [*terminal.shell_argv(), "-c", line], cwd, env
    program = _program(command, cwd, root, env)
    if windows and program.lower().endswith((".bat", ".cmd")):
        if any(BATCH_UNSAFE.search(part) for part in [program, *args]):
            raise ws.Refused(400, "a batch program cannot take arguments holding quotes, percent signs or the characters & | < > ^ !")
        return [os.environ.get("COMSPEC") or "cmd.exe", "/d", "/c", program, *args], cwd, env
    if not windows and not os.access(program, os.X_OK):
        raise ws.Refused(400, "that program is not executable")
    return [program, *args], cwd, env


class Matcher:
    def __init__(self, spec: dict) -> None:
        self.python = bool(spec.get("python"))
        self.severity = spec.get("severity", 1)
        self.patterns = [{**p, "re": re.compile(p["regexp"])} for p in spec.get("patterns", [])]
        self.at = 0
        self.held: dict = {}
        self.frames: list[tuple[str, int, int]] = []

    def _trace(self, line: str) -> list[dict]:
        frame = PY_FRAME.match(line)
        if frame:
            self.frames.append((frame.group(1), int(frame.group(2)), 1))
            del self.frames[:-FRAMES_MAX]
            return []
        if not self.frames:
            return []
        if PY_FINAL.match(line):
            where, self.frames = list(reversed(self.frames)), []
            return [{"where": where, "severity": 1, "message": line.strip(), "code": None}]
        if line and not line[0].isspace() and not line.startswith("Traceback"):
            self.frames = []
        return []

    def _take(self, pattern: dict, match: re.Match) -> None:
        for key in ("file", "line", "column", "severity", "code", "message"):
            index = pattern.get(key)
            if index is not None and match.group(index) is not None:
                self.held[key] = match.group(index)

    def _emit(self, line: str) -> dict | None:
        held = self.held
        file = held.get("file")
        if not file:
            return None
        try:
            row = max(1, int(held.get("line") or 1))
            column = max(1, int(held.get("column") or 1))
        except ValueError:
            return None
        severity = SEVERITIES.get(str(held.get("severity") or "").lower(), self.severity)
        return {"where": [(file, row, column)], "severity": severity, "message": (held.get("message") or line).strip(), "code": held.get("code")}

    def feed(self, line: str) -> list[dict]:
        if self.python:
            return self._trace(line)
        if not self.patterns:
            return []
        last = len(self.patterns) - 1
        for _ in range(2):
            pattern = self.patterns[self.at]
            match = pattern["re"].match(line)
            if match is None:
                if self.at == 0:
                    return []
                self.at = 0
                self.held = {}
                continue
            self._take(pattern, match)
            if self.at < last:
                self.at += 1
                return []
            found = self._emit(line)
            if not pattern.get("loop"):
                self.at = 0
                self.held = {}
            return [found] if found else []
        return []


class Owner:
    def __init__(self, label: str) -> None:
        self.label = label


class Run:
    def __init__(self, root: str, task: dict, cwd: str) -> None:
        self.root = root
        self.label = task["label"]
        self.cwd = cwd
        self.matchers = [Matcher(spec) for spec in task["matchers"]]
        self.owner = Owner(self.label)
        self.terminal = ""
        self.started = time.time()
        self.ended: float | None = None
        self.exit_code: int | None = None
        self.stopped = False
        self.problems: list[dict] = []
        self.seen: set[tuple] = set()
        self.done = asyncio.Event()
        self.watcher: asyncio.Task | None = None

    @property
    def slot(self) -> str:
        return f"task:{self.label}"


_runs: dict[tuple[str, str], Run] = {}
_start_lock: asyncio.Lock | None = None
_seq = 0


def _bump() -> None:
    global _seq
    _seq += 1


def _key(root: str, label: str) -> tuple[str, str]:
    return os.path.normcase(root), label


def _place(file: str, cwd: str, root: str) -> tuple[str, str] | None:
    file = file.strip().strip('"')
    if not file or "\0" in file or len(file) > 4096:
        return None
    candidates = [file] if os.path.isabs(file) else [os.path.join(cwd, file), os.path.join(root, file)]
    for candidate in candidates:
        real = os.path.realpath(candidate)
        if real != root and ws._inside(real, root) and os.path.isfile(real):
            return real, os.path.relpath(real, root).replace(os.sep, "/")
    return None


def _digest(run: Run, lines: list[str]) -> bool:
    touched: set[str] = set()
    for line in lines:
        if len(run.problems) >= PROBLEMS_MAX:
            break
        line = line[:LINE_MAX]
        for matcher in run.matchers:
            for found in matcher.feed(line):
                placed = None
                for file, row, column in found["where"]:
                    spot = _place(file, run.cwd, run.root)
                    if spot is not None:
                        placed = (*spot, row, column)
                        break
                if placed is None:
                    continue
                real, rel, row, column = placed
                mark = (rel, row, column, found["message"])
                if mark in run.seen or len(run.problems) >= PROBLEMS_MAX:
                    continue
                run.seen.add(mark)
                code = found["code"]
                run.problems.append({
                    "path": rel, "real": real, "line": row, "col": column, "severity": found["severity"],
                    "message": found["message"][:lsp.PROBLEM_TEXT], "code": str(code)[:lsp.PROBLEM_FIELD] if code else None, "source": run.label,
                })
                touched.add(real)
    for real in touched:
        rows = [
            {"range": {"start": {"line": p["line"] - 1, "character": p["col"] - 1}}, "severity": p["severity"], "message": p["message"], "source": p["source"], "code": p["code"]}
            for p in run.problems if p["real"] == real
        ]
        lsp.record_diagnostics(run.root, {"uri": Path(real).as_uri(), "diagnostics": rows}, run.owner, run.slot)
    return bool(touched)


def _unwrap(rows: list[str], cols: int) -> list[str]:
    out: list[str] = []
    held = ""
    for row in rows:
        held += row
        if cols > 0 and len(row) >= cols:
            continue
        out.append(held)
        held = ""
    if held:
        out.append(held)
    return out


async def _watch(run: Run) -> None:
    from app.services import ptyhost_client
    from app.services.ptyhost_client import PtyHostError

    client = ptyhost_client.get_client()
    since = 0
    pending: str | None = None
    try:
        while True:
            await asyncio.sleep(POLL_SECONDS)
            try:
                found = next((item for item in await client.list(start=False) if item["id"] == run.terminal), None)
                if found is None:
                    break
                alive = bool(found.get("alive"))
                if alive and int(found.get("bytes") or 0) <= since:
                    continue
                reply = await client.tail(run.terminal, TAIL_ROWS, since)
            except PtyHostError:
                break
            since = int(reply.get("next") or since)
            alive = bool(reply.get("alive"))
            text = reply.get("text") or ""
            lines = _unwrap(text.split("\n"), int(found.get("cols") or 0)) if text else []
            if pending is not None:
                if lines and lines[0].startswith(pending):
                    pending = None
                elif lines or not alive:
                    lines.insert(0, pending)
                    pending = None
            if alive and lines:
                pending = lines.pop()
            if lines and run.matchers and await asyncio.to_thread(_digest, run, lines):
                _bump()
            if not alive:
                code = reply.get("exitCode")
                run.exit_code = code if isinstance(code, int) and not isinstance(code, bool) else None
                break
    except asyncio.CancelledError:
        raise
    except Exception:
        logging.getLogger("formsubstrate").warning("watching the task %s ended with an error", run.label, exc_info=True)
    finally:
        run.ended = time.time()
        run.done.set()
        _bump()


def _trim() -> None:
    finished = sorted((run.ended, key) for key, run in _runs.items() if run.ended is not None)
    for _, key in finished[: max(0, len(_runs) - RUNS_MAX)]:
        lsp.forget_diagnostics(_runs[key].owner)
        del _runs[key]


async def run(label: str, cols: int, rows: int) -> dict:
    from app.routers import terminal

    global _start_lock
    root = ws.real_root()
    if not trust.is_trusted(root):
        raise ws.Refused(403, UNTRUSTED)
    if _start_lock is None:
        _start_lock = asyncio.Lock()
    async with _start_lock:
        _, error, tasks = await asyncio.to_thread(_all, root)
        task = next((item for item in tasks if item["label"] == label), None)
        if task is None:
            raise ws.Refused(404, error or "no such task")
        if "error" in task:
            raise ws.Refused(400, f"the task {task['label']} is not usable: {task['error']}")
        key = _key(root, label)
        old = _runs.get(key)
        if old is not None and old.ended is None:
            raise ws.Refused(409, "that task is already running")
        argv, cwd, env = await asyncio.to_thread(plan, task, root)
        if old is not None:
            lsp.forget_diagnostics(old.owner)
            del _runs[key]
        fresh = Run(root, task, cwd)
        info = await terminal.launch("shell", cwd, label, None, cols, rows, argv=argv, env_extra=env)
        fresh.terminal = info["id"]
        _runs[key] = fresh
        _trim()
        fresh.watcher = asyncio.create_task(_watch(fresh))
        _bump()
        return {"label": label, "terminal": info}


async def stop(label: str | None) -> dict:
    from app.routers import terminal
    from app.services import ptyhost_client
    from app.services.ptyhost_client import PtyHostError

    root = _root()
    targets = [item for item in _runs.values() if item.ended is None and (root is None or os.path.normcase(item.root) == os.path.normcase(root)) and (label is None or item.label == label)]
    if not targets:
        raise ws.Refused(404, "no task is running")
    client = ptyhost_client.get_client()
    for item in targets:
        item.stopped = True
        try:
            await client.send({"op": "write", "id": item.terminal, "data": base64.b64encode(b"\x03").decode("ascii")})
        except PtyHostError:
            continue
    for item in targets:
        try:
            await asyncio.wait_for(item.done.wait(), STOP_GRACE)
            continue
        except asyncio.TimeoutError:
            pass
        try:
            await client.request({"op": "kill", "id": item.terminal}, ("killed",))
        except PtyHostError:
            pass
        terminal.hub.titles.pop(item.terminal, None)
        try:
            await asyncio.wait_for(item.done.wait(), STOP_GRACE)
        except asyncio.TimeoutError:
            pass
    _bump()
    return {"stopped": [item.label for item in targets]}


def state() -> dict:
    root = _root()
    mine = [item for item in _runs.values() if root is not None and os.path.normcase(item.root) == os.path.normcase(root)]
    mine.sort(key=lambda item: item.started)
    return {
        "root": root,
        "seq": _seq,
        "running": [{"label": item.label, "terminal": item.terminal, "started": item.started} for item in mine if item.ended is None],
        "finished": [{"label": item.label, "terminal": item.terminal, "exitCode": item.exit_code, "stopped": item.stopped, "ended": item.ended, "problems": len(item.problems)} for item in mine if item.ended is not None],
        "problems": [{key: value for key, value in problem.items() if key != "real"} for item in mine for problem in item.problems][:PROBLEMS_MAX],
    }


async def shutdown() -> None:
    for item in list(_runs.values()):
        task = item.watcher
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
    _runs.clear()
