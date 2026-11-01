from typing import Optional

from app.services.cogentics.model import Channel, Member, is_worker


class RouteMixin:
    def _latest_finalized_worker(self, ch: Channel,
                                 before_seq: int) -> Optional[Member]:
        for prev in reversed(ch.messages):
            if prev["seq"] >= before_seq:
                continue
            if prev.get("status") != "final" or prev.get("ack"):
                continue
            m = ch.member(prev["author"])
            if m and is_worker(m):
                return m
        return None

    def _recipients(self, ch: Channel, msg: dict) -> list[Member]:
        if msg["kind"] in ("system", "approval") or msg["author"] == "system":
            return []
        if msg.get("ack"):
            return []
        if msg["kind"] == "run" and not (msg.get("body") or "").strip():
            return []
        names = [h for h in msg.get("mentions", []) if h != msg["author"]]
        if not names:
            author = ch.member(msg["author"])
            if author and author.kind == "human":
                fallback = self._latest_finalized_worker(ch, msg["seq"])
                if fallback:
                    names = [fallback.handle]
            else:
                trigger = msg.get("trigger_author")
                if trigger and trigger != msg["author"]:
                    t = ch.member(trigger)
                    if t and is_worker(t):
                        names = [trigger]
        out = []
        for h in names:
            m = ch.member(h)
            if m and is_worker(m):
                out.append(m)
        return out

    def _braked(self, ch: Channel, hops: int) -> bool:
        brake = int(ch.config.get("turn_brake", 0) or 0)
        return brake > 0 and hops >= brake

    def _hold(self, ch: Channel, m: Member, delivery: dict, why: str) -> None:
        m.held.append(delivery)
        self._save(ch)
        self._system(ch, f"#{delivery['seq']} held for @{m.handle}: {why} "
                         f"· release from the member rail")
        self._broadcast(ch.name, {"type": "member_state", "handle": m.handle,
                                  "state": m.state, "held": len(m.held)})

    def _dispatch(self, ch: Channel, m: Member, delivery: dict) -> None:
        if self._braked(ch, delivery.get("hops", 0)) and \
                not delivery.pop("released", False):
            brake = int(ch.config.get("turn_brake", 0) or 0)
            self._hold(ch, m, delivery,
                       f"turn brake ({brake} consecutive agent turns)")
            return
        if m.state != "active":
            m.pending.append(delivery)
            self._save(ch)
            return
        self._enqueue(ch, m, delivery)

    def release_held(self, ch: Channel, handle: str) -> int:
        m = ch.member(handle)
        if not m:
            return 0
        held, m.held = m.held, []
        self._save(ch)
        for d in held:
            d["released"] = True
            self._dispatch(ch, m, d)
        self._broadcast(ch.name, {"type": "member_state", "handle": handle,
                                  "state": m.state, "held": 0})
        return len(held)

    def _route(self, ch: Channel, msg: dict) -> None:
        recipients = self._recipients(ch, msg)
        if not recipients:
            return
        agents = [m for m in recipients if is_worker(m)]
        if len(agents) >= 2 and not msg.get("group"):
            self._start_group(ch, msg, agents)
            return
        delivery = {"seq": msg["seq"], "hops": msg.get("hops", 0),
                    "trigger_author": msg["author"]}
        for m in recipients:
            self._dispatch(ch, m, dict(delivery))

    def _enqueue(self, ch: Channel, m: Member, delivery: dict) -> None:
        key = (ch.name, m.handle)
        self._inbox.setdefault(key, []).append(delivery)
        if self._busy.get(key):
            self._broadcast(ch.name, {"type": "member_state",
                                      "handle": m.handle, "state": "queued",
                                      "depth": len(self._inbox[key])})
            return
        self._busy[key] = True
        self._spawn(self._drain(ch, m))

    async def _drain(self, ch: Channel, m: Member) -> None:
        key = (ch.name, m.handle)
        try:
            while self._inbox.get(key):
                q = self._inbox[key]
                first_group = q[0].get("group")
                cut = 1 if first_group else next(
                    (i for i, d in enumerate(q) if d.get("group")), len(q))
                batch, self._inbox[key] = q[:cut], q[cut:]
                self._broadcast(ch.name, {"type": "member_state",
                                          "handle": m.handle,
                                          "state": "running"})
                payload = self._compose_batch(ch, m, batch)
                hops = max(d["hops"] for d in batch)
                trigger = batch[-1]["trigger_author"]
                await self._turn(ch, m, payload, hops, trigger,
                                 group=batch[0].get("group"),
                                 grp_round=batch[0].get("round", 0))
        finally:
            self._busy[key] = False
            self._broadcast(ch.name, {"type": "member_state",
                                      "handle": m.handle,
                                      "state": "idle"})

    def _msg_by_seq(self, ch: Channel, seq: int) -> Optional[dict]:
        for prev in ch.messages:
            if prev["seq"] == seq:
                return prev
        return None
