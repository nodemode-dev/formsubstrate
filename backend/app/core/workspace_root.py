import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.core import config

RECENT_NAME = "recent.json"
RECENT_MAX = 12
HIDDEN_NAMES = (".git", "node_modules", "__pycache__", ".venv", "venv", "target", "dist")
PROTECTED_NAMES = (".git",)

_lock = threading.Lock()
_root: str | None = None


class Refused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def current() -> str | None:
    return _root


def set_current(path: str) -> str:
    global _root
    _root = os.path.normpath(path)
    return _root


def clear() -> None:
    global _root
    _root = None


def display_name(path: str) -> str:
    return os.path.basename(path.rstrip("/\\")) or path


def _recent_file() -> Path:
    return config.data_dir() / RECENT_NAME


def recent_list() -> list[dict]:
    try:
        data = json.loads(_recent_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict) and isinstance(item.get("path"), str)][:RECENT_MAX]


def _save_recent(items: list[dict]) -> None:
    target = _recent_file()
    temp = target.with_name(target.name + ".tmp")
    temp.write_text(json.dumps(items[:RECENT_MAX], indent=2), encoding="utf-8")
    os.replace(temp, target)


def push_recent(path: str) -> None:
    entry = {"path": path, "name": display_name(path), "opened": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    with _lock:
        items = [item for item in recent_list() if item["path"] != path]
        _save_recent([entry, *items])


def drop_recent(path: str) -> None:
    with _lock:
        _save_recent([item for item in recent_list() if item["path"] != path])


def real_root() -> str:
    if _root is None:
        raise Refused(409, "no workspace open")
    return os.path.realpath(_root)


def _inside(real: str, base: str) -> bool:
    return real == base or real.startswith(base.rstrip(os.sep) + os.sep)


def _parts(rel: str) -> list[str]:
    return [part for part in rel.replace("\\", "/").split("/") if part not in ("", ".")]


def resolve(rel: str, *, write: bool = False, follow: bool = True) -> tuple[str, str]:
    if not isinstance(rel, str) or "\0" in rel:
        raise Refused(400, "bad path")
    base = real_root()
    flat = rel.replace("\\", "/")
    if flat.startswith("/") or os.path.isabs(rel) or (len(flat) > 1 and flat[1] == ":"):
        raise Refused(403, "absolute paths are refused")
    parts = _parts(rel)
    if ".." in parts:
        raise Refused(403, "parent references are refused")
    joined = os.path.join(base, *parts)
    if follow or not parts:
        real = os.path.realpath(joined)
    else:
        real = os.path.join(os.path.realpath(os.path.dirname(joined)), parts[-1])
    if not _inside(real, base):
        raise Refused(403, "path leaves the workspace")
    if write:
        inner = _parts(os.path.relpath(real, base)) if real != base else []
        if any(part in PROTECTED_NAMES for part in parts) or any(part in PROTECTED_NAMES for part in inner):
            raise Refused(403, "the git folder is read only")
    return real, "/".join(parts)
