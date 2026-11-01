import asyncio
import json
import os
import secrets
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
OPEN_PER_SESSION = 5
OPEN_TOTAL = 50
ABANDON_MARGIN = 30
MESSAGE_BODY_MAX = 8000
TOKEN_ENV = "SUBFORM_GATE_TOKEN"

_gates: dict[str, dict] = {}
_events: dict[str, asyncio.Event] = {}
_closed_at: dict[str, float] = {}
_prior: dict[str, str | None] = {}
_touched: dict[str, float] = {}
_waiting: dict[str, int] = {}
_tokens: dict[str, str] = {}


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


def _mint(session_id: str) -> str:
    _tokens[session_id] = secrets.token_urlsafe(24)
    return _tokens[session_id]


def verify(session_id: object, token: str | None) -> None:
    known = _tokens.get(session_id) if isinstance(session_id, str) else None
    if not known or not token or not secrets.compare_digest(known.encode("utf-8"), token.encode("utf-8")):
        raise svc.Refused(403, "that session token is not valid")


def verify_gate(gate_id: str, token: str | None) -> None:
    gate = _gates.get(gate_id)
    if gate is None:
        raise svc.Refused(404, "no such gate")
    verify(gate["session"], token)


def session_env(item: dict) -> dict[str, str]:
    env = {
        "SUBFORM_ENGINE": engine_addr.base(),
        "SUBFORM_SESSION": item["id"],
        "SUBFORM_WORKTREE": item["worktree"],
        "SUBFORM_REPO": item["repo"],
        TOKEN_ENV: _mint(item["id"]),
    }
    found = formslot.binary()
    if found:
        env["FORMSLOT_BIN"] = found
    return env


def _public(gate: dict) -> dict:
    return dict(gate)


def open_list() -> list[dict]:
    _prune()
    return [_public(g) for g in sorted(_gates.values(), key=lambda g: g["created"]) if g["choice"] is None]


def _prune() -> None:
    now = time.time()
    cutoff = now - KEEP_SECONDS
    for gate_id in [i for i, at in _closed_at.items() if at < cutoff]:
        _gates.pop(gate_id, None)
        _events.pop(gate_id, None)
        _closed_at.pop(gate_id, None)
        _touched.pop(gate_id, None)
    idle = now - (WAIT_MAX + ABANDON_MARGIN)
    for gate in [g for g in _gates.values() if g["choice"] is None]:
        if not _waiting.get(gate["id"]) and _touched.get(gate["id"], now) < idle:
            _close(gate, "abandoned")


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
    mine = [g for g in _gates.values() if g["choice"] is None]
    if len(mine) >= OPEN_TOTAL or sum(1 for g in mine if g["session"] == session_id) >= OPEN_PER_SESSION:
        raise svc.Refused(429, "too many open gates")
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
    _touched[gate["id"]] = time.time()
    if item["state"] == "working":
        _prior[session_id] = item.get("lastMessage")
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
        if gate["session"] in _prior and not _others_open(gate["session"], gate["id"]):
            prior = _prior.pop(gate["session"])
            if item["state"] == "needs-input":
                svc._set_state(item, "working", prior or "Working")
            else:
                svc._changed(item)
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
    _waiting[gate_id] = _waiting.get(gate_id, 0) + 1
    try:
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
    finally:
        _touched[gate_id] = time.time()
        left_over = _waiting.get(gate_id, 1) - 1
        if left_over > 0:
            _waiting[gate_id] = left_over
        else:
            _waiting.pop(gate_id, None)
    return _public(gate)


def close_session(session_id: str) -> None:
    _prior.pop(session_id, None)
    _tokens.pop(session_id, None)
    for gate in [g for g in _gates.values() if g["session"] == session_id and g["choice"] is None]:
        _close(gate, "abandoned")
