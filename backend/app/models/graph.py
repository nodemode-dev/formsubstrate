from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError

NodeKind = Literal["start", "agent", "tool", "evaluator", "yield", "branch", "foreach", "transform", "call_graph", "end"]

KINDS: tuple[str, ...] = ("start", "agent", "tool", "evaluator", "yield", "branch", "foreach", "transform", "call_graph", "end")

ROUTES: dict[str, tuple[str, ...]] = {
    "evaluator": ("accept", "revise"),
    "branch": ("true", "false"),
    "foreach": ("each", "done"),
}

ERROR_ROUTE_KINDS = ("agent", "tool", "branch", "foreach", "transform", "call_graph")

YIELD_EVENTS = ("manual", "delay", "watch", "webhook", "approval")

ON_ERROR = ("halt", "continue", "route")

NAME_MAX = 80


class GraphNode(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    kind: NodeKind
    label: str = Field(max_length=200)
    x: float
    y: float
    config: Optional[dict[str, Any]] = None


class GraphEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(min_length=1, max_length=120)
    from_: str = Field(alias="from")
    to: str
    label: Optional[str] = Field(default=None, max_length=80)


class GraphDoc(BaseModel):
    version: Literal[1]
    name: str = Field(min_length=1, max_length=NAME_MAX)
    nodes: list[GraphNode]
    edges: list[GraphEdge]


def _errors_of(err: ValidationError) -> list[str]:
    out: list[str] = []
    for item in err.errors():
        where = ".".join(str(p) for p in item["loc"])
        out.append(f"{where}: {item['msg']}" if where else item["msg"])
    return out


def check_doc(raw: Any) -> tuple[Optional[GraphDoc], list[str], list[str]]:
    if not isinstance(raw, dict):
        return None, ["document must be an object"], []
    try:
        doc = GraphDoc.model_validate(raw)
    except ValidationError as err:
        return None, _errors_of(err), []
    errors: list[str] = []
    warnings: list[str] = []
    ids: set[str] = set()
    for node in doc.nodes:
        if node.id in ids:
            errors.append(f"duplicate node id: {node.id}")
        ids.add(node.id)
    edge_ids: set[str] = set()
    for edge in doc.edges:
        if edge.id in edge_ids:
            errors.append(f"duplicate edge id: {edge.id}")
        edge_ids.add(edge.id)
        if edge.from_ not in ids:
            errors.append(f"edge {edge.id}: unknown source node {edge.from_}")
        if edge.to not in ids:
            errors.append(f"edge {edge.id}: unknown target node {edge.to}")
        if edge.from_ == edge.to:
            errors.append(f"edge {edge.id}: a node cannot connect to itself")
    kinds = {n.id: n.kind for n in doc.nodes}
    starts = [n for n in doc.nodes if n.kind == "start"]
    if not starts:
        warnings.append("no start node: a run has no entry point")
    elif len(starts) > 1:
        warnings.append("more than one start node")
    if not any(n.kind == "end" for n in doc.nodes):
        warnings.append("no end node: a run completes only at an end node")
    for edge in doc.edges:
        if kinds.get(edge.to) == "start":
            errors.append(f"edge {edge.id}: nothing may connect into a start node")
        if kinds.get(edge.from_) == "end":
            errors.append(f"edge {edge.id}: nothing may leave an end node")
        src = kinds.get(edge.from_)
        if src in ROUTES and edge.label and edge.label not in ROUTES[src] and edge.label != "error":
            warnings.append(f"edge {edge.id}: label {edge.label} is not one of {', '.join(ROUTES[src])} for a {src} node")
    outs: dict[str, list[GraphEdge]] = {}
    for edge in doc.edges:
        outs.setdefault(edge.from_, []).append(edge)
    for node in doc.nodes:
        cfg = node.config or {}
        if node.kind == "tool" and not str(cfg.get("tool", "")).strip():
            warnings.append(f"node {node.id}: tool node without a tool")
        if node.kind == "branch" and not str(cfg.get("expr", "")).strip():
            warnings.append(f"node {node.id}: branch without an expression")
        if node.kind == "foreach":
            if not str(cfg.get("items", "")).strip():
                warnings.append(f"node {node.id}: foreach without an items expression")
            par = cfg.get("parallel", 1)
            if not isinstance(par, int) or isinstance(par, bool) or not 1 <= par <= 8:
                errors.append(f"node {node.id}: foreach parallel must be an integer from 1 to 8")
            labels = {e.label for e in outs.get(node.id, [])}
            if "each" not in labels:
                warnings.append(f"node {node.id}: foreach has no each edge")
        if node.kind == "call_graph" and not str(cfg.get("graph", "")).strip():
            warnings.append(f"node {node.id}: call_graph without a saved graph")
        if node.kind == "yield":
            event = cfg.get("event", {"type": "manual"})
            if not isinstance(event, dict) or event.get("type", "manual") not in YIELD_EVENTS:
                errors.append(f"node {node.id}: yield event type must be one of {', '.join(YIELD_EVENTS)}")
            elif event.get("type") == "delay":
                secs = event.get("seconds", 60)
                if not isinstance(secs, (int, float)) or isinstance(secs, bool) or secs < 1:
                    errors.append(f"node {node.id}: delay seconds must be a number of at least 1")
        retries = cfg.get("retries", 0)
        if not isinstance(retries, (int, float)) or isinstance(retries, bool) or retries < 0 or retries > 10:
            errors.append(f"node {node.id}: retries must be a number from 0 to 10")
        on_error = cfg.get("on_error", "halt")
        if on_error not in ON_ERROR:
            errors.append(f"node {node.id}: on_error must be one of {', '.join(ON_ERROR)}")
        elif on_error == "route" and not any(e.label == "error" for e in outs.get(node.id, [])):
            warnings.append(f"node {node.id}: on_error route needs an out-edge labeled error")
    return doc, errors, warnings
