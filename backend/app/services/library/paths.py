import os
import re
from pathlib import Path

from app.core import config
from app.core import workspace_root as ws

FOLDER = ".formsubstrate"
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def refuse_link(path: Path) -> Path:
    if path.is_symlink():
        raise ws.Refused(403, "a symbolic link inside .formsubstrate is refused")
    return path


def workspace_dir(*parts: str) -> Path:
    base = ws.real_root()
    rel = "/".join([FOLDER, *parts])
    real, clean = ws.resolve(rel, write=True, follow=False)
    walked = base
    for part in clean.split("/"):
        walked = os.path.join(walked, part)
        if os.path.islink(walked):
            raise ws.Refused(403, "a symbolic link inside .formsubstrate is refused")
    if os.path.realpath(real) != os.path.join(base, *clean.split("/")):
        raise ws.Refused(403, "a symbolic link inside .formsubstrate is refused")
    return Path(real)


def library_dir() -> Path:
    folder = config.data_dir() / "library"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def clean_name(value: str, what: str = "name") -> str:
    name = (value or "").strip().lower()
    if not NAME_RE.fullmatch(name):
        raise ws.Refused(400, f"{what} must be 1 to 64 characters: lowercase letters, digits, dash or underscore, starting with a letter or digit")
    return name


def atomic_write(target: Path, text: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + ".tmp")
    temp.write_text(text, encoding="utf-8")
    os.replace(temp, target)
