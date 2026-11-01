import asyncio
import json
import time
import uuid
from typing import Any, Optional

from app.services.cogentics import agent as agent_mod
from app.services.cogentics import checkpoints
from app.services.cogentics.model import ACK, CLAUDE_TURN_TIMEOUT, Channel, Member, parse_body
from app.services.cogentics.paths import root as ws_root, valid_ref


class TurnsMixin:
    def _spawn(self, coro: Any) -> None:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    def _new_run(self, ch: Channel, m: Member, hops: int, trigger_author: str, group: str, grp_round: int, simulated: bool = False) -> dict:
        return self._append(ch, {
            "id": uuid.uuid4().hex[:12], "kind": "run", "author": m.handle, "body": "",
            "ts": time.time(), "status": "running", "mentions": [], "refs": [], "hops": hops + 1,
            "trigger_author": trigger_author, "group": group, "round": grp_round,
            "started": time.time(), "simulated": simulated})

    async def _turn(self, ch: Channel, m: Member, payload: str, hops: int, trigger_author: str,
                    group: str = "", grp_round: int = 0) -> None:
        if not self.trusted:
            run = self._new_run(ch, m, hops, trigger_author, group, grp_round)
            self._system(ch, f"@{m.handle} did not run: trust this workspace in Preferences first")
            self._finalize_run(ch, run, "", error="workspace is not trusted")
            return
        if m.kind == "claude":
            await self._claude_turn(ch, m, payload, hops, trigger_author, group, grp_round)
        else:
            await self._agent_turn(ch, m, payload, hops, trigger_author, group, grp_round)

    def _finalize_run(self, ch: Channel, run: dict, final: str, error: str = "") -> None:
        member = ch.member(run["author"])
        run.setdefault("ms", int((time.time() - run.get("started", run["ts"])) * 1000))
        grouped = bool(run.get("group"))
        if error:
            run["body"] = ""
            run["status"] = "final"
            run["error"] = error[:600]
            self._save(ch)
            self._broadcast(ch.name, {"type": "finalize", "message": run})
            if grouped:
                self._group_record(ch, run, "failed", "", [])
            return
        if final.strip() == ACK:
            run["body"] = final.strip()
            run["status"] = "final"
            run["ack"] = True
            self._save(ch)
            self._broadcast(ch.name, {"type": "finalize", "message": run})
            if grouped:
                self._group_record(ch, run, "acknowledged", f"[Acknowledged with {ACK}.]", [])
            return
        handles = {x.handle for x in ch.members}
        parsed = parse_body(final, handles)
        if member and parsed["unresolved"]:
            member.misaddressed = True
        routed = run
        if ch.seq > run["seq"]:
            cont = self._append(ch, {
                "id": uuid.uuid4().hex[:12], "kind": "run", "run_parent": run["seq"],
                "author": run["author"], "body": final, "ts": time.time(), "status": "final",
                "mentions": parsed["mentions"], "refs": parsed["refs"],
                "ledger_refs": parsed["ledger_refs"], "unresolved": parsed["unresolved"],
                "hops": run.get("hops", 0), "trigger_author": run.get("trigger_author", ""),
                "group": run.get("group", ""), "round": run.get("round", 0),
                "usage": run.get("usage"), "tools": run.get("tools"), "ms": run.get("ms")})
            run["body"] = ""
            run["status"] = "final"
            run["continued_to"] = cont["seq"]
            routed = cont
        else:
            run["body"] = final
            run["status"] = "final"
            run["mentions"] = parsed["mentions"]
            run["refs"] = parsed["refs"]
            run["ledger_refs"] = parsed["ledger_refs"]
            run["unresolved"] = parsed["unresolved"]
        self._save(ch)
        self._broadcast(ch.name, {"type": "finalize", "message": run})
        if grouped:
            self._group_record(ch, {**routed, "group": run.get("group"), "round": run.get("round", 0)},
                               "completed", final, parsed["mentions"])
            return
        self._route(ch, routed)

    def _claude_cmd(self, ch: Channel, m: Member, payload: str) -> list:
        identity = (f"You are @{m.handle}, a member of the shared channel '{ch.name}'. "
                    "Follow the [conventions] block from your briefing; keep replies short and concrete.")
        sys_prompt = (m.role_prompt + "\n\n" + identity) if m.role_prompt else identity
        cmd = ["claude", "-p", payload, "--output-format", "stream-json", "--verbose",
               "--append-system-prompt", sys_prompt, "--permission-mode",
               "bypassPermissions" if m.full_access else "acceptEdits"]
        if m.model and valid_ref(m.model):
            cmd += ["--model", m.model]
        if m.session_ref and valid_ref(m.session_ref):
            cmd += ["--resume", m.session_ref]
        return cmd

    def _claude_block(self, ch: Channel, run: dict, block: dict, state: dict) -> None:
        if block.get("type") == "text" and block.get("text"):
            state["texts"].append(block["text"])
            self._broadcast(ch.name, {"type": "delta", "seq": run["seq"], "text": block["text"]})
        elif block.get("type") == "tool_use":
            self._broadcast(ch.name, {"type": "tool", "seq": run["seq"], "note": f"claude: {block.get('name', 'tool')}"})

    def _claude_event(self, ch: Channel, run: dict, ev: dict, state: dict) -> None:
        et = ev.get("type")
        if et == "system" and ev.get("session_id"):
            state["session"] = ev["session_id"]
        elif et == "assistant":
            for block in (ev.get("message") or {}).get("content", []):
                self._claude_block(ch, run, block, state)
        elif et == "result":
            state["result"] = ev.get("result") or ""
            state["session"] = ev.get("session_id") or state["session"]

    async def _claude_turn(self, ch: Channel, m: Member, payload: str, hops: int, trigger_author: str,
                           group: str = "", grp_round: int = 0) -> None:
        run = self._new_run(ch, m, hops, trigger_author, group, grp_round)
        cmd = self._claude_cmd(ch, m, payload)
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, cwd=str(ws_root()), stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        except FileNotFoundError:
            self._finalize_run(ch, run, "", error="claude CLI not on PATH")
            self._system(ch, f"@{m.handle} needs the claude CLI on PATH; install Claude Code and run `claude` once to log in")
            return
        state = {"texts": [], "result": "", "session": ""}
        try:
            assert proc.stdout is not None
            while True:
                raw = await asyncio.wait_for(proc.stdout.readline(), timeout=CLAUDE_TURN_TIMEOUT)
                if not raw:
                    break
                try:
                    ev = json.loads(raw.decode("utf-8", "replace").strip() or "null")
                except ValueError:
                    ev = None
                if isinstance(ev, dict):
                    self._claude_event(ch, run, ev, state)
            await asyncio.wait_for(proc.wait(), timeout=30)
        except asyncio.TimeoutError:
            proc.kill()
            self._finalize_run(ch, run, "", error=f"timeout after {CLAUDE_TURN_TIMEOUT}s, killed")
            self._system(ch, f"@{m.handle} turn timed out after {CLAUDE_TURN_TIMEOUT}s and was killed")
            return
        if state["session"] and valid_ref(str(state["session"])):
            m.session_ref = state["session"]
            self._save(ch)
        final = state["result"] or "\n".join(state["texts"]).strip()
        if proc.returncode not in (0, None) and not final:
            err = await proc.stderr.read() if proc.stderr is not None else b""
            detail = err.decode("utf-8", "replace")[:300].strip()
            self._finalize_run(ch, run, "", error=f"exit {proc.returncode}: {detail}")
            self._system(ch, f"@{m.handle} claude exited {proc.returncode}: {detail}")
            return
        self._finalize_run(ch, run, final)

    async def _agent_turn(self, ch: Channel, m: Member, payload: str, hops: int, trigger_author: str,
                          group: str = "", grp_round: int = 0) -> None:
        simulated = not self.llm.configured
        run = self._new_run(ch, m, hops, trigger_author, group, grp_round, simulated)
        facts = {"tools": 0, "prompt": 0, "completion": 0, "cost": 0.0}

        async def emit(phase: str, note: Optional[str]) -> None:
            if phase == "delta" and note:
                self._broadcast(ch.name, {"type": "delta", "seq": run["seq"], "text": note})
            elif phase == "usage" and note:
                try:
                    u = json.loads(note)
                    facts["prompt"] += int(u.get("prompt") or 0)
                    facts["completion"] += int(u.get("completion") or 0)
                    if u.get("cost") is not None:
                        facts["cost"] += float(u["cost"])
                    self._broadcast(ch.name, {"type": "usage", "seq": run["seq"], **u})
                except (ValueError, TypeError):
                    return
            elif phase == "tool" and note:
                facts["tools"] += 1
                self._broadcast(ch.name, {"type": "tool", "seq": run["seq"], "note": note})
            elif phase not in ("delta", "error") and note:
                self._broadcast(ch.name, {"type": "tool", "seq": run["seq"], "note": note})

        prompt = (f"{m.role_prompt}\n\nYou are @{m.handle}, an agent member of the shared channel "
                  f"'{ch.name}'. Follow the [conventions] block from your briefing; keep replies short and concrete.")
        err = ""
        final = ""
        token = checkpoints.enter(f"cog-{ch.name}-{run['seq']}", f"@{m.handle} turn in #{ch.name}", ws_root())
        try:
            final = await agent_mod.run_agent(
                role_prompt=prompt, task=payload, context=self._context(ch, m), handle=m.handle,
                tools=self.tools, llm=self.llm, emit=emit, tool_exec=self._make_tool_exec(ch, m, run),
                model=m.model or None, usage_scope=f"cogentics:{ch.name}:{m.handle}")
            if final.startswith("(agent stopped:"):
                err, final = final, ""
        except Exception as e:
            err, final = str(e), ""
        finally:
            checkpoints.leave(token)
        run["usage"] = {k: facts[k] for k in ("prompt", "completion", "cost")}
        run["tools"] = facts["tools"]
        run["ms"] = int((time.time() - run.get("started", time.time())) * 1000)
        if err:
            self._system(ch, f"@{m.handle} turn failed (evidence on the run): {err[:200]}")
        self._finalize_run(ch, run, final, error=err)
