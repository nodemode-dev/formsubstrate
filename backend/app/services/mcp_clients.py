import hashlib
import logging
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone

from app.core import config
from app.services.secret_store import _read, _write_private

log = logging.getLogger("formsubstrate.mcp")

FILE_NAME = "mcp-clients.json"
FILE_VERSION = 1
NAME_MAX = 80
CLIENTS_MAX = 50
TOUCH_EVERY = 60
TOKEN_PREFIX = "fsmcp_"
ID_RE = re.compile(r"^[a-f0-9]{16}$")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")

_lock = threading.RLock()
_cache: dict = {"key": None, "clients": []}
_seen: dict[str, float] = {}


class Refused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _file():
    return config.data_dir() / FILE_NAME


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _valid(entry: object) -> bool:
    if not isinstance(entry, dict):
        return False
    return bool(isinstance(entry.get("id"), str) and ID_RE.match(entry["id"]) and isinstance(entry.get("name"), str) and isinstance(entry.get("sha256"), str) and len(entry["sha256"]) == 64)


def _load() -> list[dict]:
    target = _file()
    try:
        stat = os.stat(target)
        key = (str(target), stat.st_mtime_ns, stat.st_size)
    except OSError:
        key = (str(target), None, None)
    if _cache["key"] == key:
        return _cache["clients"]
    data = _read(target) if key[1] is not None else None
    if key[1] is not None and not isinstance(data, dict):
        log.warning("the MCP client list in the data folder is not readable; no outside client is admitted until it is fixed or removed")
    items = data.get("clients") if isinstance(data, dict) else None
    clients = [dict(e) for e in items if _valid(e)] if isinstance(items, list) else []
    _cache.update(key=key, clients=clients)
    return clients


def _save(clients: list[dict]) -> None:
    target = _file()
    target.parent.mkdir(parents=True, exist_ok=True)
    _write_private(target, {"version": FILE_VERSION, "clients": clients})
    _cache["key"] = None


def _public(entry: dict) -> dict:
    return {"id": entry["id"], "name": entry["name"], "created": entry.get("created"), "lastUsed": entry.get("lastUsed")}


def list_clients() -> list[dict]:
    with _lock:
        return [_public(e) for e in _load()]


def clean_name(raw: object) -> str:
    if not isinstance(raw, str):
        raise Refused(400, "name must be text")
    name = " ".join(CONTROL.sub(" ", raw).split())
    if not 1 <= len(name) <= NAME_MAX:
        raise Refused(400, f"name must be 1 to {NAME_MAX} characters")
    return name


def create(raw_name: object) -> tuple[dict, str]:
    name = clean_name(raw_name)
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    with _lock:
        clients = list(_load())
        if len(clients) >= CLIENTS_MAX:
            raise Refused(409, f"at most {CLIENTS_MAX} clients can be approved; remove one first")
        taken = {e["id"] for e in clients}
        ident = secrets.token_hex(8)
        while ident in taken:
            ident = secrets.token_hex(8)
        entry = {"id": ident, "name": name, "created": _now(), "lastUsed": None, "sha256": _digest(token)}
        clients.append(entry)
        _save(clients)
    log.info("MCP client %s approved", ident)
    return _public(entry), token


def revoke(ident: str) -> None:
    if not isinstance(ident, str) or not ID_RE.match(ident):
        raise Refused(404, "no such client")
    with _lock:
        clients = list(_load())
        kept = [e for e in clients if e["id"] != ident]
        if len(kept) == len(clients):
            raise Refused(404, "no such client")
        _save(kept)
        _seen.pop(ident, None)
    log.info("MCP client %s removed", ident)


def find(token: str) -> str | None:
    if not token.startswith(TOKEN_PREFIX):
        return None
    wanted = _digest(token).encode("ascii")
    with _lock:
        clients = _load()
        match = None
        for entry in clients:
            if secrets.compare_digest(wanted, entry["sha256"].encode("ascii")):
                match = entry
        if match is None:
            return None
        ident = match["id"]
        now = time.monotonic()
        if now - _seen.get(ident, -TOUCH_EVERY * 2) >= TOUCH_EVERY:
            _seen[ident] = now
            updated = [dict(e, lastUsed=_now()) if e["id"] == ident else e for e in clients]
            try:
                _save(updated)
            except OSError:
                log.warning("the last-used time of MCP client %s was not saved", ident)
    return ident
