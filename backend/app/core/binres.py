import os
import shutil
import sys
from pathlib import Path

BIN_ENV = "FORMSUBSTRATE_BIN_DIR"
SHELL_WAIT = 10.0
AGENT_OVERRIDES = {
    "claude": ("FORMSUBSTRATE_CLAUDE_BIN",),
    "codex": ("FORMSUBSTRATE_CODEX_BIN",),
    "cursor": ("FORMSUBSTRATE_CURSOR_BIN",),
    "antigravity": ("FORMSUBSTRATE_ANTIGRAVITY_BIN",),
}


def vendor_dirs() -> list[Path]:
    found = []
    raw = os.environ.get(BIN_ENV, "")
    if raw:
        found.append(Path(raw).expanduser())
    bundled = getattr(sys, "_MEIPASS", "")
    if bundled:
        found.append(Path(bundled) / "bin")
    return found


def find_bin(name: str) -> str | None:
    for folder in vendor_dirs():
        for candidate in (folder / name, folder / f"{name}.exe"):
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
    return shutil.which(name) or shutil.which(name, path=wide_path())


def wide_path() -> str:
    from app.services import agent_lookup

    return agent_lookup.child_env(None, shell_timeout=SHELL_WAIT)["PATH"]


def find_agent(program: str = "claude") -> str | None:
    from app.services import agent_lookup

    for folder in vendor_dirs():
        for name in agent_lookup.PROGRAMS[program]["names"]:
            for candidate in (folder / name, folder / f"{name}.exe"):
                if agent_lookup.runnable(candidate):
                    return str(candidate)
    return agent_lookup.find(program, override_vars=AGENT_OVERRIDES.get(program, ()), shell_timeout=SHELL_WAIT).path


def agent_env(env: dict[str, str], path: str | None = None) -> dict[str, str]:
    from app.services import agent_lookup

    kept = frozenset(key for key in env if key.startswith("CLAUDE"))
    return agent_lookup.child_env(path, base=env, shell_timeout=SHELL_WAIT, keep=kept)


def agent_argv(argv: list[str]) -> list[str]:
    from app.services import agent_lookup

    return agent_lookup.start_argv(argv) if agent_lookup.windows() else list(argv)


def warm() -> None:
    import threading

    threading.Thread(target=wide_path, name="formsubstrate-path-warm", daemon=True).start()
