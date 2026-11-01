import asyncio
import json
import os
import shlex
import sys
import time
import uuid

from app.core import config, engine_addr
from app.core.binres import find_bin
from app.services import formslot, sessions as svc
from app.services.gate_hook import SCRIPT

SCRIPT_NAME = "sf_gate.py"
HOOK_DIR = "hooks"
HOOK_MATCHER = "Write|Edit|MultiEdit"
HOOK_TIMEOUT = 135
WAIT_MAX = 120
KEEP_SECONDS = 600
CHOICES = ("use", "adapt", "write")
TEXT_MAX = 4000
SLOTS_MAX = 10
TOKENS_MAX = 10_000_000

_gates: dict[str, dict] = {}
_events: dict[str, asyncio.Event] = {}
_entered: dict[str, dict | None] = {}
_closed_at: dict[str, float] = {}


def script_path():
    return config.data_dir() / HOOK_DIR / SCRIPT_NAME


def ensure_script() -> str:
    target = script_path()
    try:
        if target.is_file() and target.read_text(encoding="utf-8") == SCRIPT:
            os.chmod(target, 0o755)
            return str(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(target.name + ".tmp")
        temp.write_text(SCRIPT, encoding="utf-8")
        os.chmod(temp, 0o755)
        os.replace(temp, target)
    except OSError:
        pass
    return str(target)


def python_command() -> str:
    if not getattr(sys, "frozen", False):
        return sys.executable
    return find_bin("python3") or find_bin("python") or "python3"


def _quote(value: str) -> str:
    return '"' + value + '"' if sys.platform == "win32" else shlex.quote(value)


def hook_command() -> str:
    return f"{_quote(python_command())} {_quote(ensure_script())}"


def _ours(entry: object) -> bool:
    hooks = entry.get("hooks") if isinstance(entry, dict) else None
    return isinstance(hooks, list) and any(isinstance(h, dict) and SCRIPT_NAME in str(h.get("command", "")) for h in hooks)


def merged_settings(existing: object) -> dict:
    body = dict(existing) if isinstance(existing, dict) else {}
    body.update(svc.SETTINGS_BODY)
    hooks = dict(body["hooks"]) if isinstance(body.get("hooks"), dict) else {}
    pre = [entry for entry in hooks.get("PreToolUse", []) if not _ours(entry)] if isinstance(hooks.get("PreToolUse"), list) else []
    pre.append({"matcher": HOOK_MATCHER, "hooks": [{"type": "command", "command": hook_command(), "timeout": HOOK_TIMEOUT}]})
    hooks["PreToolUse"] = pre
    body["hooks"] = hooks
    return body


def session_env(item: dict) -> dict[str, str]:
    env = {
        "SUBFORM_ENGINE": engine_addr.base(),
        "SUBFORM_SESSION": item["id"],
        "SUBFORM_WORKTREE": item["worktree"],
        "SUBFORM_REPO": item["repo"],
    }
    found = formslot.binary()
    if found:
        env["FORMSLOT_BIN"] = found
    return env


def _public(gate: dict) -> dict:
    return dict(gate)


def open_list() -> list[dict]:
    return [_public(g) for g in sorted(_gates.values(), key=lambda g: g["created"]) if g["choice"] is None]


def _prune() -> None:
    cutoff = time.time() - KEEP_SECONDS
    for gate_id in [i for i, at in _closed_at.items() if at < cutoff]:
        _gates.pop(gate_id, None)
        _events.pop(gate_id, None)
        _entered.pop(gate_id, None)
        _closed_at.pop(gate_id, None)


def _slots(raw: object) -> list[dict]:
    out: list[dict] = []
    for entry in raw if isinstance(raw, list) else []:
        if isinstance(entry, dict) and isinstance(entry.get("id"), str) and isinstance(entry.get("path"), str):
            line = entry.get("line")
            out.append({"id": entry["id"][:200], "path": entry["path"][:1000], "line": line if isinstance(line, int) and line >= 0 else 0})
    return out[:SLOTS_MAX]


def _others_open(session_id: str, gate_id: str) -> bool:
    return any(g["session"] == session_id and g["choice"] is None and g["id"] != gate_id for g in _gates.values())


def create(body: dict) -> dict:
    _prune()
    session_id = body.get("session")
    item = svc._sessions.get(session_id) if isinstance(session_id, str) else None
    if item is None:
        raise svc.Refused(404, "no such session")
    tokens = body.get("tokens")
    gate = {
        "id": uuid.uuid4().hex[:16],
        "session": session_id,
        "tool": str(body.get("tool") or "Write")[:40],
        "path": str(body.get("path") or "")[:2000],
        "message": str(body.get("message") or "")[:TEXT_MAX],
        "slots": _slots(body.get("slots")),
        "tokens": min(tokens, TOKENS_MAX) if isinstance(tokens, int) and tokens > 0 else 0,
        "created": svc._now(),
        "choice": None,
    }
    _gates[gate["id"]] = gate
    _events[gate["id"]] = asyncio.Event()
    _entered[gate["id"]] = None
    if item["state"] == "working":
        _entered[gate["id"]] = {"prior": item.get("lastMessage")}
        first = gate["slots"][0]["id"] if gate["slots"] else "a reusable slot"
        svc._set_state(item, "needs-input", f"Existing slot found: {first}")
    svc._publish("gate", _public(gate))
    return {"id": gate["id"]}


def _close(gate: dict, choice: str) -> None:
    if gate["choice"] is not None:
        return
    gate["choice"] = choice
    _closed_at[gate["id"]] = time.time()
    item = svc._sessions.get(gate["session"])
    if item is not None:
        if choice in ("use", "adapt") and gate["tokens"]:
            item["tokensSaved"] = int(item.get("tokensSaved") or 0) + gate["tokens"]
        entered = _entered.get(gate["id"])
        if entered is not None and not _others_open(gate["session"], gate["id"]) and item["state"] == "needs-input":
            svc._set_state(item, "working", entered["prior"] or "Working")
        else:
            svc._changed(item)
    event = _events.get(gate["id"])
    if event is not None:
        event.set()
    svc._publish("gate-closed", _public(gate))


def answer(gate_id: str, choice: str) -> dict:
    gate = _gates.get(gate_id)
    if gate is None:
        raise svc.Refused(404, "no such gate")
    if choice not in CHOICES:
        raise svc.Refused(400, "choice must be use, adapt or write")
    if gate["choice"] is not None:
        raise svc.Refused(409, "that gate is already closed")
    _close(gate, choice)
    return _public(gate)


async def wait(gate_id: str, timeout: float, request) -> dict:
    gate = _gates.get(gate_id)
    if gate is None:
        raise svc.Refused(404, "no such gate")
    limit = max(0.5, min(float(timeout), WAIT_MAX))
    deadline = time.monotonic() + limit
    event = _events[gate_id]
    while gate["choice"] is None:
        left = deadline - time.monotonic()
        if left <= 0:
            _close(gate, "timeout")
            break
        try:
            await asyncio.wait_for(event.wait(), min(1.0, left))
        except asyncio.TimeoutError:
            if await request.is_disconnected():
                _close(gate, "abandoned")
                break
    return _public(gate)


def close_session(session_id: str) -> None:
    for gate in [g for g in _gates.values() if g["session"] == session_id and g["choice"] is None]:
        _entered[gate["id"]] = None
        _close(gate, "abandoned")
