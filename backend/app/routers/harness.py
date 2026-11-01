import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core import workspace_root as ws
from app.core.local_guard import require_window

router = APIRouter()

ROOT = ".subform"
FILE_MAX = 400_000
FILES_MAX = 500
IMPORT_MAX = 4_000_000
GROUPS = ("graphs", "recipes", "skills", "plugins", "collections", "triggers", "runs")


def _tree() -> tuple[str, list[str]]:
    try:
        base = ws.real_root()
    except ws.Refused as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    top = os.path.join(base, ROOT)
    found: list[str] = []
    if os.path.isdir(top) and not os.path.islink(top):
        for here, dirs, names in os.walk(top, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not os.path.islink(os.path.join(here, d)))
            for name in sorted(names):
                full = os.path.join(here, name)
                if os.path.islink(full):
                    continue
                found.append(os.path.relpath(full, base).replace(os.sep, "/"))
                if len(found) >= FILES_MAX:
                    return base, found
    return base, found


@router.get("/harness/summary")
def summary() -> dict:
    _, files = _tree()
    groups = {g: 0 for g in GROUPS}
    other = 0
    for f in files:
        part = f.split("/")[1] if f.count("/") >= 2 else ""
        if part in groups:
            groups[part] += 1
        else:
            other += 1
    return {"present": bool(files), "files": len(files), "groups": groups, "other": other, "truncated": len(files) >= FILES_MAX}


@router.get("/harness/export")
def export() -> dict:
    base, files = _tree()
    out: dict[str, str] = {}
    skipped: list[str] = []
    for rel in files:
        full = os.path.join(base, *rel.split("/"))
        try:
            if os.path.getsize(full) > FILE_MAX:
                skipped.append(rel)
                continue
            with open(full, "r", encoding="utf-8") as fh:
                out[rel] = fh.read()
        except (OSError, UnicodeDecodeError):
            skipped.append(rel)
    return {"harness": {"version": 1, "files": out}, "skipped": skipped}


class Harness(BaseModel):
    harness: dict


@router.post("/harness/import", dependencies=[Depends(require_window)])
def import_harness(body: Harness) -> dict:
    files = body.harness.get("files")
    if not isinstance(files, dict):
        raise HTTPException(status_code=400, detail="the harness has no files")
    if len(files) > FILES_MAX:
        raise HTTPException(status_code=413, detail="too many files in the harness")
    total = 0
    plan: list[tuple[str, str]] = []
    for path, content in files.items():
        if not isinstance(path, str) or not isinstance(content, str):
            raise HTTPException(status_code=400, detail="the harness holds a bad entry")
        if not path.startswith(ROOT + "/"):
            continue
        total += len(content.encode("utf-8"))
        if total > IMPORT_MAX:
            raise HTTPException(status_code=413, detail="the harness is too large")
        try:
            real, _ = ws.resolve(path, write=True)
        except ws.Refused as e:
            raise HTTPException(status_code=e.status, detail=e.detail)
        plan.append((real, content))
    for real, content in plan:
        os.makedirs(os.path.dirname(real), exist_ok=True)
        temp = real + ".tmp"
        with open(temp, "w", encoding="utf-8", newline="") as fh:
            fh.write(content)
        os.replace(temp, real)
    return {"written": len(plan)}
