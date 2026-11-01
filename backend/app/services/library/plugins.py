import importlib.util
import inspect
import json
import sys
import traceback
from dataclasses import asdict, dataclass, field
from pathlib import Path

import keyring
from keyring.errors import KeyringError

from app.core import workspace_root as ws
from app.services.library import activity, state
from app.services.library.paths import atomic_write, workspace_dir
from app.services.library.registry import Host, tools

BUNDLED = Path(__file__).resolve().parent / "bundled"
SERVICE = "subform"
DISABLED_KEY = "plugins_disabled"
SETTINGS_NAME = "plugin_settings.json"
VALUE_MAX = 4096


@dataclass
class PluginInfo:
    name: str
    description: str
    path: str
    origin: str
    tools: list[str] = field(default_factory=list)
    error: str | None = None
    version: str = ""
    kind: str = "plugin"
    enabled: bool = True
    loaded: bool = False
    held: str = ""
    settings_schema: list = field(default_factory=list)


_loaded: list[PluginInfo] = []
_key: tuple[str, bool] | None = None


def _root() -> str:
    return ws.current() or ""


def _secret_name(plugin: str, setting: str) -> str:
    return f"plugin.{plugin}.{setting}"


def _file_values() -> dict:
    try:
        data = json.loads(workspace_dir(SETTINGS_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError, ws.Refused):
        return {}
    return data if isinstance(data, dict) else {}


def _secret_get(plugin: str, setting: str) -> str:
    try:
        return keyring.get_password(SERVICE, _secret_name(plugin, setting)) or ""
    except Exception:
        return ""


def settings_view(plugin: str) -> dict:
    info = next((p for p in _loaded if p.name == plugin), None)
    if info is None:
        raise ws.Refused(404, f"no plugin named {plugin}")
    saved = _file_values().get(plugin, {})
    values: dict[str, str] = {}
    secret_set: dict[str, bool] = {}
    for spec in info.settings_schema:
        name = spec.get("name")
        if not name:
            continue
        if spec.get("secret"):
            secret_set[name] = bool(_secret_get(plugin, name))
            values[name] = ""
        else:
            values[name] = str(saved.get(name, spec.get("default", "")))
    return {"schema": info.settings_schema, "values": values, "secret_set": secret_set}


def save_settings(plugin: str, incoming: dict) -> dict:
    view = settings_view(plugin)
    specs = {s["name"]: s for s in view["schema"] if s.get("name")}
    everything = _file_values()
    mine = dict(everything.get(plugin, {}))
    for name, raw in incoming.items():
        spec = specs.get(name)
        if spec is None or not isinstance(raw, str):
            continue
        if len(raw) > VALUE_MAX:
            raise ws.Refused(413, f"{name} is too long")
        if spec.get("secret"):
            if not raw:
                continue
            try:
                keyring.set_password(SERVICE, _secret_name(plugin, name), raw)
            except (KeyringError, RuntimeError) as err:
                raise ws.Refused(503, f"no system keyring: {err.__class__.__name__}")
        else:
            mine[name] = raw
    everything[plugin] = mine
    atomic_write(workspace_dir(SETTINGS_NAME), json.dumps(everything, indent=1))
    activity.emit(f"settings {plugin}", "output", "saved", "plugins")
    return settings_view(plugin)


def _values(plugin: str, schema: list) -> dict:
    saved = _file_values().get(plugin, {})
    out: dict[str, str] = {}
    for spec in schema:
        name = spec.get("name")
        if not name:
            continue
        out[name] = _secret_get(plugin, name) if spec.get("secret") else str(saved.get(name, spec.get("default", "")))
    return out


def _load_one(py: Path, origin: str) -> PluginInfo:
    source = f"plugin:{py.stem}"
    modname = f"subform_plugin_{origin}_{py.stem}"
    info = PluginInfo(name=py.stem, description="", path=str(py), origin=origin)
    try:
        spec = importlib.util.spec_from_file_location(modname, py)
        if spec is None or spec.loader is None:
            raise ImportError("not a python module")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[modname] = mod
        spec.loader.exec_module(mod)
        meta = getattr(mod, "PLUGIN", {}) or {}
        info.name = str(meta.get("name", py.stem))
        info.description = str(meta.get("description", ""))
        info.version = str(meta.get("version", ""))
        info.kind = str(meta.get("kind", "plugin"))
        info.settings_schema = [dict(s) for s in meta.get("settings", []) if isinstance(s, dict) and s.get("name")]
        if info.name in state.get_list(DISABLED_KEY):
            info.enabled = False
            return info
        source = f"plugin:{info.name}"
        before = set(tools.names())
        host = Host(tools, source)
        reg = mod.register
        if len(inspect.signature(reg).parameters) >= 2:
            reg(host, _values(info.name, info.settings_schema))
        else:
            reg(host)
        info.tools = sorted(set(tools.names()) - before)
        info.loaded = True
        activity.emit(f"plugin {info.name}", "enter", f"{len(info.tools)} tools", "plugins")
    except Exception:
        info.error = traceback.format_exc(limit=3)[-600:]
        tools.unregister_source(source)
        activity.emit(f"plugin {py.stem}", "error", info.error.splitlines()[-1] if info.error else None, "plugins")
    return info


def reload(trust: bool) -> list[PluginInfo]:
    global _loaded, _key
    for info in _loaded:
        tools.unregister_source(f"plugin:{info.name}")
    tools.unregister_source_prefix("plugin:")
    found: list[PluginInfo] = []
    if BUNDLED.is_dir():
        for py in sorted(BUNDLED.glob("*.py")):
            if not py.name.startswith("_"):
                found.append(_load_one(py, "bundled"))
    try:
        folder = workspace_dir("plugins")
    except ws.Refused:
        folder = None
    if folder is not None and folder.is_dir():
        for py in sorted(folder.glob("*.py")):
            if py.name.startswith("_"):
                continue
            if trust:
                found.append(_load_one(py, "workspace"))
            else:
                found.append(PluginInfo(name=py.stem, description="", path=str(py), origin="workspace", held="trust the workspace to run it"))
    _loaded = found
    _key = (_root(), trust)
    return _loaded


def listing(trust: bool) -> list[dict]:
    if _key is None or _key[0] != _root():
        reload(False)
    return [asdict(p) for p in _loaded]


def set_enabled(name: str, on: bool, trust: bool) -> list[dict]:
    if not any(p.name == name for p in _loaded):
        raise ws.Refused(404, f"no plugin named {name}")
    state.set_member(DISABLED_KEY, name, not on)
    reload(bool(_key and _key[1]) or trust)
    activity.emit(f"plugin {name}", "enter" if on else "exit", "enabled" if on else "disabled", "plugins")
    return [asdict(p) for p in _loaded]
