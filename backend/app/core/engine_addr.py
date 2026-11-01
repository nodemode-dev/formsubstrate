import json
import os

from fastapi import Request

from app.core import config

_base: str | None = None


def remember(request: Request) -> None:
    global _base
    server = request.scope.get("server")
    if server and len(server) == 2 and server[1]:
        _base = f"http://127.0.0.1:{int(server[1])}"


def port() -> int:
    if _base:
        return int(_base.rsplit(":", 1)[1])
    raw = os.environ.get("SUBFORM_PORT", "")
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    try:
        found = int(json.loads((config.data_dir() / "engine.port").read_text(encoding="utf-8")).get("port", 0))
    except (OSError, ValueError, AttributeError, TypeError):
        found = 0
    return found if found > 0 else config.BACKEND_PORT


def base() -> str:
    return _base or f"http://127.0.0.1:{port()}"
