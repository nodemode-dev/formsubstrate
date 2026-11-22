import hashlib
import json
import os
import re
import time
from pathlib import Path

from app.core import workspace_root as ws

SAFE_NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
PLACEHOLDER = re.compile(r"\{([a-zA-Z0-9_]+)\}")
PRESETS = Path(__file__).resolve().parent / "presets"
MAX_BYTES = 1024 * 1024
MAX_VALUE = 20000
INPUT_KEYS = ("name", "label", "type", "default", "required", "placeholder")


class RecipeError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def safe_path(rel: str, write: bool = False) -> Path:
    try:
        real, flat = ws.resolve(rel, write=write, follow=False)
        cur = ws.real_root()
    except ws.Refused as err:
        raise RecipeError(err.status, err.detail) from err
    for part in flat.split("/"):
        cur = os.path.join(cur, part)
        if os.path.islink(cur):
            raise RecipeError(403, "a symbolic link in the path is refused")
    return Path(real)


def folder(write: bool = False) -> Path:
    return safe_path(".formsubstrate/recipes", write)


def _path(name: str, write: bool = False) -> Path:
    if not SAFE_NAME.match(name or ""):
        raise RecipeError(400, "a recipe name is letters, digits, dashes and underscores")
    return safe_path(f".formsubstrate/recipes/{name}.json", write)


def content_hash(recipe: dict) -> str:
    body = {k: recipe.get(k) for k in ("name", "doc", "task_template", "inputs", "skills")}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _read(path: Path) -> dict | None:
    try:
        if path.is_symlink():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _summary(data: dict, fallback: str) -> dict:
    doc = data.get("doc") if isinstance(data.get("doc"), dict) else {}
    return {
        "name": data.get("name", fallback),
        "description": data.get("description", ""),
        "inputs": data.get("inputs", []),
        "skills": data.get("skills", []),
        "nodes": len(doc.get("nodes", [])),
        "updated": data.get("updated"),
    }


def list_recipes() -> list[dict]:
    base = folder()
    if not base.is_dir():
        return []
    out = []
    for path in sorted(base.glob("*.json")):
        data = _read(path)
        if data is not None:
            out.append(_summary(data, path.stem))
    return out


def list_presets() -> list[dict]:
    try:
        installed = {r["name"] for r in list_recipes()}
    except RecipeError:
        installed = set()
    out = []
    for path in sorted(PRESETS.glob("*.json")):
        data = _read(path)
        if data is None:
            continue
        row = _summary(data, path.stem)
        row["installed"] = row["name"] in installed
        out.append(row)
    return out


def get_recipe(name: str) -> dict:
    data = _read(_path(name))
    if data is None:
        raise RecipeError(404, f"no recipe named {name}")
    return data


def _clean_inputs(raw: object) -> list[dict]:
    if not isinstance(raw, list):
        raise RecipeError(400, "inputs must be a list")
    out: list[dict] = []
    seen: set[str] = set()
    for spec in raw[:40]:
        if not isinstance(spec, dict):
            raise RecipeError(400, "each input is an object")
        name = str(spec.get("name") or "")
        if not re.fullmatch(r"[a-zA-Z0-9_]{1,40}", name) or name in seen:
            raise RecipeError(400, f"bad or repeated input name: {name}")
        seen.add(name)
        row: dict = {"name": name}
        for key in INPUT_KEYS[1:]:
            if key in spec and spec[key] is not None:
                row[key] = bool(spec[key]) if key == "required" else str(spec[key])[:500]
        out.append(row)
    return out


def _check_doc(doc: object) -> dict:
    if not isinstance(doc, dict):
        raise RecipeError(400, "a recipe needs a graph doc")
    nodes = doc.get("nodes")
    edges = doc.get("edges", [])
    if not isinstance(nodes, list) or not nodes:
        raise RecipeError(400, "the graph needs nodes")
    if not isinstance(edges, list):
        raise RecipeError(400, "the graph edges must be a list")
    ids = set()
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not isinstance(node.get("kind"), str):
            raise RecipeError(400, "each node needs an id and a kind")
        ids.add(node["id"])
    if not any(n["kind"] == "start" for n in nodes):
        raise RecipeError(400, "the graph needs a start node")
    for edge in edges:
        if not isinstance(edge, dict) or edge.get("from") not in ids or edge.get("to") not in ids:
            raise RecipeError(400, "an edge points at a node that is not in the graph")
    return doc


def save_recipe(body: dict, replace: bool = True) -> dict:
    name = str(body.get("name") or "")
    path = _path(name, True)
    if not replace and path.exists():
        raise RecipeError(409, f"a recipe named {name} already exists")
    recipe = {
        "name": name,
        "description": str(body.get("description") or "")[:500],
        "doc": _check_doc(body.get("doc")),
        "task_template": str(body.get("task_template") or "")[:MAX_VALUE],
        "inputs": _clean_inputs(body.get("inputs", [])),
        "skills": [str(s)[:80] for s in (body.get("skills") or [])][:20],
        "updated": time.time(),
    }
    text = json.dumps(recipe, indent=1)
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise RecipeError(413, "the recipe is larger than 1 MB")
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.replace(temp, path)
    return recipe


def delete_recipe(name: str) -> None:
    path = _path(name, True)
    if path.is_symlink() or not path.is_file():
        raise RecipeError(404, f"no recipe named {name}")
    path.unlink()


def install_preset(name: str) -> dict:
    if not SAFE_NAME.match(name or ""):
        raise RecipeError(400, "bad preset name")
    data = _read(PRESETS / f"{name}.json")
    if data is None:
        raise RecipeError(404, f"no preset recipe {name}")
    return save_recipe(data, replace=False)


def as_data(value: object) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str, ensure_ascii=False)
    text = "".join(ch for ch in text if ch in "\n\t" or ord(ch) >= 32)[:2000]
    return text.replace("{", "｛").replace("}", "｝")


def render_task(recipe: dict, inputs: dict | None = None) -> str:
    given = {str(k): str(v)[:MAX_VALUE] for k, v in (inputs or {}).items() if v is not None}
    for spec in recipe.get("inputs", []):
        name = spec.get("name", "")
        if name and name not in given:
            if spec.get("required") and spec.get("default") in (None, ""):
                raise RecipeError(400, f"missing required input: {name}")
            given[name] = str(spec.get("default", ""))
    task = PLACEHOLDER.sub(lambda m: given.get(m.group(1), m.group(0)), recipe.get("task_template") or "")
    skills = recipe.get("skills") or []
    if skills:
        task += "\n\nRelevant skills to consult: " + ", ".join(skills)
    return task
