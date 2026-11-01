import json
import threading

from app.services.library.paths import atomic_write, library_dir

_lock = threading.Lock()
NAME = "state.json"


def _read() -> dict:
    try:
        data = json.loads((library_dir() / NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def get_list(key: str) -> list[str]:
    items = _read().get(key)
    return [i for i in items if isinstance(i, str)] if isinstance(items, list) else []


def set_member(key: str, name: str, on: bool) -> list[str]:
    with _lock:
        data = _read()
        current = set(get_list(key))
        if on:
            current.add(name)
        else:
            current.discard(name)
        data[key] = sorted(current)
        atomic_write(library_dir() / NAME, json.dumps(data, indent=1))
        return data[key]
