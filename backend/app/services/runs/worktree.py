import asyncio
import json
import os
from pathlib import Path
from typing import Any, Optional

from app.core import config
from app.services import gates
from app.services import sessions as sv

REGISTRY_NAME = "run-worktrees.json"
EDIT_PERMISSIONS = ("edit", "plan")
AGENT_KINDS = ("agent", "evaluator")
SWEEP_SECONDS = 3.0
STRIPPED_ENV = ("SUBFORM_WINDOW_TOKEN",)
SESSION_SUFFIX = "000"
RUN_ID_LEN = 10

RUN_MCP_SERVERS = ("subform", "formslot")

KEPT: set[str] = set()
_live: dict[str, dict] = {}
_locks: dict[str, asyncio.Lock] = {}
_sweeper: Optional[asyncio.Task] = None


class WorktreeError(Exception):
    pass


def session_id(run_id: str) -> str:
    return sv.RUN_PREFIX + run_id + SESSION_SUFFIX


def run_id_of(target: str) -> str:
    return target[len(sv.RUN_PREFIX): len(sv.RUN_PREFIX) + RUN_ID_LEN]


def needs(doc: Any) -> bool:
    for node in getattr(doc, "nodes", []):
        if node.kind in AGENT_KINDS and (node.config or {}).get("permission") in EDIT_PERMISSIONS:
            return True
    return False


def _registry_file() -> Path:
    return config.data_dir() / REGISTRY_NAME


def _read() -> dict:
    try:
        data = json.loads(_registry_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write(data: dict) -> None:
    target = _registry_file()
    temp = target.with_name(target.name + ".tmp")
    try:
        temp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.replace(temp, target)
    except OSError:
        pass


def _find_run(procs: object) -> Any:
    from app.services.runs.manager import manager

    for run in manager.runs.values():
        if run.procs is procs:
            return run
    return None


def _history_exists(root: str, run_id: str) -> bool:
    from app.services.runs.manager import runs_dir

    return os.path.isfile(os.path.join(runs_dir(root), f"{run_id}.json"))


def _item(run_id: str, entry: dict, state: str, notes: list[str]) -> dict:
    return {
        "id": session_id(run_id), "kind": sv.RUN_KIND, "runId": run_id,
        "title": str(entry.get("title") or f"Run {run_id}")[:120],
        "repo": entry["repo"], "repoName": entry["repoName"], "branch": entry["branch"], "base": entry.get("base") or "HEAD",
        "permissionMode": "acceptEdits", "worktree": entry["worktree"], "mode": "headless", "state": state,
        "terminalId": None, "claudeSessionId": None, "created": entry["created"], "updated": entry["created"],
        "lastMessage": entry.get("title"), "notes": notes,
    }


def restore(target: str) -> None:
    run_id = run_id_of(target)
    if session_id(run_id) != target or target in sv._sessions:
        return
    entry = _read().get(run_id)
    if not isinstance(entry, dict) or not all(isinstance(entry.get(k), str) for k in ("repo", "repoName", "branch", "worktree", "created", "root")):
        return
    if not os.path.isdir(entry["worktree"]):
        return
    from app.services.runs.manager import manager

    live = manager.runs.get(run_id)
    state = "working" if live is not None and live.status in ("running", "parked") else "done"
    sv.register_target(_item(run_id, entry, state, []))
    _start_sweeper()


def _run_args(item: dict) -> list[str]:
    args = sv.mcp_args(item)
    try:
        full = json.loads((Path(item["worktree"]) / sv.MCP_DIR / sv.MCP_NAME).read_text(encoding="utf-8"))
        servers = full.get("mcpServers") if isinstance(full, dict) else {}
        kept = {k: v for k, v in (servers or {}).items() if k in RUN_MCP_SERVERS}
        target = Path(args[3]).with_name(f"run-{item['runId']}-mcp.json")
        target.write_text(json.dumps({"mcpServers": kept}, indent=2), encoding="utf-8")
        args[1] = str(target)
    except (OSError, ValueError, IndexError, AttributeError):
        return args[2:]
    return args


async def ensure(run: Any) -> dict:
    lock = _locks.setdefault(run.id, asyncio.Lock())
    async with lock:
        current = _live.get(run.id)
        if current is not None:
            return current
        try:
            top, name, path, notes = await sv.prepare_worktree(run.root, "HEAD", f"run-{run.id}", f"sf/run-{run.id}")
        except sv.Refused as err:
            raise WorktreeError("a node with edit or plan permission runs in its own git worktree, which could not be made: " + err.detail)
        entry = {"repo": top, "repoName": name, "branch": f"sf/run-{run.id}", "base": "HEAD", "worktree": str(path),
                 "created": sv._now(), "root": run.root, "title": f"{getattr(run.doc, 'name', 'graph')} run {run.id}"}
        item = _item(run.id, entry, "working", notes)
        sv.register_target(item)
        env = gates.session_env(item)
        current = {"item": item, "env": env, "args": _run_args(item)}
        _live[run.id] = current
        data = _read()
        data[run.id] = entry
        _write(data)
        _start_sweeper()
        return current


async def prepare(procs: object, root: str) -> tuple[str, list[str], dict[str, str]]:
    env = {k: v for k, v in os.environ.items() if k not in STRIPPED_ENV}
    run = _find_run(procs)
    if run is None or not needs(run.doc):
        return root, [], env
    current = await ensure(run)
    env.update(current["env"])
    return current["item"]["worktree"], list(current["args"]), env


def _finish(run_id: str, state: str) -> None:
    current = _live.get(run_id)
    item = current["item"] if current is not None else sv._sessions.get(session_id(run_id))
    if item is None or item.get("state") not in ("working", "needs-input"):
        return
    item["state"] = state
    gates.close_session(item["id"])


async def discard(run_id: str) -> None:
    sid = session_id(run_id)
    entry = _read().get(run_id)
    path = entry.get("worktree") if isinstance(entry, dict) else None
    if isinstance(path, str) and os.path.isdir(path):
        code, out, _ = await sv._run([sv._git(), "status", "--porcelain"], cwd=path)
        if code != 0 or out.strip():
            KEPT.add(run_id)
            return
    gates.close_session(sid)
    _live.pop(run_id, None)
    _locks.pop(run_id, None)
    sv.drop_target(sid)
    if isinstance(entry, dict):
        repo = entry.get("repo")
        cwd = repo if isinstance(repo, str) and os.path.isdir(repo) else None
        if cwd is not None:
            if isinstance(path, str) and os.path.isdir(path):
                await sv._run([sv._git(), "worktree", "remove", path], cwd=cwd)
            await sv._run([sv._git(), "worktree", "prune"], cwd=cwd)
            await sv._run([sv._git(), "branch", "-d", str(entry.get("branch"))], cwd=cwd)
    data = _read()
    if data.pop(run_id, None) is not None:
        _write(data)


async def sweep() -> None:
    from app.services.runs.manager import manager

    for run_id, entry in list(_read().items()):
        if not isinstance(entry, dict) or not isinstance(entry.get("root"), str):
            continue
        run = manager.runs.get(run_id)
        if run is not None:
            if run.status == "done":
                _finish(run_id, "done")
            elif run.status == "failed":
                _finish(run_id, "failed")
            elif run.status in ("cancelled", "interrupted"):
                _finish(run_id, "stopped")
            continue
        if run_id not in KEPT and not _history_exists(entry["root"], run_id):
            await discard(run_id)


async def _loop() -> None:
    while True:
        try:
            await sweep()
        except Exception:
            pass
        await asyncio.sleep(SWEEP_SECONDS)


def start_sweeper() -> None:
    _start_sweeper()


def _start_sweeper() -> None:
    global _sweeper
    if _sweeper is not None and not _sweeper.done():
        return
    try:
        _sweeper = asyncio.get_running_loop().create_task(_loop())
    except RuntimeError:
        _sweeper = None
