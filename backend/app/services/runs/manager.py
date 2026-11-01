import asyncio
import glob as globmod
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from app.core import workspace_root as ws
from app.services.runs import agent as agent_mod
from app.services.runs import rt
from app.services.runs.engine import Engine

RUNS_DIR = ".subform/runs"
KEEP = 400
TERMINAL = ("done", "failed", "cancelled")
WATCH_POLL = 1.0
WATCH_FILES = 3000
OUTPUT_KEEP = 20_000


@dataclass
class Run:
    id: str
    doc: Any
    task: str
    mode: str
    root: str
    status: str = "running"
    created: float = field(default_factory=time.time)
    seq: int = 0
    events: list = field(default_factory=list)
    queues: list = field(default_factory=list)
    resume_event: asyncio.Event = field(default_factory=asyncio.Event)
    resume_payload: Optional[dict] = None
    parked_on: Optional[dict] = None
    handle: Optional[asyncio.Task] = None
    steps: int = 0
    usage: dict = field(default_factory=lambda: {"prompt_tokens": 0, "completion_tokens": 0, "cost": 0.0, "calls": 0})
    checkpoint: Optional[dict] = None
    cur_context: str = ""
    inputs: dict = field(default_factory=dict)
    outputs: dict = field(default_factory=dict)
    pre_resumed: Optional[dict] = None
    visits: dict = field(default_factory=dict)
    procs: set = field(default_factory=set)
    eval_count: dict = field(default_factory=dict)
    watchers: list = field(default_factory=list)

    def summary(self) -> dict:
        return {"id": self.id, "status": self.status, "task": self.task[:160],
                "name": getattr(self.doc, "name", ""), "mode": self.mode,
                "created": self.created, "events": self.seq,
                "parked_on": self.parked_on, "usage": self.usage}

    def detail(self) -> dict:
        return {**self.summary(), "events_list": self.events, "nodes": self.visits,
                "doc": rt.doc_to_dict(self.doc)}


def runs_dir(root: str) -> str:
    return os.path.join(root, *RUNS_DIR.split("/"))


class RunManager(Engine):
    def __init__(self) -> None:
        self.runs: dict[str, Run] = {}
        self.loaded: set[str] = set()

    def start(self, doc: Any, task: str, inputs: Optional[dict] = None, mode: str = "") -> Run:
        if isinstance(doc, dict):
            doc = rt.build_doc(doc)
        if mode not in ("simulate", "claude"):
            mode = "claude" if agent_mod.claude_path() else "simulate"
        run = Run(id=uuid.uuid4().hex[:10], doc=doc, task=task, mode=mode,
                  root=ws.real_root(), inputs=dict(inputs or {}))
        self.runs[run.id] = run
        self.persist(run)
        run.handle = asyncio.create_task(self.execute(run))
        return run

    async def execute(self, run: Run) -> None:
        try:
            await self.walk(run)
            if run.status == "running":
                run.status = "done"
        except asyncio.CancelledError:
            run.status = "cancelled"
            self.emit(run, None, "halt", "run cancelled")
        except Exception as err:
            run.status = "failed"
            self.emit(run, None, "halt", f"run error: {err}")
        self.finish(run)

    def finish(self, run: Run) -> None:
        self.stop_watchers(run)
        for q in run.queues:
            q.put_nowait(None)
        self.persist(run)
        self.prune(run.root)

    def cancel(self, run_id: str) -> bool:
        run = self.runs.get(run_id)
        if run is None or run.status in TERMINAL:
            return False
        for proc in list(run.procs):
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        if run.handle is not None and not run.handle.done():
            run.handle.cancel()
        return True

    async def shutdown(self) -> None:
        for run in list(self.runs.values()):
            if run.status in ("running", "parked"):
                for proc in list(run.procs):
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
                self.stop_watchers(run)
                if run.status == "parked":
                    self.persist(run)
                elif run.handle is not None and not run.handle.done():
                    run.handle.cancel()

    def tally(self, run: Run, note: str) -> None:
        try:
            u = json.loads(note)
            run.usage["prompt_tokens"] += int(u.get("prompt") or 0)
            run.usage["completion_tokens"] += int(u.get("completion") or 0)
            if u.get("cost") is not None:
                run.usage["cost"] += float(u["cost"])
            run.usage["calls"] += 1
        except (ValueError, TypeError):
            pass

    def emit(self, run: Run, node: Any, phase: str, note: Optional[str] = None) -> None:
        if phase == "usage" and note:
            self.tally(run, note)
        ev = {"seq": run.seq, "run_id": run.id, "node_id": getattr(node, "id", ""),
              "label": getattr(node, "label", "system"), "kind": getattr(node, "kind", "system"),
              "phase": phase, "note": note, "ts": round(time.time(), 3)}
        if phase == "delta":
            ev["seq"] = -1
            for q in run.queues:
                q.put_nowait(ev)
            return
        run.seq += 1
        ev["seq"] = run.seq
        run.events.append(ev)
        for q in run.queues:
            q.put_nowait(ev)

    def begin_visit(self, run: Run, node: Any, context: str, item: Any) -> dict:
        rec = {"n": len(run.visits.get(node.id, [])) + 1, "status": "running", "input": context[:OUTPUT_KEEP],
               "item": item if item is None or isinstance(item, (str, int, float, bool, list, dict)) else str(item),
               "output": None, "error": None, "started": round(time.time(), 3), "ended": None, "seq": run.seq}
        run.visits.setdefault(node.id, []).append(rec)
        return rec

    def end_visit(self, run: Run, rec: dict, output: Optional[str], error: Optional[str]) -> None:
        rec["output"] = None if output is None else output[:OUTPUT_KEEP]
        rec["error"] = error
        rec["status"] = "failed" if error else "done"
        rec["ended"] = round(time.time(), 3)
        rec["seq_end"] = run.seq

    def persist(self, run: Run) -> None:
        try:
            d = runs_dir(run.root)
            os.makedirs(d, exist_ok=True)
            body = {"id": run.id, "status": run.status, "task": run.task, "mode": run.mode,
                    "name": getattr(run.doc, "name", ""), "created": run.created, "seq": run.seq,
                    "parked_on": run.parked_on, "checkpoint": run.checkpoint,
                    "doc": rt.doc_to_dict(run.doc), "usage": run.usage, "events": run.events,
                    "nodes": run.visits, "inputs": run.inputs}
            target = os.path.join(d, f"{run.id}.json")
            temp = target + ".tmp"
            with open(temp, "w", encoding="utf-8") as fh:
                json.dump(body, fh, default=str)
            os.replace(temp, target)
        except OSError:
            pass

    def read_disk(self, root: str, run_id: str) -> Optional[dict]:
        if not run_id.isalnum():
            return None
        try:
            with open(os.path.join(runs_dir(root), f"{run_id}.json"), "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def history(self, root: str) -> list[dict]:
        out: dict[str, dict] = {}
        d = runs_dir(root)
        if os.path.isdir(d):
            for name in os.listdir(d):
                if not name.endswith(".json"):
                    continue
                data = self.read_disk(root, name[:-5])
                if data is None:
                    continue
                out[data.get("id", name[:-5])] = {
                    "id": data.get("id", name[:-5]), "status": data.get("status", "?"),
                    "task": (data.get("task") or "")[:160], "name": data.get("name", ""),
                    "mode": data.get("mode", ""), "created": data.get("created", 0),
                    "events": len(data.get("events", [])), "parked_on": data.get("parked_on"),
                    "usage": data.get("usage")}
        for run in self.runs.values():
            if run.root == root:
                out[run.id] = run.summary()
        return sorted(out.values(), key=lambda r: -(r.get("created") or 0))[:100]

    def prune(self, root: str) -> None:
        d = runs_dir(root)
        try:
            files = sorted((os.path.join(d, n) for n in os.listdir(d) if n.endswith(".json")), key=os.path.getmtime)
        except OSError:
            return
        excess = len(files) - KEEP
        for path in files:
            if excess <= 0:
                break
            live = self.runs.get(os.path.basename(path)[:-5])
            if live is not None and live.status in ("running", "parked"):
                continue
            data = self.read_disk(root, os.path.basename(path)[:-5])
            if data is not None and data.get("status") == "parked":
                continue
            try:
                os.unlink(path)
                excess -= 1
            except OSError:
                pass

    def delete(self, root: str, run_id: str) -> bool:
        live = self.runs.get(run_id)
        if live is not None and live.status in ("running", "parked"):
            return False
        self.runs.pop(run_id, None)
        if not run_id.isalnum():
            return False
        try:
            os.unlink(os.path.join(runs_dir(root), f"{run_id}.json"))
            return True
        except OSError:
            return False

    def sync(self) -> None:
        try:
            root = ws.real_root()
        except ws.Refused:
            return
        if root in self.loaded:
            return
        self.loaded.add(root)
        d = runs_dir(root)
        if not os.path.isdir(d):
            return
        for name in sorted(os.listdir(d)):
            if name.endswith(".json"):
                data = self.read_disk(root, name[:-5])
                if data is not None:
                    self.recover(root, data)

    def recover(self, root: str, data: dict) -> bool:
        if data.get("status") != "parked" or data.get("id") in self.runs or not data.get("checkpoint"):
            return False
        try:
            doc = rt.build_doc(data["doc"])
        except (rt.GraphError, KeyError):
            return False
        run = Run(id=data["id"], doc=doc, task=data.get("task", ""), mode=data.get("mode") or "simulate",
                  root=root, status="parked", created=data.get("created", time.time()))
        run.seq = data.get("seq", len(data.get("events", [])))
        run.events = data.get("events", [])
        run.visits = data.get("nodes") or {}
        run.inputs = data.get("inputs") or {}
        run.usage = data.get("usage") or run.usage
        run.parked_on = data.get("parked_on") or {"type": "manual"}
        run.checkpoint = data.get("checkpoint")
        self.runs[run.id] = run
        run.handle = asyncio.create_task(self.resume_recovered(run))
        self.arm(run, run.parked_on)
        self.emit(run, None, "recovered", f"re-armed after restart; parked on {run.parked_on.get('type')}")
        return True

    async def resume_recovered(self, run: Run) -> None:
        try:
            await run.resume_event.wait()
            run.status = "running"
            run.pre_resumed = run.resume_payload or {}
            run.resume_payload = None
            ckpt = run.checkpoint or {}
            run.parked_on = None
            run.checkpoint = None
            if not ckpt.get("node_id"):
                run.status = "failed"
                self.emit(run, None, "halt", "recovered run had no checkpoint node")
            else:
                await self.walk(run, start_node=ckpt["node_id"], start_context=ckpt.get("context") or "")
                if run.status == "running":
                    run.status = "done"
        except asyncio.CancelledError:
            run.status = "cancelled"
            self.emit(run, None, "halt", "run cancelled")
        except Exception as err:
            run.status = "failed"
            self.emit(run, None, "halt", f"recovery error: {err}")
        self.finish(run)

    def snapshot_glob(self, run: Run, pattern: str) -> dict:
        base = run.root
        found: dict[str, float] = {}
        for path in globmod.iglob(os.path.join(base, pattern), recursive=True):
            rel = os.path.relpath(path, base)
            if rel.split(os.sep)[0] in (".git", ".subform", "node_modules"):
                continue
            try:
                found[rel] = os.path.getmtime(path)
            except OSError:
                continue
            if len(found) >= WATCH_FILES:
                break
        return found

    def arm(self, run: Run, on: dict) -> None:
        kind = on.get("type")
        if kind == "delay":
            elapsed = time.time() - float(on.get("parked_at") or time.time())
            remaining = max(0.0, float(on.get("seconds") or 0) - elapsed)
            run.watchers.append(asyncio.get_running_loop().call_later(remaining, lambda rid=run.id: self.resume(rid, {"delayed": True})))
        elif kind == "watch":
            pattern = str(on.get("glob") or "**/*")
            if os.path.isabs(pattern) or ".." in pattern.replace("\\", "/").split("/"):
                return
            run.watchers.append(asyncio.create_task(self.watch(run, pattern)))

    async def watch(self, run: Run, pattern: str) -> None:
        baseline = await asyncio.to_thread(self.snapshot_glob, run, pattern)
        while run.status == "parked":
            await asyncio.sleep(WATCH_POLL)
            now = await asyncio.to_thread(self.snapshot_glob, run, pattern)
            changed = sorted(k for k in now if baseline.get(k) != now[k]) + sorted(k for k in baseline if k not in now)
            if changed:
                self.resume(run.id, {"changed": changed[:20]})
                return

    def stop_watchers(self, run: Run) -> None:
        for w in run.watchers:
            w.cancel()
        run.watchers.clear()

    def resume(self, run_id: str, payload: Optional[dict] = None) -> bool:
        run = self.runs.get(run_id)
        if run is None or run.status != "parked":
            return False
        run.resume_payload = payload or {}
        run.resume_event.set()
        return True


manager = RunManager()
