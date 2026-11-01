import asyncio
import hashlib
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from app.core import config
from app.core import workspace_root as ws
from app.services.runs import agent as agent_mod
from app.services.runs import rt
from app.services.runs.engine import Engine

KEEP = 400
STALE = ("running", "parked")
TERMINAL = ("done", "failed", "cancelled", "interrupted")
ID_RE = re.compile(r"^[a-f0-9]{10}$")
WATCH_POLL = 1.0
WATCH_FILES = 3000
WATCH_SKIP = {".git", ".subform", "node_modules"}
OUTPUT_KEEP = 20_000
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
    handle: Optional[asyncio.Task] = None
    steps: int = 0
    usage: dict = field(default_factory=lambda: {"prompt_tokens": 0, "completion_tokens": 0, "cost": 0.0, "calls": 0})
    cur_context: str = ""
    inputs: dict = field(default_factory=dict)
    outputs: dict = field(default_factory=dict)
    visits: dict = field(default_factory=dict)
    procs: set = field(default_factory=set)
    eval_count: dict = field(default_factory=dict)
    parks: dict = field(default_factory=dict)
    trusted: bool = False

    @property
    def parked_on(self) -> Optional[dict]:
        first = next(iter(self.parks.values()), None)
        return first.public()["on"] if first else None

    def park_list(self) -> list:
        return [p.public() for p in self.parks.values()]

    def summary(self) -> dict:
        return {"id": self.id, "status": self.status, "task": self.task[:160],
                "name": getattr(self.doc, "name", ""), "mode": self.mode,
                "created": self.created, "events": self.seq,
                "parked_on": self.parked_on, "parks": self.park_list(), "usage": self.usage}

    def detail(self) -> dict:
        return {**self.summary(), "events_list": self.events, "nodes": self.visits,
                "doc": rt.doc_to_dict(self.doc)}


def runs_dir(root: str) -> str:
    key = hashlib.sha1(os.path.realpath(root).encode("utf-8")).hexdigest()[:16]
    return os.path.join(str(config.data_dir()), "runs", key)


class RunManager(Engine):
    def __init__(self) -> None:
        self.runs: dict[str, Run] = {}

    def start(self, doc: Any, task: str, inputs: Optional[dict] = None, mode: str = "", trusted: bool = False) -> Run:
        if isinstance(doc, dict):
            doc = rt.build_doc(doc)
        if mode not in ("simulate", "claude"):
            mode = "claude" if agent_mod.claude_path() else "simulate"
        if not trusted and (mode == "claude" or rt.has_tools(doc)):
            raise rt.GraphError("trust this workspace to run Claude or tool nodes")
        run = Run(id=uuid.uuid4().hex[:10], doc=doc, task=task, mode=mode,
                  root=ws.real_root(), inputs=dict(inputs or {}), trusted=trusted)
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
        run.parks.clear()
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
                run.status = "interrupted"
                self.persist(run)
                if run.handle is not None and not run.handle.done():
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
        if not ID_RE.match(run_id):
            return None
        try:
            with open(os.path.join(runs_dir(root), f"{run_id}.json"), "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        if data.get("status") in STALE and run_id not in self.runs:
            data["status"] = "interrupted"
        data["parked_on"] = None
        return data

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
                    "events": len(data.get("events", [])), "parked_on": None, "parks": [],
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
            if live is not None and live.status in STALE:
                continue
            try:
                os.unlink(path)
                excess -= 1
            except OSError:
                pass

    def delete(self, root: str, run_id: str) -> bool:
        live = self.runs.get(run_id)
        if live is not None and live.status in STALE:
            return False
        self.runs.pop(run_id, None)
        if not ID_RE.match(run_id):
            return False
        try:
            os.unlink(os.path.join(runs_dir(root), f"{run_id}.json"))
            return True
        except OSError:
            return False

    def snapshot_glob(self, run: Run, pattern: str) -> dict:
        rx = rt.glob_regex(pattern)
        found: dict[str, float] = {}
        for here, dirs, files in os.walk(run.root, followlinks=False):
            dirs[:] = [d for d in dirs if d not in WATCH_SKIP and not os.path.islink(os.path.join(here, d))]
            for name in files:
                full = os.path.join(here, name)
                rel = os.path.relpath(full, run.root).replace(os.sep, "/")
                if not rx.match(rel):
                    continue
                try:
                    found[rel] = os.lstat(full).st_mtime
                except OSError:
                    continue
                if len(found) >= WATCH_FILES:
                    return found
        return found

    def arm(self, run: Run, park) -> None:
        on = park.on
        kind = on.get("type")
        if kind == "delay":
            try:
                seconds = max(0.0, float(on.get("seconds") or 0))
            except (TypeError, ValueError):
                seconds = 0.0
            park.watcher = asyncio.get_running_loop().call_later(seconds, lambda: park.settle({"delayed": True}))
        elif kind == "watch":
            pattern = str(on.get("glob") or "**/*")
            if os.path.isabs(pattern) or ".." in pattern.replace("\\", "/").split("/"):
                return
            park.watcher = asyncio.create_task(self.watch(run, park, pattern))

    async def watch(self, run: Run, park, pattern: str) -> None:
        baseline = await asyncio.to_thread(self.snapshot_glob, run, pattern)
        while not park.future.done():
            await asyncio.sleep(WATCH_POLL)
            now = await asyncio.to_thread(self.snapshot_glob, run, pattern)
            changed = sorted(k for k in now if baseline.get(k) != now[k]) + sorted(k for k in baseline if k not in now)
            if changed:
                park.settle({"changed": changed[:20]})
                return

    def stop_watchers(self, run: Run) -> None:
        for park in run.parks.values():
            if park.watcher is not None:
                park.watcher.cancel()
            park.watcher = None

    def resume(self, run_id: str, payload: Optional[dict] = None, park_id: Optional[str] = None) -> bool:
        run = self.runs.get(run_id)
        if run is None or run.status != "parked":
            return False
        targets = [p for p in run.parks.values() if not p.approval and (park_id is None or p.id == park_id)]
        done = False
        for park in targets:
            done = park.settle(payload or {}) or done
        return done

    def decide(self, run_id: str, park_id: str, approved: bool) -> bool:
        run = self.runs.get(run_id)
        park = run.parks.get(park_id) if run is not None else None
        if park is None or not park.approval:
            return False
        return park.settle({"approved": bool(approved)})

    def approvals(self, root: str) -> list[dict]:
        out = []
        for run in self.runs.values():
            if run.root != root or run.status != "parked":
                continue
            for park in run.parks.values():
                if park.approval:
                    out.append({"id": park.id, "run_id": run.id, "node_id": park.node_id, "label": park.label,
                                "tool": park.on.get("tool"), "args": park.on.get("args"), "diff": park.on.get("diff"),
                                "task": run.task[:120], "name": getattr(run.doc, "name", ""), "since": park.since})
        return sorted(out, key=lambda a: a["since"])


manager = RunManager()
