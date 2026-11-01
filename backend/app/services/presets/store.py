import ast
import contextlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path

from app.core import workspace_root as ws
from app.services.presets import GROUPS
from app.services.recipes import store as recipes

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
APP = Path(__file__).resolve().parents[2]
BACKEND = APP.parent
GRAPH_TEMPLATES = APP / "templates" / "graphs"
FILE_MAX = 512 * 1024
SKILL_FILES_MAX = 16


class PresetError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _root() -> Path:
    bundled = getattr(sys, "_MEIPASS", "")
    return Path(bundled) / "presets" if bundled else BACKEND / "presets"


def _name(value: str) -> str:
    if not isinstance(value, str) or not NAME_RE.fullmatch(value):
        raise PresetError(400, "bad preset name")
    return value


def _group(group: str) -> str:
    if group not in GROUPS:
        raise PresetError(404, f"no preset group {group}")
    return group


def _json(path: Path) -> dict | None:
    try:
        if path.is_symlink() or path.stat().st_size > FILE_MAX:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _graph_files() -> dict[str, Path]:
    found: dict[str, Path] = {}
    for folder in (GRAPH_TEMPLATES, _root() / "graphs"):
        if folder.is_dir():
            for path in sorted(folder.glob("*.json")):
                if NAME_RE.fullmatch(path.stem):
                    found[path.stem] = path
    return found


def _graph_row(name: str, data: dict) -> dict:
    doc = data.get("doc") if isinstance(data.get("doc"), dict) else {}
    return {"name": name, "description": data.get("description", ""), "nodes": len(doc.get("nodes", [])), "edges": len(doc.get("edges", []))}


def _meta(path: Path) -> dict:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError, ValueError):
        return {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "PLUGIN" for t in node.targets):
            try:
                value = ast.literal_eval(node.value)
            except (ValueError, SyntaxError):
                return {}
            return value if isinstance(value, dict) else {}
    return {}


def _plugin_files() -> dict[str, Path]:
    folder = _root() / "plugins"
    if not folder.is_dir():
        return {}
    return {p.stem: p for p in sorted(folder.glob("*.py")) if NAME_RE.fullmatch(p.stem) and not p.name.startswith("_") and not p.is_symlink()}


def _skill_dirs() -> dict[str, Path]:
    folder = _root() / "skills"
    if not folder.is_dir():
        return {}
    return {d.name: d for d in sorted(folder.iterdir()) if d.is_dir() and not d.is_symlink() and NAME_RE.fullmatch(d.name) and (d / "SKILL.md").is_file()}


def _front(text: str) -> dict:
    lines = text.splitlines()
    out: dict[str, str] = {}
    if lines and lines[0].strip() == "---":
        for line in lines[1:]:
            if line.strip() == "---":
                break
            if ":" in line:
                key, _, value = line.partition(":")
                out[key.strip()] = value.strip()
    return out


def _installed(rel: str) -> bool:
    try:
        real, _ = ws.resolve(rel, follow=False)
    except ws.Refused:
        return False
    return os.path.lexists(real)


def _has_workspace() -> bool:
    return ws.current() is not None


def listing(group: str) -> list[dict]:
    _group(group)
    out: list[dict] = []
    if group == "graphs":
        for name, path in _graph_files().items():
            data = _json(path)
            if data is not None:
                row = _graph_row(name, data)
                row["installed"] = _has_workspace() and _installed(f".subform/graphs/{name}.json")
                out.append(row)
    elif group == "recipes":
        try:
            out = recipes.list_presets()
        except recipes.RecipeError:
            out = []
    elif group == "plugins":
        for name, path in _plugin_files().items():
            meta = _meta(path)
            out.append({
                "name": name,
                "title": str(meta.get("name", name)),
                "description": str(meta.get("description", "")),
                "version": str(meta.get("version", "")),
                "kind": str(meta.get("kind", "plugin")),
                "settings": len(meta.get("settings", []) or []),
                "installed": _has_workspace() and _installed(f".subform/plugins/{name}.py"),
            })
    else:
        for name, folder in _skill_dirs().items():
            meta = _front((folder / "SKILL.md").read_text(encoding="utf-8", errors="replace"))
            out.append({"name": name, "description": meta.get("description", ""), "installed": _has_workspace() and _installed(f".claude/skills/{name}/SKILL.md")})
    return out


def counts() -> dict[str, int]:
    return {group: len(listing(group)) for group in GROUPS}


def read(group: str, name: str) -> dict:
    _group(group)
    _name(name)
    if group == "graphs":
        path = _graph_files().get(name)
        data = _json(path) if path else None
        if data is None:
            raise PresetError(404, f"no graph preset {name}")
        return data
    if group == "recipes":
        data = recipes._read(recipes.PRESETS / f"{name}.json")
        if data is None:
            raise PresetError(404, f"no recipe preset {name}")
        return data
    if group == "plugins":
        path = _plugin_files().get(name)
        if path is None:
            raise PresetError(404, f"no plugin preset {name}")
        return {"name": name, "meta": _meta(path), "source": path.read_text(encoding="utf-8")}
    folder = _skill_dirs().get(name)
    if folder is None:
        raise PresetError(404, f"no skill preset {name}")
    return {"name": name, "text": (folder / "SKILL.md").read_text(encoding="utf-8")}


def _target(rel: str) -> str:
    try:
        real, clean = ws.resolve(rel, write=True, follow=False)
        base = ws.real_root()
    except ws.Refused as err:
        raise PresetError(err.status, err.detail) from err
    walked = base
    for part in clean.split("/")[:-1]:
        walked = os.path.join(walked, part)
        if os.path.islink(walked):
            raise PresetError(403, "a symbolic link in the destination is refused")
    if os.path.islink(real):
        raise PresetError(403, "a symbolic link in the destination is refused")
    return real


def _write(real: str, text: str, replace: bool) -> None:
    if os.path.lexists(real) and not replace:
        raise PresetError(409, "already installed")
    os.makedirs(os.path.dirname(real), exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=os.path.dirname(real), prefix=".preset-", suffix=".tmp")
    try:
        os.chmod(temp, 0o644)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(temp, real)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temp)
        raise


def install(group: str, name: str, replace: bool = False, trust: bool = False) -> dict:
    _group(group)
    _name(name)
    if not _has_workspace():
        raise PresetError(409, "no workspace open")
    if group == "recipes":
        if replace:
            raise PresetError(400, "recipe presets are not replaced")
        try:
            recipe = recipes.install_preset(name)
        except recipes.RecipeError as err:
            raise PresetError(err.status, err.detail) from err
        return {"installed": f".subform/recipes/{name}.json", "recipe": recipe}
    data = read(group, name)
    if group == "graphs":
        rel = f".subform/graphs/{name}.json"
        doc = data.get("doc") if isinstance(data, dict) else None
        if not isinstance(doc, dict):
            raise PresetError(404, "preset graph has no doc")
        _write(_target(rel), json.dumps(doc, indent=1), replace)
        return {"installed": rel}
    if group == "plugins":
        if not trust:
            raise PresetError(403, "trust the workspace to install a plugin")
        rel = f".subform/plugins/{name}.py"
        _write(_target(rel), data["source"], replace)
        return {"installed": rel}
    folder = _skill_dirs()[name]
    files = [p for p in sorted(folder.rglob("*")) if p.is_file() and not p.is_symlink()][:SKILL_FILES_MAX]
    dest = f".claude/skills/{name}"
    if not replace and os.path.lexists(_target(f"{dest}/SKILL.md")):
        raise PresetError(409, "already installed")
    for path in files:
        sub = path.relative_to(folder).as_posix()
        if path.stat().st_size > FILE_MAX:
            continue
        _write(_target(f"{dest}/{sub}"), path.read_text(encoding="utf-8"), True)
    return {"installed": f"{dest}/SKILL.md"}
