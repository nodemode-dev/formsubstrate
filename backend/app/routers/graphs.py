import json
import logging
import os
import re
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from app.core import workspace_root as ws
from app.core.local_guard import require_window
from app.models.graph import ERROR_ROUTE_KINDS, KINDS, ON_ERROR, ROUTES, YIELD_EVENTS, check_doc
from app.services.presets import store as preset_store

router = APIRouter()

FOLDER = ".formsubstrate/graphs"
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
BODY_MAX = 2 * 1024 * 1024

CATALOG = [
    {"kind": "start", "label": "Start", "help": "Entry point. Every graph begins here.", "color": "terminal", "ports": {"in": False, "out": True}},
    {"kind": "agent", "label": "Agent", "help": "A model worker that reads, writes and runs tools.", "color": "agent", "ports": {"in": True, "out": True}},
    {"kind": "tool", "label": "Tool", "help": "One direct tool call, no model.", "color": "tool", "ports": {"in": True, "out": True}},
    {"kind": "evaluator", "label": "Evaluator", "help": "A critic. Label its out-edges accept and revise.", "color": "evaluator", "ports": {"in": True, "out": True}, "routes": list(ROUTES["evaluator"])},
    {"kind": "yield", "label": "Yield", "help": "Parks the run until an event, an approval or a delay.", "color": "yield", "ports": {"in": True, "out": True}},
    {"kind": "branch", "label": "Branch", "help": "If and else. Routes the true and false edges on an expression.", "color": "branch", "ports": {"in": True, "out": True}, "routes": list(ROUTES["branch"])},
    {"kind": "foreach", "label": "Foreach", "help": "Runs the each edge once per item, joins on the done edge.", "color": "foreach", "ports": {"in": True, "out": True}, "routes": list(ROUTES["foreach"])},
    {"kind": "transform", "label": "Transform", "help": "Maps data with a template or an expression.", "color": "transform", "ports": {"in": True, "out": True}},
    {"kind": "call_graph", "label": "Call graph", "help": "Runs a saved graph inline as a subflow.", "color": "call", "ports": {"in": True, "out": True}},
    {"kind": "end", "label": "End", "help": "Terminal node. The run completes here.", "color": "terminal", "ports": {"in": True, "out": False}},
]


def _fail(err: ws.Refused) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


def _folder(create: bool) -> str:
    try:
        real, _ = ws.resolve(FOLDER, write=create)
    except ws.Refused as err:
        raise _fail(err)
    if create:
        os.makedirs(real, exist_ok=True)
    return real


def _file(name: str, create: bool) -> str:
    if not NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="a graph name uses letters, digits, dot, dash and underscore, up to 80 characters")
    return os.path.join(_folder(create), name + ".json")


def _atomic(target: str, text: str) -> None:
    fd, temp = tempfile.mkstemp(prefix=".sf-", suffix=".tmp", dir=os.path.dirname(target))
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(text.encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, target)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def _dump(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


async def _json(request: Request) -> dict:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > BODY_MAX:
        raise HTTPException(status_code=413, detail="graph is larger than 2 MiB")
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="body must be json")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be an object")
    return body


def _preset(name: str) -> dict:
    try:
        return preset_store.read("graphs", name)
    except preset_store.PresetError as err:
        raise HTTPException(status_code=404 if err.status == 400 else err.status, detail=err.detail)


@router.get("/graphs/kinds")
def kinds() -> dict:
    return {
        "kinds": CATALOG,
        "routes": {k: list(v) for k, v in ROUTES.items()},
        "errorRouteKinds": list(ERROR_ROUTE_KINDS),
        "yieldEvents": list(YIELD_EVENTS),
        "onError": list(ON_ERROR),
        "all": list(KINDS),
    }


@router.get("/graphs/presets")
def presets() -> dict:
    return {"presets": preset_store.listing("graphs")}


@router.get("/graphs/presets/{name}")
def preset(name: str) -> dict:
    return _preset(name)


@router.post("/graphs/validate")
async def validate(request: Request) -> dict:
    body = await _json(request)
    doc = body.get("doc", body)
    _, errors, warnings = check_doc(doc)
    return {"ok": not errors, "errors": errors, "warnings": warnings}


def _listing() -> list[dict]:
    try:
        real, _ = ws.resolve(FOLDER)
    except ws.Refused as err:
        raise _fail(err)
    if not os.path.isdir(real):
        return []
    rows = []
    for entry in sorted(os.scandir(real), key=lambda e: e.name.lower()):
        if not entry.is_file() or not entry.name.endswith(".json") or not NAME_RE.match(entry.name[:-5]):
            continue
        info = entry.stat()
        row = {"name": entry.name[:-5], "path": f"{FOLDER}/{entry.name}", "mtime": info.st_mtime, "size": info.st_size, "nodes": 0, "edges": 0, "valid": False}
        try:
            raw = json.loads(Path(entry.path).read_text(encoding="utf-8"))
            row["nodes"] = len(raw.get("nodes", []))
            row["edges"] = len(raw.get("edges", []))
            row["docName"] = raw.get("name", "")
            row["valid"] = not check_doc(raw)[1]
        except (OSError, ValueError, AttributeError, TypeError):
            logging.getLogger("formsubstrate").debug("graph file %s could not be read", entry.name, exc_info=True)
        rows.append(row)
    return rows


@router.get("/graphs")
async def listing() -> dict:
    return {"graphs": await run_in_threadpool(_listing)}


@router.get("/graphs/{name}")
def read(name: str) -> dict:
    target = _file(name, False)
    try:
        text = Path(target).read_text(encoding="utf-8")
        info = os.stat(target)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="no saved graph " + name)
    except (OSError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="graph file cannot be read")
    return {"name": name, "path": f"{FOLDER}/{name}.json", "text": text, "mtime": info.st_mtime}


@router.put("/graphs/{name}", dependencies=[Depends(require_window)])
async def save(name: str, request: Request) -> dict:
    body = await _json(request)
    doc = body.get("doc")
    expected = body.get("expectedMtime")
    if expected is not None and (isinstance(expected, bool) or not isinstance(expected, (int, float))):
        raise HTTPException(status_code=400, detail="expectedMtime must be a number or null")
    _, errors, warnings = check_doc(doc)
    if errors:
        raise HTTPException(status_code=422, detail="; ".join(errors[:6]))
    target = _file(name, True)
    if expected is not None:
        try:
            current = os.stat(target).st_mtime
        except FileNotFoundError:
            raise HTTPException(status_code=409, detail="graph no longer exists")
        if abs(current - float(expected)) > 1e-6:
            raise HTTPException(status_code=409, detail="graph changed on disk")
    elif body.get("create") is True and os.path.lexists(target):
        raise HTTPException(status_code=409, detail="a graph with this name already exists")
    try:
        await run_in_threadpool(_atomic, target, _dump(doc))
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    info = os.stat(target)
    return {"name": name, "path": f"{FOLDER}/{name}.json", "mtime": info.st_mtime, "warnings": warnings}


@router.delete("/graphs/{name}", dependencies=[Depends(require_window)])
def remove(name: str) -> dict:
    target = _file(name, False)
    try:
        os.unlink(target)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="no saved graph " + name)
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    return {"deleted": name}


@router.post("/graphs/presets/{name}/install", dependencies=[Depends(require_window)])
async def install(name: str, request: Request) -> dict:
    data = _preset(name)
    target = _file(name, True)
    if os.path.lexists(target):
        raise HTTPException(status_code=409, detail="a graph named " + name + " is already saved")
    await run_in_threadpool(_atomic, target, _dump(data["doc"]))
    info = os.stat(target)
    return {"name": name, "path": f"{FOLDER}/{name}.json", "mtime": info.st_mtime}
