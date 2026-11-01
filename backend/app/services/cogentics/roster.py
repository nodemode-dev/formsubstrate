import asyncio
import time
import uuid

from app.services.cogentics.model import WORKER_KINDS, HANDLE_RE, Channel, Member, is_worker, parse_body


class RosterMixin:
    def _mark_roster_stale(self, ch: Channel, except_handle: str = "") -> None:
        for x in ch.members:
            if x.handle != except_handle:
                x.roster_stale = True

    def add_member(self, ch: Channel, handle: str, role_prompt: str,
                   kind: str = "agent", full_access: bool = False,
                   model: str = "") -> Member:
        if not HANDLE_RE.match(handle):
            raise ValueError("handle: lowercase letters, digits, - _")
        if kind not in WORKER_KINDS:
            raise ValueError(f"kind must be one of {WORKER_KINDS}")
        if handle in ("all", "system") or ch.member(handle):
            raise ValueError(f"handle taken or reserved: {handle}")
        m = Member(handle=handle, kind=kind, role_prompt=role_prompt,
                   full_access=full_access, model=model)
        ch.members.append(m)
        self._mark_roster_stale(ch, m.handle)
        self._save(ch)
        self._broadcast(ch.name, {"type": "member", "member": m.to_dict()})
        label = "claude code (cli)" if kind == "claude" else "api agent"
        self._system(ch, f"@{handle} joined the channel as {label}")
        return m

    def set_member_state(self, ch: Channel, handle: str, state: str) -> Member:
        m = ch.member(handle)
        if not m or not is_worker(m):
            raise ValueError(f"no agent member: {handle}")
        m.state = state
        self._save(ch)
        self._broadcast(ch.name, {"type": "member", "member": m.to_dict()})
        if state == "active" and m.pending:
            queued, m.pending = m.pending, []
            self._save(ch)
            for d in queued:
                self._enqueue(ch, m, d)
        return m

    def remove_member(self, ch: Channel, handle: str) -> bool:
        m = ch.member(handle)
        if not m or m.kind == "human":
            return False
        ch.members.remove(m)
        self._save(ch)
        self._broadcast(ch.name, {"type": "member",
                                  "member": {"handle": handle, "removed": True}})
        self._system(ch, f"@{handle} left the channel")
        return True

    def subscribe(self, name: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subs.setdefault(name, set()).add(q)
        return q

    def unsubscribe(self, name: str, q: asyncio.Queue) -> None:
        self._subs.get(name, set()).discard(q)

    def _broadcast(self, name: str, event: dict) -> None:
        for q in self._subs.get(name, set()):
            q.put_nowait(event)

    def _append(self, ch: Channel, msg: dict) -> dict:
        ch.seq += 1
        msg["seq"] = ch.seq
        ch.messages.append(msg)
        self._save_meta(ch)
        self._append_log(ch, msg)
        self._broadcast(ch.name, {"type": "message", "message": msg})
        return msg

    def _system(self, ch: Channel, text: str) -> dict:
        return self._append(ch, {"id": uuid.uuid4().hex[:12], "kind": "system",
                                 "author": "system", "body": text,
                                 "ts": time.time(), "status": "final"})

    def post(self, ch: Channel, author: str, body: str) -> dict:
        who = ch.member(author)
        if not who:
            raise ValueError(f"not a member: {author}")
        handles = {m.handle for m in ch.members}
        parsed = parse_body(body, handles)
        msg = self._append(ch, {
            "id": uuid.uuid4().hex[:12], "kind": "chat", "author": author,
            "body": body, "ts": time.time(), "status": "final",
            "mentions": parsed["mentions"], "refs": parsed["refs"],
            "ledger_refs": parsed["ledger_refs"],
            "unresolved": parsed.get("unresolved", []), "hops": 0})
        self._route(ch, msg)
        return msg
