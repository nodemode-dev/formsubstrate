import os
import stat
from pathlib import PurePosixPath

SKIP = frozenset({".git", "node_modules", "__pycache__", ".venv", "venv", "target", "dist", ".formsubstrate", ".subform"})
MAX_FILES = 6000


def valid_glob(glob: str) -> bool:
    return bool(glob) and len(glob) <= 200 and not glob.startswith(("/", "\\")) and ".." not in glob.split("/") and ":" not in glob


def _pattern(glob: str) -> str:
    return glob + "/**" if glob.endswith("/") else glob


def scan(root: str, glob: str) -> dict[str, tuple[int, int]]:
    pattern = _pattern(glob)
    found: dict[str, tuple[int, int]] = {}
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP]
        rel_base = os.path.relpath(base, root).replace(os.sep, "/")
        for name in files:
            rel = name if rel_base == "." else f"{rel_base}/{name}"
            if not PurePosixPath(rel).full_match(pattern):
                continue
            try:
                info = os.lstat(os.path.join(base, name))
            except OSError:
                continue
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                continue
            found[rel] = (info.st_mtime_ns, info.st_size)
            if len(found) >= MAX_FILES:
                return found
    return found


def changed(before: dict[str, tuple[int, int]], after: dict[str, tuple[int, int]]) -> list[str]:
    return sorted(set(before) ^ set(after) | {p for p in after if p in before and after[p] != before[p]})
