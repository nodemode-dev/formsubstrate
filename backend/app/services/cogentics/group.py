import uuid
from typing import Optional

from app.services.cogentics.model import ACK, Channel, Member, is_worker


class GroupMixin:
    def _start_group(self, ch: Channel, msg: dict, agents: list[Member]) -> None:
        gid = uuid.uuid4().hex[:8]
        ch.groups.append({"id": gid, "root": msg["seq"], "round": 1,
                          "participants": [a.handle for a in agents],
                          "results": {}, "status": "open"})
        self._save(ch)
        self._system(ch, f"group {gid} round 1: "
                         + " ".join(f"@{a.handle}" for a in agents)
                         + f" run independently on #{msg['seq']}; results "
                           "bundle when every participant finishes")
        for a in agents:
            self._dispatch(ch, a, {"seq": msg["seq"],
                                   "hops": msg.get("hops", 0),
                                   "trigger_author": msg["author"],
                                   "group": gid, "round": 1})

    def _group(self, ch: Channel, gid: str) -> Optional[dict]:
        for g in ch.groups:
            if g["id"] == gid:
                return g
        return None

    def _compose_group_round(self, ch: Channel, m: Member, d: dict) -> str:
        g = self._group(ch, d["group"])
        root = self._msg_by_seq(ch, g["root"]) if g else None
        if not g or not root:
            return ""
        head = (f"[cogentics group={g['id']} round={d.get('round', 1)} "
                f"channel={ch.name}\n root=#{g['root']} · "
                f"you=@{m.handle}]\n\n"
                f"--- group request #{g['root']} · @{root['author']} ---\n"
                f"{root.get('body') or ''}\n--- end group request ---\n")
        prior = g.get("prior_results") or []
        n = len(prior)
        for i, r in enumerate(prior, 1):
            head += (f"\n--- completed round {d.get('round', 1) - 1} result "
                     f"{i}/{n} · @{r['handle']} · {r['status']}"
                     + (f" · #{r['seq']}" if r.get("seq") else "")
                     + f" ---\n{r['text']}\n--- end result ---\n")
        head += (
            "\n[group routing: all participants in this round run "
            "independently. Your final reply posts to the channel "
            "immediately; peers receive every terminal result together only "
            "as the next-round context after this round ends. An @mention in "
            "your final response starts another group round, so use one only "
            "when you genuinely intend to invoke that member; write a plain "
            "name without @ when merely discussing them. If no substantive "
            f"onward response is needed, respond with exactly {ACK}.]\n")
        return head

    def _group_record(self, ch: Channel, run: dict, status: str,
                      text: str, mentions: list[str]) -> None:
        g = self._group(ch, run.get("group") or "")
        if not g or g["status"] != "open":
            return
        handle = run["author"]
        if handle not in g["participants"]:
            return
        g["results"][handle] = {
            "handle": handle, "status": status,
            "seq": run["seq"] if status == "completed" else None,
            "text": text if status == "completed" else
            (text or f"[No final response. The run {status}.]"),
            "mentions": mentions}
        if len(g["results"]) < len(g["participants"]):
            self._save(ch)
            return
        ordered = [g["results"][h] for h in g["participants"]
                   if h in g["results"]]
        nxt: list[str] = []
        for r in ordered:
            for h in r.get("mentions", []):
                mem = ch.member(h)
                if mem and is_worker(mem) and h not in nxt:
                    nxt.append(h)
        if not nxt:
            g["status"] = "closed"
            self._save(ch)
            self._system(ch, f"group {g['id']} closed after round "
                             f"{g['round']}: no onward mentions")
            return
        g["prior_results"] = [
            {k: r[k] for k in ("handle", "status", "seq", "text")}
            for r in ordered]
        g["round"] += 1
        g["participants"] = nxt
        g["results"] = {}
        self._save(ch)
        self._system(ch, f"group {g['id']} round {g['round']}: "
                         + " ".join(f"@{h}" for h in nxt)
                         + " receive the full result bundle")
        hops = run.get("hops", 0)
        for h in nxt:
            mem = ch.member(h)
            if mem:
                self._dispatch(ch, mem, {
                    "seq": g["root"], "hops": hops,
                    "trigger_author": run["author"],
                    "group": g["id"], "round": g["round"]})
