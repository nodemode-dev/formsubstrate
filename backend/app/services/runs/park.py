import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Park:
    node_id: str
    label: str
    on: dict
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    since: float = field(default_factory=time.time)
    future: asyncio.Future = field(default_factory=lambda: asyncio.get_running_loop().create_future())
    watcher: Optional[object] = None

    @property
    def approval(self) -> bool:
        return self.on.get("type") == "approval"

    def public(self) -> dict:
        return {"id": self.id, "node_id": self.node_id, "label": self.label, "on": self.on, "since": self.since}

    def settle(self, payload: dict) -> bool:
        if self.future.done():
            return False
        self.future.set_result(payload)
        return True
