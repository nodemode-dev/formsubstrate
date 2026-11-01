from app.services.runs import agent, rt
from app.services.runs.manager import manager

MODES = ("simulate", "claude")
ACTIVE = ("running", "parked")


class RunRefused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def start(doc: dict, task: str, mode: str, inputs: dict):
    if mode not in MODES:
        raise RunRefused(400, "mode must be simulate or claude")
    try:
        built = rt.build_doc(doc)
    except rt.GraphError as err:
        raise RunRefused(422, str(err)) from err
    if not any(n.kind == "start" for n in built.nodes):
        raise RunRefused(422, "graph has no start node")
    if not agent.mode_available(mode):
        raise RunRefused(409, "the claude command was not found on this computer; install Claude Code or use the simulator")
    manager.sync()
    return manager.start(built, task, inputs=inputs, mode=mode)


def status(run_id: str) -> str | None:
    run = manager.runs.get(run_id)
    return run.status if run is not None else None


def resume(run_id: str, payload: dict) -> bool:
    return manager.resume(run_id, payload)
