import json
import os
import re
import threading
from pathlib import Path

from app.core import config

ORDER = ("claude", "codex", "cursor", "antigravity")
DEFAULT = "claude"
PATHS_NAME = "agent-paths.json"
PATH_MAX = 4096
MCP_DIR = ".formsubstrate"
MCP_NAME = "mcp.json"
SERVER_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ENV_REF_RE = re.compile(r"^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$")
CAPS = {
    "claude": {"mcp": True, "gates": True, "modes": ("default", "acceptEdits", "plan")},
    "codex": {"mcp": True, "gates": False, "modes": ("default", "acceptEdits", "plan")},
    "cursor": {"mcp": False, "gates": False, "modes": ("default", "plan")},
    "antigravity": {"mcp": False, "gates": False, "modes": ("acceptEdits", "plan")},
}
CODEX_SANDBOX = {"acceptEdits": "workspace-write", "plan": "read-only"}
ANTIGRAVITY_MODE = {"acceptEdits": "accept-edits", "plan": "plan"}
NOTES = {
    "codex": "Codex gets the session MCP servers as config overrides; gate cards and the write hooks need Claude Code, so its writes are not gated",
    "cursor": "Cursor is started plainly in the worktree: it has no option for an MCP config file, so it does not get the session MCP servers, and gate cards need Claude Code",
    "antigravity": "Antigravity is started plainly in the worktree: it has no option for an MCP config file, so it does not get the session MCP servers, and gate cards need Claude Code",
}


class Refused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


_lock = threading.Lock()
_paths: dict[str, str] | None = None


def known(program: object) -> bool:
    return isinstance(program, str) and program in ORDER


def of(item: dict) -> str:
    program = item.get("agent")
    return program if known(program) else DEFAULT


def title(program: str) -> str:
    from app.services import agent_lookup

    return agent_lookup.PROGRAMS[program]["title"]


def _paths_file() -> Path:
    return config.data_dir() / PATHS_NAME


def _load() -> dict[str, str]:
    global _paths
    with _lock:
        if _paths is None:
            found: dict[str, str] = {}
            try:
                data = json.loads(_paths_file().read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = None
            items = data.get("paths") if isinstance(data, dict) else None
            if isinstance(items, dict):
                for key, value in items.items():
                    if known(key) and isinstance(value, str) and value.strip():
                        found[key] = value.strip()
            _paths = found
        return dict(_paths)


def setting(program: str) -> str:
    return _load().get(program, "")


def set_path(program: str, path: str) -> str:
    global _paths
    from app.services import agent_lookup

    if not known(program):
        raise Refused(404, "no such agent program")
    path = (path or "").strip()
    if path:
        if len(path) > PATH_MAX or any(ord(ch) < 32 or ord(ch) == 127 for ch in path):
            raise Refused(400, "bad path")
        if not os.path.isabs(path):
            raise Refused(400, "the path must be absolute")
        if not os.path.isfile(path):
            raise Refused(400, "no file exists at that path")
        if not agent_lookup.runnable(path):
            raise Refused(400, "that file is not a program that can run")
    current = _load()
    if path:
        current[program] = path
    else:
        current.pop(program, None)
    target = _paths_file()
    temp = target.with_name(target.name + ".tmp")
    with _lock:
        temp.write_text(json.dumps({"paths": current}, indent=2), encoding="utf-8")
        os.replace(temp, target)
        _paths = dict(current)
    return path


def locate(program: str):
    from app.core import binres
    from app.services import agent_lookup

    spec = agent_lookup.PROGRAMS[program]
    chosen = setting(program)
    if chosen and agent_lookup.runnable(chosen):
        return agent_lookup.Found(program, spec["title"], path=chosen, how="setting", state="found")
    for folder in binres.vendor_dirs():
        for name in spec["names"]:
            for candidate in (folder / name, folder / f"{name}.exe"):
                if agent_lookup.runnable(candidate):
                    return agent_lookup.Found(program, spec["title"], path=str(candidate), how="folder", state="found")
    return agent_lookup.find(program, setting=chosen, override_vars=binres.AGENT_OVERRIDES.get(program, ()), shell_timeout=binres.SHELL_WAIT)


def describe(program: str) -> dict:
    from app.services import agent_lookup

    found = agent_lookup.check(locate(program))
    caps = CAPS[program]
    return {
        "program": program,
        "title": found.title,
        "path": found.path,
        "version": found.version,
        "finding": found.state,
        "how": found.how,
        "error": found.error,
        "install": agent_lookup.install(program),
        "setting": setting(program),
        "mcp": caps["mcp"],
        "gates": caps["gates"],
        "modes": list(caps["modes"]),
    }


def modes(program: str) -> tuple[str, ...]:
    return CAPS[program]["modes"]


def note(program: str) -> str | None:
    return NOTES.get(program)


def _word(prompt: str) -> str:
    return " " + prompt if prompt.startswith("-") else prompt


def _toml(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if ch in ('"', "\\"):
            out.append("\\" + ch)
        elif code < 32 or code == 127:
            out.append(f"\\u{code:04x}")
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


def codex_overrides(worktree: str) -> list[str]:
    try:
        data = json.loads((Path(worktree) / MCP_DIR / MCP_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    if not isinstance(servers, dict):
        return []
    out: list[str] = []
    for name, entry in servers.items():
        if not isinstance(name, str) or not SERVER_RE.match(name) or not isinstance(entry, dict):
            continue
        command = entry.get("command")
        if not isinstance(command, str) or not command:
            continue
        base = f"mcp_servers.{name}"
        out += ["-c", f"{base}.command={_toml(command)}"]
        args = [str(arg) for arg in entry.get("args") or []] if isinstance(entry.get("args"), list) else []
        if args:
            out += ["-c", f"{base}.args=[{', '.join(_toml(arg) for arg in args)}]"]
        env = entry.get("env") if isinstance(entry.get("env"), dict) else {}
        fixed: list[str] = []
        forwarded: list[str] = []
        for key, value in env.items():
            if not isinstance(key, str) or not ENV_NAME_RE.match(key) or not isinstance(value, str):
                continue
            ref = ENV_REF_RE.match(value)
            if ref and ref.group(1) == key:
                forwarded.append(key)
            elif ref is None:
                fixed.append(f"{key} = {_toml(value)}")
        if fixed:
            out += ["-c", f"{base}.env={{ {', '.join(fixed)} }}"]
        if forwarded:
            out += ["-c", f"{base}.env_vars=[{', '.join(_toml(key) for key in forwarded)}]"]
    return out


def interactive_argv(program: str, exe: str, item: dict, resume: bool) -> list[str]:
    known_id = item.get("claudeSessionId") if resume else None
    if program == "codex":
        argv = [exe, *codex_overrides(item["worktree"])]
        if resume:
            argv += ["resume", known_id] if known_id else ["resume", "--last"]
        return argv
    if program == "cursor":
        if resume:
            return [exe, "--resume", known_id] if known_id else [exe, "--continue"]
        return [exe]
    if program == "antigravity":
        if resume:
            return [exe, "--conversation", known_id] if known_id else [exe, "--continue"]
        return [exe]
    raise Refused(400, "no such agent program")


def headless_argv(program: str, exe: str, item: dict, prompt: str, resume: str | None) -> list[str]:
    mode = item.get("permissionMode")
    if program == "codex":
        argv = [exe, *codex_overrides(item["worktree"]), "exec", "--json"]
        if mode in CODEX_SANDBOX:
            argv += ["--sandbox", CODEX_SANDBOX[mode]]
        if resume:
            argv += ["resume", resume]
        return [*argv, _word(prompt)]
    if program == "cursor":
        argv = [exe, "-p", "--output-format", "stream-json"]
        if mode == "plan":
            argv += ["--mode", "plan"]
        if item.get("trusted") is True:
            argv.append("--trust")
        if resume:
            argv += ["--resume", resume]
        return [*argv, _word(prompt)]
    if program == "antigravity":
        argv = [exe, "-p", _word(prompt), "--output-format", "stream-json"]
        if mode in ANTIGRAVITY_MODE:
            argv.append(f"--mode={ANTIGRAVITY_MODE[mode]}")
        if resume:
            argv += ["--conversation", resume]
        return argv
    raise Refused(400, "no such agent program")


def own_events(program: str) -> bool:
    return program in ("codex", "antigravity")


def read_event(program: str, event: dict) -> dict:
    out: dict = {}
    if program == "codex":
        kind = event.get("type")
        if kind == "thread.started" and isinstance(event.get("thread_id"), str):
            out["session"] = event["thread_id"]
        elif kind == "item.completed":
            entry = event.get("item")
            if isinstance(entry, dict) and entry.get("type") == "agent_message" and isinstance(entry.get("text"), str):
                out["text"] = entry["text"]
        elif kind == "turn.completed":
            out["end"] = "done"
        elif kind == "turn.failed":
            error = event.get("error")
            out["end"] = "failed"
            out["text"] = str(error.get("message") or "") if isinstance(error, dict) else str(error or "")
        elif kind == "error":
            out["tail"] = str(event.get("message") or "")
        return out
    if program == "antigravity":
        kind = event.get("event")
        if isinstance(event.get("conversation_id"), str):
            out["session"] = event["conversation_id"]
        if kind == "result":
            result = event.get("result") if isinstance(event.get("result"), dict) else {}
            if isinstance(result.get("conversation_id"), str):
                out["session"] = result["conversation_id"]
            status = result.get("status")
            if status == "SUCCESS":
                out["end"] = "done"
                out["text"] = result["response"] if isinstance(result.get("response"), str) else ""
            else:
                out["end"] = "failed"
                out["text"] = str(result.get("error") or status or "")
        return out
    return out
