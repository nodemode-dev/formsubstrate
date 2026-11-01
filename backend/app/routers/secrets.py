import json
import os
import re
import threading

import keyring
from fastapi import APIRouter, HTTPException, Request, Response
from keyring.errors import KeyringError, PasswordDeleteError

from app.core import config

router = APIRouter()

SERVICE = "subform"
OLD_SERVICE = "substrataform"
KEYRING_MARKER = ".keyring-migrated-from-substrataform"
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
INDEX_NAME = "secrets-index.json"
VALUE_MAX = 65536
NO_KEYRING = "no system keyring"

_lock = threading.Lock()


def _index_file():
    return config.data_dir() / INDEX_NAME


def _names() -> list[str]:
    try:
        data = json.loads(_index_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    items = data.get("names") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    return sorted({item for item in items if isinstance(item, str) and NAME_RE.fullmatch(item)})


def _save(names: list[str]) -> None:
    target = _index_file()
    temp = target.with_name(target.name + ".tmp")
    temp.write_text(json.dumps({"names": sorted(set(names))}), encoding="utf-8")
    os.replace(temp, target)


def _old_names() -> list[str]:
    old = config.old_data_dir()
    if old is None:
        return []
    try:
        data = json.loads((old / INDEX_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    items = data.get("names") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, str) and NAME_RE.fullmatch(item)]


def migrate_keyring() -> list[str]:
    marker = config.data_dir() / KEYRING_MARKER
    if marker.exists():
        return []
    notes: list[str] = []
    copied: list[str] = []
    for name in sorted({*_names(), *_old_names()}):
        try:
            if keyring.get_password(SERVICE, name) is not None:
                continue
            value = keyring.get_password(OLD_SERVICE, name)
            if value is None:
                continue
            keyring.set_password(SERVICE, name, value)
            copied.append(name)
        except Exception as error:
            notes.append(f"keychain migration stopped at secret '{name}': {error.__class__.__name__}; it will be tried again at the next start")
            return notes
    if copied:
        with _lock:
            _save([*_names(), *copied])
        notes.append(f"copied {len(copied)} secret(s) from the old keychain service to the new one: {', '.join(copied)}; the old entries were left in place")
    else:
        notes.append("keychain migration: nothing to copy from the old service")
    try:
        marker.write_text(json.dumps({"from": OLD_SERVICE, "copied": copied}), encoding="utf-8")
    except OSError:
        pass
    return notes


def _check(name: str) -> None:
    if not NAME_RE.fullmatch(name):
        raise HTTPException(status_code=400, detail="bad secret name")


def _unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail=NO_KEYRING)


@router.get("/secrets")
def list_names() -> dict:
    return {"names": _names()}


@router.get("/secrets/{name}")
def present(name: str) -> dict:
    _check(name)
    try:
        return {"present": keyring.get_password(SERVICE, name) is not None}
    except KeyringError:
        raise _unavailable()


@router.put("/secrets/{name}", status_code=204)
async def put_secret(name: str, request: Request) -> Response:
    _check(name)
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="body must be json")
    value = body.get("value") if isinstance(body, dict) else None
    if not isinstance(value, str) or not value or len(value) > VALUE_MAX:
        raise HTTPException(status_code=400, detail="value must be a non-empty string")
    try:
        keyring.set_password(SERVICE, name, value)
    except KeyringError:
        raise _unavailable()
    with _lock:
        _save([*_names(), name])
    return Response(status_code=204)


@router.delete("/secrets/{name}", status_code=204)
def delete_secret(name: str) -> Response:
    _check(name)
    try:
        keyring.delete_password(SERVICE, name)
    except PasswordDeleteError:
        pass
    except KeyringError:
        raise _unavailable()
    with _lock:
        _save([item for item in _names() if item != name])
    return Response(status_code=204)
