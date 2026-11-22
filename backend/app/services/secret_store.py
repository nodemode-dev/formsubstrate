import json
import os
import re
import threading
from typing import Optional

import keyring
from keyring.backends import fail, null
from keyring.errors import KeyringError, NoKeyringError, PasswordDeleteError

from app.core import config

SERVICE = "formsubstrate"
INDEX_NAME = "secrets-index.json"
FILE_NAME = "secrets-local.json"
INDEX_VERSION = 2
KEYCHAIN = "keychain"
FILE = "file"
ALL = "*"
STORES = (KEYCHAIN, FILE)
UNTRACKED_BEFORE = ("cogentics-api-key",)
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")

_lock = threading.RLock()


class StoreError(Exception):
    pass


def _index_file():
    return config.data_dir() / INDEX_NAME


def _secret_file():
    return config.data_dir() / FILE_NAME


def system_store() -> bool:
    try:
        backend = keyring.get_keyring()
    except Exception:
        return False
    if isinstance(backend, (fail.Keyring, null.Keyring)):
        return False
    try:
        return backend.priority > 0
    except Exception:
        return True


def _read(target) -> object:
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_private(target, data: dict) -> None:
    temp = target.with_name(f".{target.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        os.unlink(temp)
    except FileNotFoundError:
        pass
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(temp, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(json.dumps(data, sort_keys=True).encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, target)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def _valid(name: object) -> bool:
    return isinstance(name, str) and bool(NAME_RE.fullmatch(name))


def _empty() -> dict:
    return {"version": INDEX_VERSION, "secrets": {}, "unknown": ALL, "absent": []}


def _index() -> dict:
    raw = _read(_index_file())
    if isinstance(raw, dict) and raw.get("version") == INDEX_VERSION:
        table = raw.get("secrets") if isinstance(raw.get("secrets"), dict) else {}
        secrets = {name: {"store": entry["store"]} for name, entry in table.items()
                   if _valid(name) and isinstance(entry, dict) and entry.get("store") in STORES}
        unknown = raw.get("unknown")
        absent = raw.get("absent")
        return {"version": INDEX_VERSION, "secrets": secrets,
                "unknown": ALL if unknown == ALL else sorted({n for n in unknown if _valid(n)}) if isinstance(unknown, list) else ALL,
                "absent": sorted({n for n in absent if _valid(n)}) if isinstance(absent, list) else []}
    if isinstance(raw, dict) and isinstance(raw.get("names"), list):
        converted = {"version": INDEX_VERSION, "secrets": {name: {"store": KEYCHAIN} for name in raw["names"] if _valid(name)},
                     "unknown": [name for name in UNTRACKED_BEFORE if name not in raw["names"]], "absent": []}
        try:
            _write_private(_index_file(), converted)
        except OSError:
            pass
        return converted
    return _empty()


def _state(index: dict, name: str) -> str:
    if name in index["secrets"]:
        return "saved"
    if index["unknown"] == ALL:
        return "absent" if name in index["absent"] else "unknown"
    return "unknown" if name in index["unknown"] else "absent"


def _mark(index: dict, name: str, where: Optional[str]) -> None:
    if where:
        index["secrets"][name] = {"store": where}
    else:
        index["secrets"].pop(name, None)
    if index["unknown"] == ALL:
        absent = set(index["absent"])
        if where:
            absent.discard(name)
        else:
            absent.add(name)
        index["absent"] = sorted(absent)
    else:
        index["unknown"] = [item for item in index["unknown"] if item != name]


def _settle(index: dict, name: str, where: Optional[str]) -> None:
    _mark(index, name, where)
    _write_private(_index_file(), index)


def _quiet_settle(index: dict, name: str, where: Optional[str]) -> None:
    try:
        _settle(index, name, where)
    except OSError:
        pass


def _file_values() -> dict:
    raw = _read(_secret_file())
    table = raw.get(SERVICE) if isinstance(raw, dict) else None
    if not isinstance(table, dict):
        return {}
    return {name: value for name, value in table.items() if _valid(name) and isinstance(value, str) and value}


def _file_put(name: str, value: str) -> None:
    _write_private(_secret_file(), {SERVICE: {**_file_values(), name: value}})


def _file_drop(name: str) -> None:
    values = _file_values()
    if name not in values:
        return
    values.pop(name)
    if values:
        _write_private(_secret_file(), {SERVICE: values})
    else:
        os.unlink(_secret_file())


def status(name: str) -> dict:
    with _lock:
        index = _index()
        state = _state(index, name)
        if state == "unknown" and not system_store():
            state = "saved" if name in _file_values() else "absent"
            if state == "saved":
                _quiet_settle(index, name, FILE)
        entry = index["secrets"].get(name)
    return {"present": None if state == "unknown" else state == "saved", "state": state,
            "store": entry["store"] if entry and state == "saved" else None}


def names() -> list[str]:
    with _lock:
        return sorted(_index()["secrets"])


def get(name: str) -> Optional[str]:
    with _lock:
        index = _index()
        state = _state(index, name)
        if state == "absent":
            return None
        entry = index["secrets"].get(name)
        if entry is not None and entry["store"] == FILE:
            value = _file_values().get(name)
            if value is None:
                _quiet_settle(index, name, None)
            return value
        if not system_store():
            value = _file_values().get(name) if entry is None else None
            if value is not None:
                _quiet_settle(index, name, FILE)
            return value
        try:
            value = keyring.get_password(SERVICE, name)
        except KeyringError:
            return None
        if value is not None:
            if entry is None:
                _quiet_settle(index, name, KEYCHAIN)
            return value
        value = _file_values().get(name)
        _quiet_settle(index, name, FILE if value is not None else None)
        return value


def put(name: str, value: str) -> str:
    with _lock:
        index = _index()
        where = FILE
        if system_store():
            try:
                keyring.set_password(SERVICE, name, value)
                where = KEYCHAIN
            except NoKeyringError:
                where = FILE
            except KeyringError as error:
                raise StoreError(error.__class__.__name__) from None
        try:
            if where == FILE:
                _file_put(name, value)
            else:
                _file_drop(name)
            _settle(index, name, where)
        except OSError as error:
            raise StoreError(error.__class__.__name__) from None
        return where


def delete(name: str) -> None:
    with _lock:
        index = _index()
        if system_store():
            try:
                keyring.delete_password(SERVICE, name)
            except (PasswordDeleteError, NoKeyringError):
                pass
            except KeyringError as error:
                raise StoreError(error.__class__.__name__) from None
        try:
            _file_drop(name)
            _settle(index, name, None)
        except OSError as error:
            raise StoreError(error.__class__.__name__) from None


def settle_many(found: dict, complete: bool) -> None:
    with _lock:
        index = _index()
        for name, present in found.items():
            if not _valid(name):
                continue
            if present:
                _mark(index, name, KEYCHAIN)
            elif index["secrets"].get(name, {}).get("store") == FILE:
                _mark(index, name, FILE)
            else:
                _mark(index, name, None)
        if complete:
            index["unknown"] = []
            index["absent"] = []
        _write_private(_index_file(), index)
