import asyncio
import json
import re
import threading

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core import config
from app.core.local_guard import require_window

router = APIRouter()
OWNER = [Depends(require_window)]

FILE_NAME = "keybindings.json"
FILE_VERSION = 1
BODY_MAX = 65536
COMMANDS_MAX = 500
COMBOS_MAX = 4
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$")
COMBO_RE = re.compile(r"^(?:Alt\+)?(?:Shift\+)?(?:Mod\+)?(?:[^\x00-\x20\x7f]|[A-Za-z][A-Za-z0-9]{1,19})$")

_lock = threading.Lock()


def _file():
    return config.data_dir() / FILE_NAME


def clean(data: object) -> dict[str, list[str]]:
    keys = data.get("keys") if isinstance(data, dict) else None
    if not isinstance(keys, dict):
        raise ValueError("the body must be an object with a keys object")
    if len(keys) > COMMANDS_MAX:
        raise ValueError(f"at most {COMMANDS_MAX} commands can be rebound")
    out: dict[str, list[str]] = {}
    for name, combos in keys.items():
        if not ID_RE.match(name):
            raise ValueError("a command id is not usable")
        if not isinstance(combos, list) or len(combos) > COMBOS_MAX:
            raise ValueError(f"{name} must have a list of at most {COMBOS_MAX} shortcuts")
        seen: list[str] = []
        for combo in combos:
            if not isinstance(combo, str) or not COMBO_RE.match(combo):
                raise ValueError(f"{name} has a shortcut that is not written as Alt+Shift+Mod+key")
            if combo not in seen:
                seen.append(combo)
        out[name] = seen
    return out


def load() -> dict[str, list[str]]:
    target = _file()
    try:
        if target.stat().st_size > BODY_MAX:
            return {}
        return clean(json.loads(target.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return {}


def save(keys: dict[str, list[str]]) -> None:
    from app.services.secret_store import _write_private

    target = _file()
    with _lock:
        target.parent.mkdir(parents=True, exist_ok=True)
        _write_private(target, {"version": FILE_VERSION, "keys": keys})


@router.get("/keybindings")
async def read_keybindings() -> dict:
    return {"version": FILE_VERSION, "keys": await asyncio.to_thread(load)}


@router.put("/keybindings", dependencies=OWNER)
async def write_keybindings(request: Request) -> dict:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > BODY_MAX:
        raise HTTPException(413, "the shortcuts are too large")
    raw = await request.body()
    if len(raw) > BODY_MAX:
        raise HTTPException(413, "the shortcuts are too large")
    try:
        keys = clean(json.loads(raw))
    except (ValueError, UnicodeDecodeError) as err:
        raise HTTPException(400, str(err)) from err
    try:
        await asyncio.to_thread(save, keys)
    except OSError as err:
        raise HTTPException(500, f"the shortcuts could not be saved: {err}") from err
    return {"version": FILE_VERSION, "keys": keys}
