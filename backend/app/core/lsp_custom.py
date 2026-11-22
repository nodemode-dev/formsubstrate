import json
import os
import re
import threading

from app.core import config

FILE_NAME = "lsp-servers.json"
FILE_VERSION = 1
SERVERS_MAX = 32
LABEL_MAX = 80
PROGRAM_MAX = 1024
ARGS_MAX = 32
ARG_MAX = 512
EXTS_MAX = 16
OPTIONS_MAX = 16_384
OPTIONS_DEPTH = 16
PREFIX = "custom:"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
EXT_RE = re.compile(r"^\.[a-z0-9][a-z0-9_+-]{0,15}$")
LANG_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$")
COMMAND_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._+-]{0,127}$")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
FIELDS = ("label", "program", "args", "exts", "languageId", "initializationOptions", "preset")

PRESETS: list[dict] = [
    {
        "preset": "rust-analyzer",
        "label": "Rust (rust-analyzer)",
        "program": "rust-analyzer",
        "args": [],
        "exts": [".rs"],
        "languageId": "rust",
        "initializationOptions": None,
        "install": ["rustup component add rust-analyzer", "brew install rust-analyzer"],
    },
    {
        "preset": "json",
        "label": "JSON",
        "program": "vscode-json-language-server",
        "args": ["--stdio"],
        "exts": [".json", ".jsonc"],
        "languageId": "json",
        "initializationOptions": {"provideFormatter": True},
        "install": ["npm i -g vscode-langservers-extracted"],
    },
    {
        "preset": "html",
        "label": "HTML",
        "program": "vscode-html-language-server",
        "args": ["--stdio"],
        "exts": [".html", ".htm"],
        "languageId": "html",
        "initializationOptions": {"provideFormatter": True},
        "install": ["npm i -g vscode-langservers-extracted"],
    },
    {
        "preset": "css",
        "label": "CSS, SCSS and Less",
        "program": "vscode-css-language-server",
        "args": ["--stdio"],
        "exts": [".css", ".scss", ".less"],
        "languageId": "css",
        "initializationOptions": {"provideFormatter": True},
        "install": ["npm i -g vscode-langservers-extracted"],
    },
    {
        "preset": "yaml",
        "label": "YAML",
        "program": "yaml-language-server",
        "args": ["--stdio"],
        "exts": [".yaml", ".yml"],
        "languageId": "yaml",
        "initializationOptions": None,
        "install": ["npm install -g yaml-language-server"],
    },
]

_PRESET_IDS = {p["preset"]: p for p in PRESETS}
_lock = threading.RLock()
_cache: dict = {"key": None, "servers": []}


class Refused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _file():
    return config.data_dir() / FILE_NAME


def _reserved() -> set[str]:
    from app.core.lsp import LANGS

    return {ext for spec in LANGS.values() for ext in spec["exts"]}


def install_of(entry: dict) -> list[str]:
    preset = _PRESET_IDS.get(entry.get("preset") or "")
    return list(preset["install"]) if preset else []


def _depth(value: object, level: int = 0) -> int:
    if level > OPTIONS_DEPTH:
        return level
    if isinstance(value, dict):
        return max([_depth(v, level + 1) for v in value.values()] or [level])
    if isinstance(value, list):
        return max([_depth(v, level + 1) for v in value] or [level])
    return level


def _text(value: object, name: str, limit: int) -> str:
    if not isinstance(value, str):
        raise Refused(400, f"{name} must be text")
    out = value.strip()
    if not out:
        raise Refused(400, f"{name} is empty")
    if len(out) > limit:
        raise Refused(400, f"{name} is longer than {limit} characters")
    if CONTROL.search(out):
        raise Refused(400, f"{name} has a control character")
    return out


def _program(value: object) -> str:
    program = _text(value, "the program", PROGRAM_MAX)
    if os.path.isabs(program) or program.startswith("/"):
        return program.replace("\\", "/")
    if not COMMAND_RE.match(program):
        raise Refused(400, "the program must be a command name such as rust-analyzer, without folders, or an absolute path")
    return program


def _args(value: object) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(a, str) for a in value):
        raise Refused(400, "the arguments must be a list of text values")
    if len(value) > ARGS_MAX:
        raise Refused(400, f"at most {ARGS_MAX} arguments")
    for arg in value:
        if len(arg) > ARG_MAX:
            raise Refused(400, f"an argument is longer than {ARG_MAX} characters")
        if "\x00" in arg or CONTROL.search(arg):
            raise Refused(400, "an argument has a control character")
    return list(value)


def _exts(value: object) -> list[str]:
    if not isinstance(value, list) or not value or not all(isinstance(e, str) for e in value):
        raise Refused(400, "give at least one file extension, such as .rs")
    if len(value) > EXTS_MAX:
        raise Refused(400, f"at most {EXTS_MAX} file extensions")
    out: list[str] = []
    reserved = _reserved()
    for raw in value:
        ext = raw.strip().lower()
        if not EXT_RE.match(ext):
            raise Refused(400, f"{raw[:40]!r} is not a file extension like .rs")
        if ext in reserved:
            raise Refused(400, f"{ext} belongs to a built-in language")
        if ext in out:
            raise Refused(400, f"{ext} is listed twice")
        out.append(ext)
    return out


def _options(value: object) -> object:
    if value is None:
        return None
    if not isinstance(value, (dict, list)):
        raise Refused(400, "initializationOptions must be a JSON object or list")
    try:
        size = len(json.dumps(value, separators=(",", ":")))
    except (TypeError, ValueError):
        raise Refused(400, "initializationOptions is not valid JSON")
    if size > OPTIONS_MAX:
        raise Refused(400, f"initializationOptions is larger than {OPTIONS_MAX} bytes")
    if _depth(value) > OPTIONS_DEPTH:
        raise Refused(400, f"initializationOptions is nested deeper than {OPTIONS_DEPTH} levels")
    return value


def _clean(body: object) -> dict:
    if not isinstance(body, dict):
        raise Refused(400, "the server must be a JSON object")
    unknown = [key for key in body if key not in FIELDS and key != "id"]
    if unknown:
        raise Refused(400, f"unknown field: {str(unknown[0])[:40]}")
    preset = body.get("preset")
    if preset is not None and preset not in _PRESET_IDS:
        raise Refused(400, "unknown preset")
    language = _text(body.get("languageId"), "the language id", 64)
    if not LANG_ID_RE.match(language):
        raise Refused(400, "the language id may hold letters, digits and . _ + - only, such as rust")
    return {
        "label": _text(body.get("label"), "the label", LABEL_MAX),
        "program": _program(body.get("program")),
        "args": _args(body.get("args")),
        "exts": _exts(body.get("exts")),
        "languageId": language,
        "initializationOptions": _options(body.get("initializationOptions")),
        "preset": preset,
    }


def _valid(entry: object) -> bool:
    if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not ID_RE.match(entry["id"]):
        return False
    try:
        _clean({k: entry.get(k) for k in FIELDS})
    except Refused:
        return False
    return True


def _load() -> list[dict]:
    from app.services.secret_store import _read

    target = _file()
    try:
        stat = os.stat(target)
        key = (str(target), stat.st_mtime_ns, stat.st_size)
    except OSError:
        key = (str(target), None, None)
    if _cache["key"] == key:
        return _cache["servers"]
    data = _read(target) if key[1] is not None else None
    items = data.get("servers") if isinstance(data, dict) else None
    servers: list[dict] = []
    seen: set[str] = set()
    for item in items if isinstance(items, list) else []:
        if not _valid(item) or item["id"] in seen or any(ext in item["exts"] for s in servers for ext in s["exts"]):
            continue
        seen.add(item["id"])
        servers.append({"id": item["id"], **{k: item.get(k) for k in FIELDS}})
    _cache.update(key=key, servers=servers)
    return servers


def _save(servers: list[dict]) -> None:
    from app.services.secret_store import _write_private

    target = _file()
    target.parent.mkdir(parents=True, exist_ok=True)
    _write_private(target, {"version": FILE_VERSION, "servers": servers})
    _cache["key"] = None


def _slug(label: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:32] or "server"
    if not base[0].isalnum():
        base = f"s{base}"[:32]
    sid, n = base, 2
    while sid in taken:
        sid = f"{base}-{n}"
        n += 1
    return sid


def _clash(entry: dict, servers: list[dict], skip: str | None) -> None:
    for other in servers:
        if other["id"] == skip:
            continue
        for ext in entry["exts"]:
            if ext in other["exts"]:
                raise Refused(409, f"{ext} already belongs to {other['label']}")


def all_servers() -> list[dict]:
    with _lock:
        return [dict(s) for s in _load()]


def get(sid: str) -> dict | None:
    with _lock:
        for entry in _load():
            if entry["id"] == sid:
                return dict(entry)
    return None


def of_lang(lang: str) -> dict | None:
    if not lang.startswith(PREFIX):
        return None
    sid = lang[len(PREFIX):]
    return get(sid) if ID_RE.match(sid) else None


def add(body: object) -> dict:
    entry = _clean(body)
    with _lock:
        servers = [dict(s) for s in _load()]
        if len(servers) >= SERVERS_MAX:
            raise Refused(409, f"at most {SERVERS_MAX} custom servers")
        _clash(entry, servers, None)
        made = {"id": _slug(entry["preset"] or entry["label"], {s["id"] for s in servers}), **entry}
        servers.append(made)
        _save(servers)
        return dict(made)


def change(sid: str, body: object) -> dict:
    entry = _clean(body)
    with _lock:
        servers = [dict(s) for s in _load()]
        at = next((i for i, s in enumerate(servers) if s["id"] == sid), None)
        if at is None:
            raise Refused(404, "unknown server")
        _clash(entry, servers, sid)
        servers[at] = {"id": sid, **entry}
        _save(servers)
        return dict(servers[at])


def remove(sid: str) -> None:
    with _lock:
        servers = [dict(s) for s in _load()]
        kept = [s for s in servers if s["id"] != sid]
        if len(kept) == len(servers):
            raise Refused(404, "unknown server")
        _save(kept)
