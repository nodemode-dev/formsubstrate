import contextvars
import difflib
import json
import shutil
import time
from pathlib import Path
from typing import Optional

from app.services.cogentics.paths import state_dir

_scope: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "subform_checkpoint_scope", default=None)


def _root_dir(ws_root: Path) -> Path:
    return state_dir(ws_root) / "checkpoints"


def _safe_id(scope_id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in scope_id)[:80]


def enter(scope_id: str, label: str, ws_root: Path) -> contextvars.Token:
    d = _root_dir(ws_root) / _safe_id(scope_id)
    d.mkdir(parents=True, exist_ok=True)
    mf = d / "manifest.json"
    if not mf.exists():
        mf.write_text(json.dumps({"id": scope_id, "label": label,
                                  "created": time.time(), "files": {}}))
    return _scope.set(scope_id)


def leave(token: contextvars.Token) -> None:
    _scope.reset(token)


def active_scope() -> Optional[str]:
    return _scope.get()


def _manifest(ws_root: Path, scope_id: str) -> tuple[Path, dict]:
    mf = _root_dir(ws_root) / _safe_id(scope_id) / "manifest.json"
    try:
        return mf, json.loads(mf.read_text())
    except (OSError, ValueError):
        return mf, {"id": scope_id, "label": "", "created": time.time(), "files": {}}


def record_change(ws_root: Path, rel: str, op: str) -> None:
    scope_id = _scope.get()
    if not scope_id:
        return
    mf, man = _manifest(ws_root, scope_id)
    entry = man["files"].get(rel)
    src = ws_root / rel
    if entry is None:
        pre_dir = mf.parent / "pre"
        if src.exists() and src.is_file():
            dst = pre_dir / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(src, dst)
                entry = {"pre": "present"}
            except OSError:
                entry = {"pre": "unreadable"}
        else:
            entry = {"pre": "absent"}
        man["files"][rel] = entry
    entry["last_op"] = op
    entry["ts"] = time.time()
    try:
        mf.write_text(json.dumps(man))
    except OSError:
        return


def scopes(ws_root: Path, limit: int = 60) -> list[dict]:
    base = _root_dir(ws_root)
    if not base.is_dir():
        return []
    out = []
    for d in base.iterdir():
        mf = d / "manifest.json"
        try:
            man = json.loads(mf.read_text())
        except (OSError, ValueError):
            continue
        files = man.get("files") or {}
        last = max([e.get("ts", 0) for e in files.values()] or [man.get("created", 0)])
        out.append({"id": man.get("id", d.name), "label": man.get("label", ""),
                    "created": man.get("created", 0), "last": last,
                    "files": len(files)})
    out.sort(key=lambda s: s["last"], reverse=True)
    return out[:limit]


def changes(ws_root: Path, scope_id: str) -> list[dict]:
    _, man = _manifest(ws_root, scope_id)
    out = []
    for rel, entry in sorted(man.get("files", {}).items()):
        cur = ws_root / rel
        pre = entry.get("pre")
        if pre == "absent":
            status = "added" if cur.exists() else "created+removed"
        elif not cur.exists() or entry.get("last_op") == "delete":
            status = "deleted"
        else:
            status = "modified"
        out.append({"path": rel, "status": status, "pre": pre})
    return out


def _read_lines(p: Path) -> list[str]:
    try:
        return p.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    except OSError:
        return []


def diff(ws_root: Path, scope_id: str, rel: str, context: int = 3) -> str:
    pre_p = _root_dir(ws_root) / _safe_id(scope_id) / "pre" / rel
    _, man = _manifest(ws_root, scope_id)
    entry = man.get("files", {}).get(rel) or {}
    before = [] if entry.get("pre") == "absent" else _read_lines(pre_p)
    after = _read_lines(ws_root / rel)
    lines = difflib.unified_diff(before, after, fromfile=f"a/{rel}",
                                 tofile=f"b/{rel}", n=context)
    text = "".join(lines)
    return text[:200_000] if text else "(no textual difference)"


def revert(ws_root: Path, scope_id: str, rel: str) -> dict:
    _, man = _manifest(ws_root, scope_id)
    entry = man.get("files", {}).get(rel)
    if entry is None:
        return {"error": f"not tracked by this scope: {rel}"}
    cur = ws_root / rel
    if entry.get("pre") == "absent":
        if cur.exists():
            cur.unlink()
        return {"reverted": rel, "action": "removed"}
    pre_p = _root_dir(ws_root) / _safe_id(scope_id) / "pre" / rel
    if not pre_p.exists():
        return {"error": f"pre-image missing for {rel}"}
    cur.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(pre_p, cur)
    return {"reverted": rel, "action": "restored"}


def unified_preview(before: str, after: str, rel: str) -> str:
    lines = difflib.unified_diff(before.splitlines(keepends=True),
                                 after.splitlines(keepends=True),
                                 fromfile=f"a/{rel}", tofile=f"b/{rel}", n=3)
    return "".join(lines)[:40_000]


def file_versions(ws_root: Path, scope_id: str, rel: str) -> dict:
    _, man = _manifest(ws_root, scope_id)
    entry = (man.get("files") or {}).get(rel) or {}
    before = ""
    if entry.get("pre") not in (None, "absent"):
        pre_p = _root_dir(ws_root) / _safe_id(scope_id) / "pre" / rel
        try:
            before = pre_p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            before = ""
    cur = ws_root / rel
    after = ""
    if cur.is_file():
        try:
            after = cur.read_text(encoding="utf-8", errors="replace")
        except OSError:
            after = ""
    return {"before": before, "after": after}
