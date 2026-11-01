import asyncio
import json
import os
from typing import Awaitable, Callable

from app.core import workspace_root as ws
from app.core.binres import find_bin
from app.services.runs import worktree

Emit = Callable[[str, str | None], Awaitable[None]]

PERMISSIONS = {
    "read": ("default", "Read,Grep,Glob"),
    "edit": ("acceptEdits", "Read,Grep,Glob,Edit,Write"),
    "plan": ("plan", "Read,Grep,Glob"),
    "none": ("default", ""),
}
DEFAULT_PERMISSION = "read"
DEFAULT_TIMEOUT = 600
OUTPUT_MAX = 20_000
LINE_LIMIT = 8 * 1024 * 1024
TOKEN_PAUSE = 0.02

EVALUATOR_NOTE = (
    "You are an evaluator closing a feedback loop. After your analysis, end your reply with exactly one line:\n"
    "VERDICT: accept\nor\nVERDICT: revise\nfollowed by nothing else. If revising, include concrete feedback above the verdict line."
)


class AgentError(Exception):
    pass


def claude_path() -> str | None:
    return find_bin("claude")


def parse_verdict(output: str) -> str:
    for line in reversed(output.strip().splitlines()):
        line = line.strip().lower()
        if line.startswith("verdict:"):
            return "accept" if line.split(":", 1)[1].strip().startswith("accept") else "revise"
    return "accept"


def build_prompt(task: str, context: str) -> str:
    return f"Task: {task}\n\nContext from prior nodes:\n{context or '(none)'}"


def build_argv(exe: str, cfg: dict, role: str, evaluator: bool) -> list[str]:
    perm = cfg.get("permission")
    mode, tools = PERMISSIONS.get(perm if isinstance(perm, str) else "", PERMISSIONS[DEFAULT_PERMISSION])
    argv = [exe, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--no-session-persistence", "--setting-sources", "user", "--strict-mcp-config", "--disable-slash-commands", "--permission-mode", mode, "--tools", tools]
    model = cfg.get("model")
    if isinstance(model, str) and model.strip():
        argv += ["--model", model.strip()]
    system = role.strip()
    if evaluator:
        system = (system + "\n\n" + EVALUATOR_NOTE).strip()
    if system:
        argv += ["--append-system-prompt", system]
    return argv


async def run_claude(*, role: str, task: str, context: str, cfg: dict, evaluator: bool, emit: Emit, procs: set) -> str:
    async with worktree.write_slot(procs, cfg):
        return await _run_claude(role=role, task=task, context=context, cfg=cfg, evaluator=evaluator, emit=emit, procs=procs)


async def _run_claude(*, role: str, task: str, context: str, cfg: dict, evaluator: bool, emit: Emit, procs: set) -> str:
    exe = claude_path()
    if not exe:
        raise AgentError("the claude command was not found on this computer; install Claude Code or run with the simulator")
    argv = build_argv(exe, cfg, role, evaluator)
    try:
        timeout = max(10.0, float(cfg.get("timeout_s") or DEFAULT_TIMEOUT))
    except (TypeError, ValueError):
        timeout = float(DEFAULT_TIMEOUT)
    try:
        cwd, extra, env = await worktree.prepare(procs, ws.real_root())
    except worktree.WorktreeError as err:
        raise AgentError(str(err)[:400])
    proc = await asyncio.create_subprocess_exec(
        *argv, *extra, cwd=cwd, env=env, stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, limit=LINE_LIMIT)
    procs.add(proc)
    state = {"text": "", "final": None, "error": None, "streamed": False}

    async def feed() -> None:
        assert proc.stdin is not None
        try:
            proc.stdin.write(build_prompt(task, context).encode("utf-8"))
            await proc.stdin.drain()
            proc.stdin.close()
        except (BrokenPipeError, ConnectionResetError):
            pass

    async def read() -> None:
        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").strip()
            if line.startswith("{"):
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if isinstance(event, dict):
                    await handle(event)

    async def handle(event: dict) -> None:
        kind = event.get("type")
        if kind == "stream_event":
            inner = event.get("event") or {}
            delta = inner.get("delta") or {}
            if inner.get("type") == "content_block_delta" and delta.get("type") == "text_delta" and delta.get("text"):
                state["streamed"] = True
                state["text"] += delta["text"]
                await emit("delta", delta["text"])
        elif kind == "assistant":
            content = (event.get("message") or {}).get("content")
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "tool_use":
                        await emit("tool", f"{block.get('name')} {json.dumps(block.get('input'), default=str)[:160]}")
                    elif block.get("type") == "text" and not state["streamed"] and block.get("text"):
                        state["text"] += block["text"]
                        await emit("delta", block["text"])
            state["streamed"] = False
        elif kind == "result":
            result = event.get("result")
            state["final"] = result if isinstance(result, str) else None
            if event.get("is_error") or str(event.get("subtype") or "").startswith("error"):
                state["error"] = str(result or event.get("subtype") or "the model run failed")
            usage = event.get("usage") or {}
            used = (usage.get("input_tokens") or 0) + (usage.get("cache_read_input_tokens") or 0) + (usage.get("cache_creation_input_tokens") or 0)
            await emit("usage", json.dumps({
                "model": str(cfg.get("model") or "default"),
                "prompt": int(used), "completion": int(usage.get("output_tokens") or 0),
                "cost": event.get("total_cost_usd")}))

    async def drain_err() -> str:
        assert proc.stderr is not None
        data = await proc.stderr.read()
        return data.decode("utf-8", "replace")[-2000:]

    try:
        results = await asyncio.wait_for(asyncio.gather(feed(), read(), drain_err()), timeout)
        code = await proc.wait()
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise AgentError(f"the model run timed out after {int(timeout)}s")
    except asyncio.CancelledError:
        proc.kill()
        await proc.wait()
        raise
    finally:
        procs.discard(proc)
    err_text = results[2]
    if state["error"]:
        raise AgentError(state["error"][:400])
    if code != 0 and not state["final"] and not state["text"]:
        raise AgentError((err_text.strip() or f"claude exited with code {code}")[:400])
    return (state["final"] if state["final"] is not None else state["text"]).strip()[:OUTPUT_MAX]


async def run_simulated(*, label: str, task: str, context: str, evaluator: bool, revise: bool, emit: Emit) -> str:
    head = f"(simulated) {label} read the task: {task[:60] or 'no task given'}."
    if context:
        head += f" It received {len(context)} characters of context."
    verdict = ""
    if evaluator:
        verdict = "\nVERDICT: revise" if revise else "\nVERDICT: accept"
        head += " Needs another pass." if revise else " Looks good."
    text = head + verdict
    for word in text.split(" "):
        await emit("delta", word + " ")
        await asyncio.sleep(TOKEN_PAUSE)
    prompt_tokens = (len(task) + len(context)) // 4
    await emit("usage", json.dumps({"model": "simulator", "prompt": prompt_tokens, "completion": len(text) // 4, "cost": 0}))
    return text


def mode_available(mode: str) -> bool:
    return mode == "simulate" or (mode == "claude" and claude_path() is not None)


def environment() -> dict:
    exe = claude_path()
    return {"claude": bool(exe), "path": exe, "cwd_ok": os.path.isdir(ws.current() or "")}
