import json
import re

import keyring
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.core import config
from app.core.local_guard import require_window
from app.services import secret_store

router = APIRouter()

SERVICE = "formsubstrate"
OLD_SERVICE = "subform"
KEYRING_MARKER = ".keyring-migrated-from-subform"
RESERVED = ("mcp.", "plugin.", "cogentics-", "webhook-")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
INDEX_NAME = "secrets-index.json"
VALUE_MAX = 65536
NO_KEYRING = "the system keychain refused"
TRACKED_RESERVED = ("cogentics-api-key",)


def _names() -> list[str]:
    return [name for name in secret_store.names() if not name.startswith(RESERVED)]


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


def _read_json(file) -> object:
    try:
        return json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _candidates() -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = [(SERVICE, name) for name in sorted({*_names(), *_old_names()})]
    found.append((SERVICE, "cogentics-api-key"))
    folders = [config.data_dir()]
    old = config.old_data_dir()
    if old is not None:
        folders.append(old)
    servers: set[str] = set()
    triggers: set[str] = set()
    for folder in folders:
        listed = _read_json(folder / "library" / "mcp-servers.json")
        for item in listed if isinstance(listed, list) else []:
            if isinstance(item, dict) and isinstance(item.get("name"), str):
                servers.add(item["name"])
        try:
            files = sorted((folder / "triggers").glob("*.json"))
        except OSError:
            files = []
        for file in files:
            doc = _read_json(file)
            table = doc.get("triggers") if isinstance(doc, dict) else None
            for item in (table.values() if isinstance(table, dict) else table or []):
                if isinstance(item, dict) and item.get("kind") == "webhook" and isinstance(item.get("id"), str):
                    triggers.add(item["id"])
    found.extend((SERVICE, f"mcp.{name}.headers") for name in sorted(servers))
    found.extend((f"{SERVICE}.triggers", f"webhook-{tid}") for tid in sorted(triggers))
    return found


def migrate_keyring() -> list[str]:
    marker = config.data_dir() / KEYRING_MARKER
    if marker.exists():
        return []
    notes: list[str] = []
    copied: list[str] = []
    found: dict[str, bool] = {}
    for service, name in _candidates():
        tracked = service == SERVICE and bool(NAME_RE.fullmatch(name)) and (not name.startswith(RESERVED) or name in TRACKED_RESERVED)
        try:
            if keyring.get_password(service, name) is not None:
                if tracked:
                    found[name] = True
                continue
            value = keyring.get_password(service.replace(SERVICE, OLD_SERVICE, 1), name)
            if value is None:
                if tracked:
                    found[name] = False
                continue
            keyring.set_password(service, name, value)
            copied.append(name)
            if tracked:
                found[name] = True
        except Exception as error:
            notes.append(f"keychain migration stopped at secret '{name}': {error.__class__.__name__}; it will be tried again at the next start")
            return notes
    try:
        secret_store.settle_many(found, complete=True)
    except OSError as error:
        notes.append(f"keychain migration could not write the secrets index: {error.__class__.__name__}; it will be rebuilt as secrets are used")
    if copied:
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
    if name.startswith(RESERVED):
        raise HTTPException(status_code=400, detail="this secret name belongs to another part of the app")


def _unavailable(error: secret_store.StoreError) -> HTTPException:
    return HTTPException(status_code=503, detail=f"{NO_KEYRING}: {error}")


@router.get("/secrets")
def list_names() -> dict:
    return {"names": _names()}


@router.get("/secrets/{name}")
def present(name: str) -> dict:
    _check(name)
    return secret_store.status(name)


@router.put("/secrets/{name}", dependencies=[Depends(require_window)])
async def put_secret(name: str, request: Request) -> dict:
    _check(name)
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="body must be json")
    value = body.get("value") if isinstance(body, dict) else None
    if not isinstance(value, str) or not value or len(value) > VALUE_MAX:
        raise HTTPException(status_code=400, detail="value must be a non-empty string")
    try:
        secret_store.put(name, value)
    except secret_store.StoreError as error:
        raise _unavailable(error)
    return secret_store.status(name)


@router.delete("/secrets/{name}", status_code=204, dependencies=[Depends(require_window)])
def delete_secret(name: str) -> Response:
    _check(name)
    try:
        secret_store.delete(name)
    except secret_store.StoreError as error:
        raise _unavailable(error)
    return Response(status_code=204)
