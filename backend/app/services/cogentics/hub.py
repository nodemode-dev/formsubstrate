import asyncio
from pathlib import Path
from typing import Optional

from app.services.cogentics import llm as llm_mod
from app.services.cogentics.agent import Tools
from app.services.cogentics.compose import ComposeMixin
from app.services.cogentics.group import GroupMixin
from app.services.cogentics.model import Channel
from app.services.cogentics.roster import RosterMixin
from app.services.cogentics.route import RouteMixin
from app.services.cogentics.store import StoreMixin
from app.services.cogentics.tools import ToolsMixin
from app.services.cogentics.turns import TurnsMixin


class CodexHub(StoreMixin, RosterMixin, RouteMixin, ComposeMixin, ToolsMixin, GroupMixin, TurnsMixin):
    def __init__(self) -> None:
        self.llm = llm_mod.client
        self.tools = Tools()
        self.trusted = False
        self._root: Optional[Path] = None
        self._approvals: dict[tuple, asyncio.Future] = {}
        self._channels: dict[str, Channel] = {}
        self._subs: dict[str, set[asyncio.Queue]] = {}
        self._tasks: set[asyncio.Task] = set()
        self._busy: dict[tuple, bool] = {}
        self._inbox: dict[tuple, list[dict]] = {}
        self._register_search_tool()

    async def shutdown(self) -> None:
        for fut in list(self._approvals.values()):
            if not fut.done():
                fut.set_result(False)
        for t in list(self._tasks):
            t.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)


_hub: Optional[CodexHub] = None


def hub() -> CodexHub:
    global _hub
    if _hub is None:
        _hub = CodexHub()
    return _hub
