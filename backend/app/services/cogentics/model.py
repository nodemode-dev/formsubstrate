import re
from dataclasses import dataclass, field
from typing import Optional

ACK = "<ACK_OK>"
LEDGER_TAIL = 12
CLAUDE_TURN_TIMEOUT = 600
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,47}$")
HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,23}$")
FENCE_RE = re.compile(r"```.*?```|`[^`\n]*`", re.S)
MENTION_RE = re.compile(r"@([A-Za-z0-9_-]+)")
REF_RE = re.compile(r"#(\d+)")
LEDGER_RE = re.compile(r"\[\[([^\[\]\n]{1,64})\]\]")
WORKER_KINDS = ("agent", "claude")


@dataclass
class Member:
    handle: str
    kind: str = "agent"
    role_prompt: str = ""
    state: str = "active"
    pending: list[dict] = field(default_factory=list)
    session_ref: str = ""
    full_access: bool = False
    model: str = ""
    conventions_sent: bool = False
    misaddressed: bool = False
    roster_stale: bool = False
    held: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"handle": self.handle, "kind": self.kind,
                "role_prompt": self.role_prompt, "state": self.state,
                "pending": self.pending, "session_ref": self.session_ref,
                "full_access": self.full_access, "model": self.model,
                "conventions_sent": self.conventions_sent,
                "misaddressed": self.misaddressed,
                "roster_stale": self.roster_stale, "held": self.held}


def is_worker(m: Member) -> bool:
    return m.kind in WORKER_KINDS


@dataclass
class Channel:
    name: str
    created: float
    seq: int = 0
    members: list[Member] = field(default_factory=list)
    messages: list[dict] = field(default_factory=list)
    config: dict = field(default_factory=dict)
    groups: list[dict] = field(default_factory=list)

    def member(self, handle: str) -> Optional[Member]:
        for m in self.members:
            if m.handle == handle:
                return m
        return None

    def to_dict(self) -> dict:
        return {"name": self.name, "created": self.created, "seq": self.seq,
                "members": [m.to_dict() for m in self.members],
                "messages": self.messages, "config": self.config,
                "groups": self.groups}


def parse_body(body: str, handles: set[str]) -> dict:
    scrubbed = FENCE_RE.sub(lambda m: " " * len(m.group(0)), body)
    mentions: list[str] = []
    unresolved: list[str] = []
    for m in MENTION_RE.finditer(scrubbed):
        h = m.group(1)
        if h in handles:
            if h not in mentions:
                mentions.append(h)
        elif h != "all" and h not in unresolved:
            unresolved.append(h)
    refs = sorted({int(m.group(1)) for m in REF_RE.finditer(scrubbed)})
    ledger_refs = []
    for m in LEDGER_RE.finditer(scrubbed):
        name = m.group(1).strip()
        if name and name not in ledger_refs:
            ledger_refs.append(name)
    return {"mentions": mentions, "refs": refs, "unresolved": unresolved,
            "ledger_refs": ledger_refs}
