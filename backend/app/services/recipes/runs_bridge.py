from app.services.runs import agent, rt
from app.services.runs.manager import manager

MODES = ("simulate", "claude")
ACTIVE = ("running", "parked")


class RunRefused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def start(doc: dict, task: str, mode: str, inputs: dict, trusted: bool = False):
    if mode not in MODES:
        raise RunRefused(400, "mode must be simulate or claude")
    try:
        built = rt.build_doc(doc)
    except rt.GraphError as err:
        raise RunRefused(422, str(err)) from err
    if not any(n.kind == "start" for n in built.nodes):
        raise RunRefused(422, "graph has no start node")
    if not trusted:
        if mode == "claude":
            raise RunRefused(403, "trust this workspace in Preferences before running with Claude Code")
        if rt.has_tools(built) or any(n.kind == "call_graph" for n in built.nodes):
            raise RunRefused(403, "this graph has tool or subgraph nodes; trust this workspace in Preferences to run it")
    if not agent.mode_available(mode):
        raise RunRefused(409, "the claude command was not found on this computer; install Claude Code or use the simulator")
    try:
        return manager.start(built, task, inputs, mode, trusted)
    except rt.GraphError as err:
        raise RunRefused(403, str(err)) from err


def status(run_id: str) -> str | None:
    run = manager.runs.get(run_id)
    return run.status if run is not None else None


def awaiting_approval(run_id: str) -> bool:
    run = manager.runs.get(run_id)
    return run is not None and any(p.approval for p in run.parks.values())


def resume(run_id: str, payload: dict) -> bool:
    if awaiting_approval(run_id):
        return False
    return manager.resume(run_id, {k: v for k, v in payload.items() if k != "approved"})
