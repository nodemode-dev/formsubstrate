import json
import os
import re
import types
from typing import Any

from app.core import workspace_root as ws
from app.services.runs.safe_expr import ExprError, evaluate

MAX_STEPS = 200
MAX_PARALLEL = 8
GRAPHS_DIR = ".formsubstrate/graphs"
TEMPLATE_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")
NAME_RE = re.compile(r"[^a-zA-Z0-9_-]")
KINDS = ("start", "agent", "tool", "evaluator", "yield", "branch", "foreach", "transform", "call_graph", "end")


class GraphError(Exception):
    pass


def safe_name(name: str) -> str:
    return NAME_RE.sub("", name or "")


def build_doc(data: Any, fallback_name: str = "graph") -> types.SimpleNamespace:
    d = data.get("doc", data) if isinstance(data, dict) else None
    if not isinstance(d, dict) or not isinstance(d.get("nodes"), list) or not isinstance(d.get("edges"), list):
        raise GraphError("a graph needs nodes and edges")
    nodes = []
    seen: set[str] = set()
    for n in d["nodes"]:
        if not isinstance(n, dict) or not isinstance(n.get("id"), str) or not n["id"]:
            raise GraphError("a node has no id")
        if n["id"] in seen:
            raise GraphError(f"duplicate node id: {n['id']}")
        seen.add(n["id"])
        kind = n.get("kind")
        if kind not in KINDS:
            raise GraphError(f"node {n['id']}: unknown kind {kind!r}")
        cfg = n.get("config")
        nodes.append(types.SimpleNamespace(
            id=n["id"], kind=kind, label=str(n.get("label") or n["id"]),
            x=float(n.get("x") or 0), y=float(n.get("y") or 0),
            config=cfg if isinstance(cfg, dict) else {}))
    edges = []
    for e in d["edges"]:
        if not isinstance(e, dict):
            raise GraphError("an edge is not an object")
        src = e.get("from", e.get("from_"))
        dst = e.get("to")
        if src not in seen or dst not in seen:
            raise GraphError(f"edge {e.get('id', '?')} points at a missing node")
        label = e.get("label")
        edges.append(types.SimpleNamespace(
            id=str(e.get("id") or f"{src}-{dst}"), from_=src, to=dst,
            label=label if isinstance(label, str) and label else None))
    return types.SimpleNamespace(name=str(d.get("name") or fallback_name), nodes=nodes, edges=edges)


def doc_to_dict(doc: types.SimpleNamespace) -> dict:
    return {
        "version": 1, "name": doc.name,
        "nodes": [{"id": n.id, "kind": n.kind, "label": n.label, "x": n.x, "y": n.y,
                   **({"config": n.config} if n.config else {})} for n in doc.nodes],
        "edges": [{"id": e.id, "from": e.from_, "to": e.to,
                   **({"label": e.label} if e.label else {})} for e in doc.edges],
    }


def has_tools(doc: Any) -> bool:
    return any(n.kind == "tool" for n in doc.nodes)


def glob_regex(pattern: str) -> "re.Pattern[str]":
    out = []
    i = 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def plain_path(rel: str, write: bool = False) -> str:
    try:
        base = ws.real_root()
        real, clean = ws.resolve(rel, write=write, follow=False)
    except ws.Refused as err:
        raise GraphError(err.detail)
    walk = base
    for part in clean.split("/"):
        walk = os.path.join(walk, part)
        if os.path.islink(walk):
            raise GraphError("symbolic links are refused in the .formsubstrate folder")
    return real


def load_saved_graph(name: str) -> types.SimpleNamespace:
    safe = safe_name(name)
    if not safe:
        raise GraphError("call_graph needs a saved graph name")
    real = plain_path(f"{GRAPHS_DIR}/{safe}.json")
    try:
        with open(real, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        raise GraphError(f"no saved graph named {safe}")
    return build_doc(data, safe)


def _lookup(run: Any, context: str, item: Any, path: str) -> Any:
    head, _, rest = path.partition(".")
    base: Any = {"task": run.task, "context": context, "item": item,
                 "inputs": run.inputs, "steps": run.outputs}.get(head, "")
    for key in [x for x in rest.split(".") if x]:
        base = base.get(key, "") if isinstance(base, dict) else ""
    return base


def render_template(s: str, run: Any, context: str, item: Any = None) -> str:
    def sub(m: "re.Match[str]") -> str:
        v = _lookup(run, context, item, m.group(1))
        return v if isinstance(v, str) else json.dumps(v, default=str)
    return TEMPLATE_RE.sub(sub, s or "")


def eval_expr(expr: str, run: Any, context: str, item: Any = None) -> Any:
    names = {"task": run.task, "context": context, "item": item,
             "inputs": run.inputs, "steps": run.outputs}
    try:
        return evaluate(expr, names)
    except ExprError as err:
        raise GraphError(f"expression failed: {err}")


def label_of(edge: Any) -> str:
    return (edge.label or "").strip().lower()


def pick_edge(outs: list, verdict: str | None, node: Any, nodes: dict) -> Any:
    if verdict:
        labeled = [e for e in outs if label_of(e) == verdict]
        if labeled:
            return labeled[0]
        back = [e for e in outs if nodes[e.to].x < node.x]
        fwd = [e for e in outs if nodes[e.to].x >= node.x]
        if verdict == "revise" and back:
            return back[0]
        if verdict == "accept" and fwd:
            return fwd[0]
    return outs[0]
