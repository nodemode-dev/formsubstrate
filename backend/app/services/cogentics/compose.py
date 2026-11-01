import re
import time
from pathlib import Path
from typing import Optional

from app.services.cogentics.model import ACK, LEDGER_TAIL, Channel, Member


class ComposeMixin:
    def _ledger_dir(self, ch: Channel) -> Path:
        d = self._dir() / f"{ch.name}-ledger"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _ledger_note(self, ch: Channel, name: str) -> Optional[str]:
        safe = re.sub(r"[^A-Za-z0-9 _.-]", "", name).strip()
        if not safe:
            return None
        f = self._ledger_dir(ch) / f"{safe}.md"
        if not f.exists():
            return None
        try:
            return f.read_text(encoding="utf-8")[:4000]
        except OSError:
            return None

    def _compose_block(self, ch: Channel, msg: dict, you: str) -> str:
        who = ch.member(msg["author"])
        recipients = self._recipients(ch, msg) or [ch.member(you)]
        to = " ".join(f"@{r.handle}" for r in recipients if r)
        ts = time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(msg["ts"]))
        block = (f"[cogentics channel={ch.name} msg=#{msg['seq']} "
                 f"from=@{msg['author']} ({who.kind if who else 'member'})\n"
                 f" to={to} · you=@{you}]\n\n{msg['body']}\n")
        for n in msg.get("refs", []):
            prev = self._msg_by_seq(ch, n)
            if not prev:
                continue
            pts = time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(prev["ts"]))
            block += (f"\n--- referenced #{n} · @{prev['author']} "
                      f"· {pts} ---\n{prev.get('body') or ''}\n"
                      "--- end reference ---\n")
        for name in msg.get("ledger_refs", []):
            note = self._ledger_note(ch, name)
            if note is None:
                continue
            block += (f"\n--- ledger [[{name}]] ---\n{note}\n"
                      "--- end ledger note ---\n")
        return block

    def _briefing(self, ch: Channel, m: Member, untagged_to: str,
                  conventions: bool = True) -> str:
        roster = "\n".join(
            f"@{x.handle} ({x.kind}"
            f"{', ' + x.role_prompt[:60] if x.role_prompt else ''})"
            for x in ch.members)
        search_hint = (
            "Use the channel_search tool to recover unseen context."
            if m.kind == "agent" else
            f"The full history is .subform/cogentics/{ch.name}.messages.jsonl "
            "in your working directory; grep it to recover unseen context.")
        if not conventions:
            return f"\n[roster:\n{roster}\n]\n"
        return (
            f"\n[roster:\n{roster}\n]\n"
            "\n[conventions: your final reply posts to the channel "
            "automatically. An @mention invokes that member and sends them "
            "your message; write a member's plain name without @ when merely "
            "discussing them. "
            f"An untagged reply goes to @{untagged_to}. "
            "Reference messages as #N. Cite ledger notes as [[name]]. "
            f"{search_hint} "
            f"If no substantive reply is needed, respond with exactly "
            f"{ACK}.]\n")

    def _compose_batch(self, ch: Channel, m: Member,
                       batch: list[dict]) -> str:
        if batch and batch[0].get("group"):
            return self._compose_group_round(ch, m, batch[0])
        blocks = []
        for d in batch:
            msg = self._msg_by_seq(ch, d["seq"])
            if msg:
                blocks.append(self._compose_block(ch, msg, m.handle))
        payload = "\n".join(blocks)
        want_conv = not m.conventions_sent or m.misaddressed
        if want_conv or m.roster_stale:
            payload += self._briefing(ch, m, batch[-1]["trigger_author"],
                                      conventions=want_conv)
            m.conventions_sent = True
            m.misaddressed = False
            m.roster_stale = False
            self._save(ch)
        return payload

    def _context(self, ch: Channel, member: Member) -> str:
        h = member.handle
        lines = []
        for m in ch.messages:
            body = (m.get("body") or "").strip()
            if not body:
                continue
            visible = (m["author"] == h or h in m.get("mentions", [])
                       or m.get("trigger_author") == h)
            if not visible:
                continue
            lines.append(f"#{m['seq']} @{m['author']}: {body[:600]}")
        lines = lines[-LEDGER_TAIL:]
        roster = ", ".join(f"@{m.handle} ({m.kind})" for m in ch.members)
        return (f"channel members: {roster}\n"
                f"messages you were part of (you only see messages that "
                f"mention or involve you; use the channel_search tool on "
                f"channel '{ch.name}' for anything else):\n" +
                "\n".join(lines))
