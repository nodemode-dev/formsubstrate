import os
import shutil
import sys
from pathlib import Path

BIN_ENV = "FORMSUBSTRATE_BIN_DIR"


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
    return shutil.which(name)
