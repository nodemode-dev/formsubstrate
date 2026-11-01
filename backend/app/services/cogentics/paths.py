from pathlib import Path

from app.core import workspace_root as ws

STATE_DIR = ".subform"


def root() -> Path:
    return Path(ws.real_root())


def state_dir(base: Path | None = None) -> Path:
    return (base or root()) / STATE_DIR
