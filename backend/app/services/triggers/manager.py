import asyncio
import hashlib
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path

from app.core import config
from app.core import workspace_root as ws
from app.services.recipes import launch, runs_bridge, store
from app.services.triggers import hooks, watch

log = logging.getLogger("formsubstrate")

KINDS = ("interval", "delay", "watch", "webhook")
ACTIONS = ("run_recipe", "run_graph", "resume")
MIN_INTERVAL = 10
MAX_SECONDS = 30 * 24 * 3600
POLL = 2.0
HISTORY = 12
MAX_TRIGGERS = 50
SAFE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")


class TriggerError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _file(root: str) -> Path:
    digest = hashlib.sha1(os.path.normpath(root).encode("utf-8")).hexdigest()[:16]
    return config.data_dir() / "triggers" / f"{digest}.json"


def _seconds(spec: dict, floor: int) -> float:
    try:
        value = float(spec.get("seconds"))
    except (TypeError, ValueError) as err:
        raise TriggerError(422, "seconds must be a number") from err
    if value < floor or value > MAX_SECONDS:
        raise TriggerError(422, f"seconds must be between {floor} and {MAX_SECONDS}")
    return value


def _clean_action(action: object) -> dict:
    if not isinstance(action, dict) or action.get("kind") not in ACTIONS:
        raise TriggerError(422, "the action kind is run_recipe, run_graph or resume")
    kind = action["kind"]
    if kind == "resume":
        run_id = str(action.get("run_id") or "")
        if not SAFE.match(run_id):
            raise TriggerError(422, "resume needs a run id")
        return {"kind": kind, "run_id": run_id}
    mode = str(action.get("mode") or "simulate")
    if mode not in runs_bridge.MODES:
        raise TriggerError(422, "mode must be simulate or claude")
    name = str(action.get("name") or "")
    if not SAFE.match(name):
        raise TriggerError(422, "the action needs a recipe or graph name")
    if kind == "run_recipe":
        try:
            store.get_recipe(name)
        except store.RecipeError as err:
            raise TriggerError(err.status, err.detail) from err
        inputs = action.get("inputs") if isinstance(action.get("inputs"), dict) else {}
        pulled = action.get("inputs_from_payload")
        return {
            "kind": kind,
            "name": name,
            "mode": mode,
            "recipe_hash": store.content_hash(store.get_recipe(name)),
            "inputs": {str(k)[:40]: str(v)[:20000] for k, v in inputs.items()},
            "inputs_from_payload": [str(k)[:40] for k in pulled][:20] if isinstance(pulled, list) else [],
        }
    return {"kind": kind, "name": name, "mode": mode, "task": str(action.get("task") or "")[:20000], "graph_hash": _graph_hash(name)}


def _graph_text(name: str) -> str | None:
    try:
        path = store.safe_path(f".formsubstrate/graphs/{name}.json")
        if path.is_symlink() or not path.is_file() or path.stat().st_size > store.MAX_BYTES:
            return None
        return path.read_text(encoding="utf-8")
    except (OSError, store.RecipeError):
        return None


def _graph_hash(name: str) -> str:
    text = _graph_text(name)
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text is not None else ""


def _current_hash(action: dict) -> tuple[str, str]:
    if action["kind"] == "run_recipe":
        try:
            now = store.content_hash(store.get_recipe(action["name"]))
        except store.RecipeError:
            now = ""
        return str(action.get("recipe_hash") or ""), now
    return str(action.get("graph_hash") or ""), _graph_hash(action["name"])


class Triggers:
    def __init__(self) -> None:
        self._trusted: set[str] = set()
        self._root: str | None = None
        self._table: dict[str, dict] = {}
        self._anchor: dict[str, float] = {}
        self._scans: dict[str, tuple[dict, float]] = {}
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    def _save(self) -> None:
        if self._root is None:
            return
        target = _file(self._root)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(target.name + ".tmp")
        temp.write_text(json.dumps({"workspace": self._root, "triggers": self._table}, indent=1), encoding="utf-8")
        os.replace(temp, target)

    def _bind(self) -> bool:
        root = ws.current()
        if root == self._root:
            return self._root is not None
        self._root = root
        self._table = {}
        self._anchor = {}
        self._scans = {}
        if root is None:
            return False
        try:
            data = json.loads(_file(root).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        rows = data.get("triggers") if isinstance(data, dict) else None
        now = time.time()
        changed = False
        for tid, trig in (rows.items() if isinstance(rows, dict) else []):
            if not isinstance(trig, dict) or trig.get("kind") not in KINDS or not SAFE.match(str(tid)):
                continue
            self._table[tid] = trig
            self._anchor[tid] = now
            if trig["kind"] == "delay" and trig.get("enabled") and float(trig.get("due", 0)) < now:
                trig["enabled"] = False
                trig["missed"] = True
                changed = True
        if changed:
            self._save()
        return True

    def _need(self) -> None:
        if not self._bind():
            raise TriggerError(409, "no workspace open")

    def set_trust(self, workspace: str, trusted: bool) -> dict:
        root = ws.current()
        if root is None or not workspace or os.path.realpath(workspace) != os.path.realpath(root):
            return {"trusted": self.trusted()}
        key = os.path.realpath(root)
        if trusted:
            self._trusted.add(key)
        else:
            self._trusted.discard(key)
        return {"trusted": trusted}

    def trusted(self) -> bool:
        root = ws.current()
        return root is not None and os.path.realpath(root) in self._trusted

    def confirm(self, tid: str) -> dict:
        self._need()
        trig = self._table.get(tid)
        if trig is None:
            raise TriggerError(404, "unknown trigger")
        action = trig["action"]
        if action["kind"] in ("run_recipe", "run_graph"):
            _, now = _current_hash(action)
            if not now:
                raise TriggerError(404, f"{action['name']} no longer exists")
            action["recipe_hash" if action["kind"] == "run_recipe" else "graph_hash"] = now
        trig.pop("needs_confirm", None)
        self._save()
        return self._present(trig)

    def _present(self, trig: dict) -> dict:
        row = dict(trig)
        row["next_fire"] = self._next(trig)
        if trig["kind"] == "webhook":
            row["path"] = f"/api/hooks/{trig['id']}"
        return row

    def _next(self, trig: dict) -> float | None:
        if not trig.get("enabled"):
            return None
        if trig["kind"] == "interval":
            return self._anchor.get(trig["id"], time.time()) + float(trig["spec"]["seconds"])
        if trig["kind"] == "delay":
            return float(trig.get("due", 0))
        return None

    def snapshot(self) -> dict:
        has = self._bind()
        rows = [self._present(t) for t in sorted(self._table.values(), key=lambda t: t["created"])]
        return {"workspace": self._root, "open": has, "triggers": rows, "min_interval": MIN_INTERVAL}

    def add(self, kind: str, spec: dict, action: dict) -> tuple[dict, str | None]:
        self._need()
        if kind not in KINDS:
            raise TriggerError(422, "kind must be interval, delay, watch or webhook")
        if len(self._table) >= MAX_TRIGGERS:
            raise TriggerError(409, f"at most {MAX_TRIGGERS} triggers per workspace")
        clean_action = _clean_action(action)
        tid = uuid.uuid4().hex[:8]
        now = time.time()
        secret: str | None = None
        if kind == "interval":
            clean = {"seconds": _seconds(spec, MIN_INTERVAL)}
        elif kind == "delay":
            clean = {"seconds": _seconds(spec, 1)}
        elif kind == "watch":
            glob = str(spec.get("glob") or "")
            if not watch.valid_glob(glob):
                raise TriggerError(422, "the watch pattern is a path pattern inside the workspace")
            clean = {"glob": glob}
        else:
            try:
                secret = hooks.create(tid, str(spec.get("secret") or ""))
            except hooks.NoKeyring as err:
                raise TriggerError(503, str(err)) from err
            except hooks.WeakSecret as err:
                raise TriggerError(422, str(err)) from err
            clean = {"signed": True}
        trig = {"id": tid, "kind": kind, "spec": clean, "action": clean_action, "created": now, "fires": 0, "enabled": True, "last_fired": None, "history": []}
        if kind == "delay":
            trig["due"] = now + clean["seconds"]
        self._table[tid] = trig
        self._anchor[tid] = now
        self._save()
        return self._present(trig), secret

    def set_enabled(self, tid: str, enabled: bool) -> dict:
        self._need()
        trig = self._table.get(tid)
        if trig is None:
            raise TriggerError(404, "unknown trigger")
        trig["enabled"] = enabled
        trig.pop("missed", None)
        if enabled:
            self._anchor[tid] = time.time()
            self._scans.pop(tid, None)
            if trig["kind"] == "delay":
                trig["due"] = time.time() + float(trig["spec"]["seconds"])
        self._save()
        return self._present(trig)

    def remove(self, tid: str) -> None:
        self._need()
        trig = self._table.pop(tid, None)
        if trig is None:
            raise TriggerError(404, "unknown trigger")
        self._anchor.pop(tid, None)
        self._scans.pop(tid, None)
        if trig["kind"] == "webhook":
            hooks.forget(tid)
        self._save()

    def webhook(self, tid: str) -> dict:
        self._need()
        trig = self._table.get(tid)
        if trig is None or trig["kind"] != "webhook":
            raise TriggerError(404, "unknown webhook")
        secret = hooks.reveal(tid)
        if secret is None:
            raise TriggerError(503, "the webhook secret is not in the keyring")
        return {"path": f"/api/hooks/{tid}", "header": hooks.HEADER, "timestamp_header": hooks.TS_HEADER, "nonce_header": hooks.NONCE_HEADER, "secret": secret, "signed": "sha256=HMAC(secret, timestamp + '.' + nonce + '.' + body)", "window": hooks.WINDOW}

    async def _act(self, trig: dict, payload: dict) -> dict:
        action = trig["action"]
        kind = action["kind"]
        if kind == "resume":
            if runs_bridge.awaiting_approval(action["run_id"]):
                raise TriggerError(403, "a run waiting for an approval is answered by the owner in the window, never by a trigger")
            ok = runs_bridge.resume(action["run_id"], payload)
            return {"run_id": action["run_id"], "resumed": ok}
        stored, now = _current_hash(action)
        if not now or stored != now:
            trig["needs_confirm"] = True
            raise TriggerError(409, f"{action['name']} changed since this trigger was made; confirm it to run again")
        trusted = self.trusted()
        if kind == "run_recipe":
            inputs = dict(action.get("inputs") or {})
            for key in action.get("inputs_from_payload") or []:
                if key in payload:
                    inputs[key] = store.as_data(payload[key])
            result = await launch.run_recipe(action["name"], inputs, action["mode"], trusted)
            return {"run_id": result["run_id"]}
        text = _graph_text(action["name"])
        try:
            doc = json.loads(text) if text is not None else None
        except ValueError:
            doc = None
        if not isinstance(doc, dict):
            raise TriggerError(404, f"no saved graph {action['name']}")
        try:
            run = runs_bridge.start(doc, str(action.get("task") or ""), action["mode"], {}, trusted)
        except runs_bridge.RunRefused as err:
            raise TriggerError(err.status, err.detail) from err
        return {"run_id": run.id}

    async def fire(self, tid: str, source: str, payload: dict | None = None, force: bool = False) -> dict:
        self._need()
        trig = self._table.get(tid)
        if trig is None:
            raise TriggerError(404, "unknown trigger")
        if not trig.get("enabled") and not force:
            return {"skipped": "disabled"}
        entry: dict = {"at": time.time(), "source": source}
        prior = next((h.get("run_id") for h in trig["history"] if h.get("run_id")), None)
        busy = False
        if prior and not force:
            busy = runs_bridge.status(prior) in runs_bridge.ACTIVE
        if trig.get("needs_confirm"):
            entry["skipped"] = "its target changed since it was made; the owner has to confirm it"
        elif busy:
            entry["skipped"] = "the run this trigger started last is still going"
        else:
            try:
                entry.update(await self._act(trig, payload or {}))
            except (TriggerError, store.RecipeError) as err:
                entry["error"] = err.detail
            except Exception as err:
                log.exception("trigger %s failed", tid)
                entry["error"] = f"{err.__class__.__name__}: {err}"
            trig["fires"] += 1
            trig["last_fired"] = entry["at"]
        rest = trig["history"][1:] if entry.get("skipped") and trig["history"] and trig["history"][0].get("skipped") else trig["history"]
        trig["history"] = [entry, *rest][:HISTORY]
        self._save()
        return entry

    async def tick(self) -> None:
        if not self._bind():
            return
        now = time.time()
        for trig in list(self._table.values()):
            if not trig.get("enabled"):
                continue
            tid, kind = trig["id"], trig["kind"]
            if kind == "interval":
                every = float(trig["spec"]["seconds"])
                if now - self._anchor.get(tid, now) >= every:
                    self._anchor[tid] = now
                    await self.fire(tid, "interval", {"interval": every})
            elif kind == "delay":
                if now >= float(trig.get("due", now + 1)):
                    await self.fire(tid, "delay", {"delay_elapsed": trig["spec"]["seconds"]})
                    self._table.pop(tid, None)
                    self._save()
            elif kind == "watch":
                await self._tick_watch(trig, now)

    async def _tick_watch(self, trig: dict, now: float) -> None:
        tid = trig["id"]
        before, at = self._scans.get(tid, ({}, 0.0))
        if now - at < POLL or self._root is None:
            return
        root = self._root
        after = await asyncio.to_thread(watch.scan, root, trig["spec"]["glob"])
        if tid not in self._table or self._root != root:
            return
        self._scans[tid] = (after, now)
        if at == 0.0:
            return
        moved = watch.changed(before, after)
        if moved:
            await self.fire(tid, "watch", {"changed": moved[:10]})

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(1.0)
            try:
                async with self._lock:
                    await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("trigger loop")

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.get_running_loop().create_task(self._loop())

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


triggers = Triggers()
