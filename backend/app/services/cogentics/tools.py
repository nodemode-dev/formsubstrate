import asyncio
import json
import time
import uuid
from pathlib import Path
from typing import Any

from app.core import workspace_root as ws
from app.services.cogentics import checkpoints
from app.services.cogentics.model import Channel, Member

DEFAULT_GATED = ["run_shell"]


class ToolsMixin:
    def _register_search_tool(self) -> None:
        def channel_search(channel: str, query: str, limit: int = 8) -> dict:
            ch = self.channel(channel)
            if not ch:
                return {"error": f"no channel: {channel}"}
            q = query.lower()
            hits = []
            for m in reversed(ch.messages):
                body = m.get("body") or ""
                if q in body.lower() or q in m.get("author", "").lower():
                    hits.append(f"#{m['seq']} @{m['author']}: {body[:300]}")
                    if len(hits) >= max(1, min(int(limit), 25)):
                        break
            return {"channel": channel, "query": query, "matches": list(reversed(hits))}

        self.tools.register(
            "channel_search",
            "Search a cogentics channel's full message history for a substring; returns matching messages as '#N @author: body'. Use this to recover context you were not mentioned in.",
            {"type": "object", "properties": {
                "channel": {"type": "string", "description": "channel name"},
                "query": {"type": "string", "description": "case-insensitive substring"},
                "limit": {"type": "integer", "description": "max matches, default 8"}},
             "required": ["channel", "query"]},
            channel_search)

    def gated_tools(self, ch: Channel) -> list[str]:
        raw = ch.config.get("approval_tools", DEFAULT_GATED)
        return [str(x) for x in raw] if isinstance(raw, list) else list(DEFAULT_GATED)

    def _make_tool_exec(self, ch: Channel, m: Member, run: dict):
        async def tool_exec(name: str, args: dict) -> Any:
            if name in self.gated_tools(ch):
                ok = await self._await_approval(ch, m, run, name, args)
                if not ok:
                    return {"error": f"tool call denied by a human: {name}"}
            return await asyncio.to_thread(self.tools.call, name, args)
        return tool_exec

    async def _await_approval(self, ch: Channel, m: Member, run: dict, tool: str, args: dict) -> bool:
        card: dict = {"tool": tool, "args": json.dumps(args, default=str)[:400]}
        if tool == "write_file" and isinstance(args.get("path"), str):
            try:
                real, rel = ws.resolve(args["path"])
                before = Path(real).read_text(encoding="utf-8", errors="replace") if Path(real).is_file() else ""
            except (ws.Refused, OSError):
                before, rel = "", args["path"]
            card["diff"] = checkpoints.unified_preview(before, str(args.get("content") or ""), rel)
        msg = self._append(ch, {
            "id": uuid.uuid4().hex[:12], "kind": "approval", "author": m.handle, "body": "",
            "ts": time.time(), "status": "open", "card": card, "run_parent": run["seq"],
            "mentions": [], "refs": [], "hops": run.get("hops", 0)})
        self._broadcast(ch.name, {"type": "member_state", "handle": m.handle, "state": "awaiting_input"})
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._approvals[(ch.name, msg["seq"])] = fut
        try:
            approved = bool(await asyncio.wait_for(fut, timeout=3600))
        except asyncio.TimeoutError:
            approved = False
            msg["answer"] = {"approved": False, "by": "timeout", "ts": time.time()}
        finally:
            self._approvals.pop((ch.name, msg["seq"]), None)
        msg["status"] = "answered"
        msg.setdefault("answer", {})
        self._rewrite_log(ch)
        self._save_meta(ch)
        self._broadcast(ch.name, {"type": "card", "message": msg})
        self._broadcast(ch.name, {"type": "member_state", "handle": m.handle, "state": "running"})
        return approved

    def decide_approval(self, ch: Channel, seq: int, approved: bool, by: str = "human") -> bool:
        fut = self._approvals.get((ch.name, seq))
        msg = self._msg_by_seq(ch, seq)
        if not fut or fut.done() or not msg:
            return False
        msg["answer"] = {"approved": approved, "by": by, "ts": time.time()}
        fut.set_result(approved)
        return True

    def pending_approvals(self) -> list[dict]:
        out = []
        for meta in self.list_channels():
            ch = self.channel(meta["name"])
            if not ch:
                continue
            for m in ch.messages:
                if m.get("kind") == "approval" and m.get("status") == "open" and (ch.name, m["seq"]) in self._approvals:
                    out.append({"channel": ch.name, "seq": m["seq"], "author": m["author"], "card": m.get("card", {})})
        return out
