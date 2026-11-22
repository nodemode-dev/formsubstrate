import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core import workspace_root as ws
from app.core.local_guard import require_window
from app.services.runs import agent, rt, tools
from app.services.runs.manager import TERMINAL, manager

router = APIRouter()

MODES = ("simulate", "claude")


def _root() -> str:
    try:
        return ws.real_root()
    except ws.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)


def _doc(raw: dict):
    try:
        return rt.build_doc(raw)
    except rt.GraphError as err:
        raise HTTPException(status_code=422, detail=str(err))


class StartRun(BaseModel):
    doc: dict
    task: str = Field(default="", max_length=100_000)
    mode: str = "simulate"
    inputs: dict = Field(default_factory=dict)
    trusted: bool = False


class RerunBody(BaseModel):
    trusted: bool = False


class ResumeBody(BaseModel):
    payload: Optional[dict] = None
    park: Optional[str] = None


class Decision(BaseModel):
    approved: bool
    approval: str


def _begin(doc, task: str, mode: str, inputs: dict, trusted: bool) -> dict:
    if mode not in MODES:
        raise HTTPException(status_code=400, detail="mode must be simulate or claude")
    if not any(n.kind == "start" for n in doc.nodes):
        raise HTTPException(status_code=422, detail="graph has no start node")
    if not trusted and (mode == "claude" or rt.has_tools(doc)):
        raise HTTPException(status_code=403, detail="trust this workspace in Preferences to run Claude or tool nodes")
    if not agent.mode_available(mode):
        raise HTTPException(status_code=409, detail="the claude command was not found on this computer; install Claude Code or use the simulator")
    try:
        run = manager.start(doc, task, inputs, mode, trusted)
    except rt.GraphError as err:
        raise HTTPException(status_code=403, detail=str(err))
    return {"run_id": run.id, "status": run.status, "mode": mode}


@router.get("/runs/env")
def env() -> dict:
    return agent.environment()


@router.get("/runs/tools")
async def list_tools() -> dict:
    return {"tools": await tools.catalog(), "approval": sorted(tools.ALWAYS_APPROVE)}


@router.get("/runs/approvals")
def approvals() -> dict:
    return {"approvals": manager.approvals(_root())}


@router.post("/runs/approvals/{run_id}", dependencies=[Depends(require_window)])
def decide(run_id: str, body: Decision) -> dict:
    _root()
    if not manager.decide(run_id, body.approval, body.approved):
        raise HTTPException(status_code=404, detail="no such pending approval")
    return {"approved": body.approved, "approval": body.approval}


@router.post("/runs", dependencies=[Depends(require_window)])
async def start_run(body: StartRun) -> dict:
    _root()
    return _begin(_doc(body.doc), body.task, body.mode, body.inputs, body.trusted)


@router.get("/runs")
def list_runs() -> dict:
    root = _root()
    return {"runs": manager.history(root)}


def _detail(run_id: str) -> dict:
    root = _root()
    live = manager.runs.get(run_id)
    if live is not None and live.root == root:
        d = live.detail()
        d["events"] = d.pop("events_list")
        return d
    data = manager.read_disk(root, run_id)
    if data is None:
        raise HTTPException(status_code=404, detail="no such run")
    return {"id": data.get("id", run_id), "status": data.get("status", "?"), "task": data.get("task", ""),
            "name": data.get("name", ""), "mode": data.get("mode", ""), "created": data.get("created", 0),
            "events": data.get("events", []), "nodes": data.get("nodes", {}), "doc": data.get("doc"),
            "parked_on": None, "parks": [], "usage": data.get("usage")}


@router.get("/runs/{run_id}")
def run_detail(run_id: str) -> dict:
    return _detail(run_id)


@router.get("/runs/{run_id}/events")
def run_events(run_id: str, after: int = 0) -> dict:
    d = _detail(run_id)
    return {"status": d["status"], "parked_on": d["parked_on"], "events": [e for e in d["events"] if e.get("seq", 0) > after]}


@router.get("/runs/{run_id}/nodes/{node_id}")
def run_node(run_id: str, node_id: str) -> dict:
    d = _detail(run_id)
    return {"status": d["status"], "visits": d["nodes"].get(node_id, []), "events": [e for e in d["events"] if e.get("node_id") == node_id]}


@router.get("/runs/{run_id}/stream")
async def run_stream(run_id: str):
    root = _root()
    run = manager.runs.get(run_id)
    if run is None or run.root != root:
        raise HTTPException(status_code=404, detail="no such run")
    queue: asyncio.Queue = asyncio.Queue()
    run.queues.append(queue)
    status = lambda: json.dumps({"seq": -1, "phase": "_status", "note": run.status, "run_id": run_id, "node_id": "", "label": "", "kind": ""}) + "\n"

    async def gen():
        try:
            for ev in list(run.events):
                yield json.dumps(ev) + "\n"
            yield status()
            if run.status in TERMINAL:
                return
            while True:
                ev = await queue.get()
                if ev is None:
                    yield status()
                    return
                yield json.dumps(ev) + "\n"
        finally:
            if queue in run.queues:
                run.queues.remove(queue)

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/runs/{run_id}/rerun", dependencies=[Depends(require_window)])
async def rerun(run_id: str, body: Optional[RerunBody] = None) -> dict:
    d = _detail(run_id)
    if not d.get("doc"):
        raise HTTPException(status_code=404, detail="no stored graph to run again")
    out = _begin(_doc(d["doc"]), d.get("task", ""), d.get("mode") or "simulate", {}, bool(body and body.trusted))
    out["rerun_of"] = run_id
    return out


@router.post("/runs/{run_id}/resume", dependencies=[Depends(require_window)])
def resume_run(run_id: str, body: Optional[ResumeBody] = None) -> dict:
    if not manager.resume(run_id, (body.payload if body else None) or {}, body.park if body else None):
        raise HTTPException(status_code=409, detail="run is not parked")
    return {"status": "running"}


@router.post("/runs/{run_id}/cancel", dependencies=[Depends(require_window)])
def cancel_run(run_id: str) -> dict:
    if not manager.cancel(run_id):
        raise HTTPException(status_code=409, detail="run is not active")
    return {"status": "cancelling"}


@router.delete("/runs/{run_id}", dependencies=[Depends(require_window)])
async def delete_run(run_id: str) -> dict:
    if not manager.delete(_root(), run_id):
        raise HTTPException(status_code=409, detail="run is active or missing")
    return {"deleted": run_id}
