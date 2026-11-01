import asyncio
import json
import re
import subprocess
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from app.core import workspace_root as ws
from app.services.cogentics import checkpoints, usage
from app.services.cogentics.llm import Client
from app.services.cogentics.paths import root as ws_root, safe_target

Emit = Callable[[str, Optional[str]], Awaitable[None]]
ToolExec = Callable[[str, dict], Awaitable[Any]]

MAX_ITERATIONS = 24
CONTEXT_BUDGET = 24000
SKIP_DIRS = {".git", "node_modules", "venv", ".venv", "__pycache__", "dist", "target", ".subform"}
SIM_WRITE = re.compile(r"simulate:write\s+(\S+)")
SIM_SEARCH = re.compile(r"simulate:search\s+(\S+)")
SIM_SHELL = re.compile(r"simulate:shell\s+(.+)")


def list_files(max_files: int = 500) -> list[str]:
    base = ws_root()
    out: list[str] = []
    for p in sorted(base.rglob("*")):
        rel = p.relative_to(base)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if p.is_file():
            out.append(rel.as_posix())
            if len(out) >= max_files:
                break
    return out


def read_file(path: str, max_bytes: int = 200_000) -> str:
    real, _ = ws.resolve(path)
    return Path(real).read_bytes()[:max_bytes].decode("utf-8", errors="replace")


def write_file(path: str, content: str) -> dict:
    target, rel = safe_target(path)
    checkpoints.record_change(ws_root(), rel, "write")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return {"written": rel}


def run_shell(command: str, timeout: int = 60) -> dict:
    proc = subprocess.run(command, shell=True, cwd=str(ws_root()), capture_output=True, text=True, timeout=timeout)
    return {"returncode": proc.returncode, "stdout": proc.stdout[-20_000:], "stderr": proc.stderr[-20_000:]}


def _obj(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required}


BUILTIN = {
    "list_files": ("List files in the shared workspace.", _obj({}, []), list_files),
    "read_file": ("Read a file from the workspace.", _obj({"path": {"type": "string", "description": "relative path"}}, ["path"]), read_file),
    "write_file": ("Create or overwrite a file in the workspace.", _obj({"path": {"type": "string"}, "content": {"type": "string"}}, ["path", "content"]), write_file),
    "run_shell": ("Run a shell command in the workspace (60s timeout).", _obj({"command": {"type": "string"}}, ["command"]), run_shell),
}


class Tools:
    def __init__(self) -> None:
        self.extra: dict[str, tuple[str, dict, Callable[..., Any]]] = {}

    def register(self, name: str, description: str, parameters: dict, fn: Callable[..., Any]) -> None:
        self.extra[name] = (description, parameters, fn)

    def _all(self) -> dict:
        return {**BUILTIN, **self.extra}

    def definitions(self) -> list[dict]:
        return [{"type": "function", "function": {"name": n, "description": d, "parameters": p}}
                for n, (d, p, _) in self._all().items()]

    def call(self, name: str, args: dict) -> Any:
        entry = self._all().get(name)
        if not entry:
            return {"error": f"unknown tool: {name}"}
        try:
            return entry[2](**args)
        except (ws.Refused, OSError, TypeError, ValueError, subprocess.SubprocessError) as e:
            return {"error": getattr(e, "detail", None) or str(e)}


def tool_result_text(result: Any) -> str:
    if isinstance(result, str):
        return result
    return json.dumps(result, default=str)[:20_000]


def _est_tokens(messages: list[dict]) -> int:
    return len(json.dumps(messages, default=str)) // 4


def _record(msg: dict, scope: str) -> Optional[dict]:
    u = msg.pop("_usage", None) or {}
    m = msg.pop("_model", "") or ""
    if not (u.get("prompt_tokens") or u.get("completion_tokens")):
        return None
    return usage.meter(ws_root()).record(model=m, usage=u, scope=scope)


async def _compact(messages: list[dict], llm: Client, emit: Emit, scope: str) -> list[dict]:
    if len(messages) <= 6:
        return messages
    head, tail = messages[1:-4], messages[-4:]
    dropped = json.dumps(head, default=str)[:16000]
    summary = "(earlier context truncated)"
    try:
        res = await llm.chat([
            {"role": "system", "content": "Summarize this agent conversation fragment in under 200 words. Keep decisions, file paths, tool results that matter, and open questions. Plain text."},
            {"role": "user", "content": dropped}])
        summary = (res.get("content") or summary).strip()
        _record(res, scope)
    except Exception:
        summary = "(earlier context truncated)"
    await emit("compaction", f"compacted {len(head)} messages (~{_est_tokens(head)} tokens) into a summary")
    return [messages[0], {"role": "user", "content": f"[conversation summary]\n{summary}"}, *tail]


async def _tool_call(tc: dict, tools: Tools, emit: Emit, tool_exec: Optional[ToolExec]) -> dict:
    name = tc["function"]["name"]
    try:
        args = json.loads(tc["function"].get("arguments") or "{}")
    except ValueError:
        args = {}
    await emit("tool", f"{name} {json.dumps(args)[:160]}")
    if tool_exec is not None:
        result = await tool_exec(name, args)
    else:
        result = await asyncio.to_thread(tools.call, name, args)
    return {"role": "tool", "tool_call_id": tc.get("id", name), "content": tool_result_text(result)}


async def _simulate(task: str, handle: str, emit: Emit, tool_exec: Optional[ToolExec], scope: str) -> str:
    body = task.split("]", 1)[-1] if task.startswith("[cogentics") else task
    lines = [f"simulated {handle}: received the request."]
    for pat, name, build in (
        (SIM_SEARCH, "channel_search", lambda m: {"channel": re.search(r"channel=([a-z0-9_-]+)", task).group(1) if re.search(r"channel=([a-z0-9_-]+)", task) else "", "query": m.group(1)}),
        (SIM_WRITE, "write_file", lambda m: {"path": m.group(1), "content": f"written by simulated @{handle}\n"}),
        (SIM_SHELL, "run_shell", lambda m: {"command": m.group(1).strip()}),
    ):
        hit = pat.search(body)
        if not hit or tool_exec is None:
            continue
        args = build(hit)
        await emit("tool", f"{name} {json.dumps(args)[:160]}")
        result = await tool_exec(name, args)
        lines.append(f"{name}: {tool_result_text(result)[:160].replace('@', '')}")
    text = "\n".join(lines)
    for chunk in re.findall(r".{1,24}", text, re.S):
        await emit("delta", chunk)
        await asyncio.sleep(0)
    est = max(1, len(task) // 4), max(1, len(text) // 4)
    rec = usage.meter(ws_root()).record(model="simulator", usage={"prompt_tokens": est[0], "completion_tokens": est[1]}, scope=scope)
    await emit("usage", json.dumps({"model": "simulator", "prompt": rec["prompt_tokens"], "completion": rec["completion_tokens"], "cost": rec["cost"]}))
    return text


async def run_agent(*, role_prompt: str, task: str, context: str, handle: str, tools: Tools, llm: Client,
                    emit: Emit, tool_exec: Optional[ToolExec] = None, model: Optional[str] = None,
                    usage_scope: str = "cogentics") -> str:
    if not llm.configured:
        return await _simulate(task, handle, emit, tool_exec, usage_scope)
    messages = [
        {"role": "system", "content": f"{role_prompt.strip()}\n\nYou operate inside a shared workspace with other agents. Use tools to read, write, and run things in the workspace; the files you produce are the deliverable, visible live to the user."},
        {"role": "user", "content": f"Task: {task}\n\nContext:\n{context or '(none)'}"},
    ]
    defs = tools.definitions()

    async def on_delta(text: str) -> None:
        await emit("delta", text)

    for _ in range(MAX_ITERATIONS):
        if _est_tokens(messages) > CONTEXT_BUDGET:
            messages = await _compact(messages, llm, emit, usage_scope)
        try:
            msg = await llm.stream_chat(messages, tools=defs, on_delta=on_delta, model=model)
        except Exception as e:
            await emit("error", f"llm call failed: {e}")
            return f"(agent stopped: llm call failed: {e})"
        rec = _record(msg, usage_scope)
        if rec:
            await emit("usage", json.dumps({"model": rec["model"], "prompt": rec["prompt_tokens"],
                                            "completion": rec["completion_tokens"], "cost": rec["cost"]}))
        calls = msg.get("tool_calls") or []
        if not calls:
            return (msg.get("content") or "").strip()
        messages.append(msg)
        for tc in calls:
            messages.append(await _tool_call(tc, tools, emit, tool_exec))
    return "(agent stopped: tool-iteration budget exhausted)"
