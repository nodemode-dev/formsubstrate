import sys
from pathlib import Path

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.core import config
from app.services import sessions as svc

router = APIRouter()


def builtin_folders() -> list[Path]:
    folders = [config.BACKEND_DIR / "skills"]
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        folders.append(Path(bundle) / "skills")
    return folders


def list_all() -> list[dict]:
    skills = svc.list_skills()
    seen = {(item["name"], item["source"]) for item in skills}
    for folder in builtin_folders():
        for item in svc._scan_skills(folder, "built-in", None):
            if (item["name"], item["source"]) not in seen:
                seen.add((item["name"], item["source"]))
                skills.append(item)
    return skills


@router.get("/skills")
async def skills() -> dict:
    return {"skills": await run_in_threadpool(list_all)}
