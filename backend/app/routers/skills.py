from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.services import sessions as svc

router = APIRouter()


@router.get("/skills")
async def skills() -> dict:
    return {"skills": await run_in_threadpool(svc.list_skills)}
