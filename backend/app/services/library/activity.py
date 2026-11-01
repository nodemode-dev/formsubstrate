import threading
import time
from collections import deque

PHASES = ("enter", "exit", "tool", "output", "delta", "skills", "loop", "yielded", "halt", "error", "compaction")
KEEP = 500
NOTE_MAX = 400
LABEL_MAX = 160

_lock = threading.Lock()
_events: deque[dict] = deque(maxlen=KEEP)
_seq = 0


def emit(label: str, phase: str = "output", note: str | None = None, source: str = "engine") -> dict:
    global _seq
    if phase not in PHASES:
        phase = "output"
    with _lock:
        _seq += 1
        event = {
            "seq": _seq,
            "ts": time.time(),
            "label": str(label)[:LABEL_MAX],
            "phase": phase,
            "note": None if note is None else str(note)[:NOTE_MAX],
            "source": str(source)[:40],
        }
        _events.append(event)
    return event


def since(after: int = 0, limit: int = 200) -> dict:
    with _lock:
        fresh = [e for e in _events if e["seq"] > after]
        last = _seq
    if len(fresh) > limit:
        fresh = fresh[-limit:]
    return {"events": fresh, "last": last}


def clear() -> int:
    with _lock:
        count = len(_events)
        _events.clear()
        return count
