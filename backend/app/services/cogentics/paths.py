import hashlib
import os
import re
from pathlib import Path

from app.core import config
from app.core import workspace_root as ws

SAFE_REF = re.compile(r"^(?!-)[A-Za-z0-9._:/@-]{1,120}$")

SENSITIVE_PREFIXES = (".subform/plugins", ".subform/cogentics", ".claude", ".mcp.json", ".git")


def root() -> Path:
    return Path(ws.real_root())


def state_dir(base: Path | None = None) -> Path:
    real = os.path.realpath(str(base or root()))
    key = hashlib.sha256(real.encode("utf-8")).hexdigest()[:24]
    d = config.data_dir() / "cogentics-state" / key
    d.mkdir(parents=True, exist_ok=True)
    return d


def valid_ref(value: str) -> bool:
    return bool(SAFE_REF.match(value or ""))


def has_symlink(rel: str, base: Path | None = None) -> bool:
    cur = base or root()
    for part in [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]:
        cur = cur / part
        if cur.is_symlink():
            return True
    return False


def safe_target(rel: str) -> tuple[Path, str]:
    real, clean = ws.resolve(rel, write=True)
    if has_symlink(clean):
        raise ws.Refused(403, "symlinked path components are refused")
    return Path(real), clean


def is_sensitive(rel: str) -> bool:
    try:
        real, clean = ws.resolve(rel, write=True)
    except ws.Refused:
        return True
    low = clean.lower()
    rlow = os.path.relpath(real, ws.real_root()).replace(os.sep, "/").lower()
    for cand in (low, rlow):
        for pre in SENSITIVE_PREFIXES:
            if cand == pre or cand.startswith(pre + "/"):
                return True
    return has_symlink(clean)
