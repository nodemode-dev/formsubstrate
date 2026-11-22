import os
import threading

from app.core import workspace_root as ws

LIMIT = 200

_lock = threading.Lock()
_trusted: list[str] = []


def _key(path: str) -> str:
    return os.path.normcase(os.path.realpath(path))


def is_trusted(root: str | None = None) -> bool:
    path = root if root is not None else ws.current()
    if not path:
        return False
    key = _key(path)
    with _lock:
        return key in _trusted


def set_trust(workspace: str, trusted: bool) -> dict:
    root = ws.current()
    if root is None or not workspace or _key(workspace) != _key(root):
        return {"trusted": is_trusted()}
    key = _key(root)
    with _lock:
        if key in _trusted:
            _trusted.remove(key)
        if trusted:
            _trusted.append(key)
            del _trusted[:-LIMIT]
    return {"trusted": trusted}
