import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core import workspace_root as ws
from app.core.local_guard import require_window
from app.services import tasks

router = APIRouter()
OWNER = [Depends(require_window)]


class RunBody(BaseModel):
    label: str = Field(min_length=1, max_length=tasks.LABEL_MAX)
    cols: int = Field(default=100, ge=1, le=1000)
    rows: int = Field(default=30, ge=1, le=500)


class StopBody(BaseModel):
    label: str | None = Field(default=None, max_length=tasks.LABEL_MAX)


def _refused(err: ws.Refused) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


@router.get("/tasks")
async def list_tasks() -> dict:
    return await asyncio.to_thread(tasks.listing)


@router.get("/tasks/state")
async def task_state() -> dict:
    return tasks.state()


@router.post("/tasks/run", dependencies=OWNER)
async def run_task(body: RunBody) -> dict:
    try:
        return await tasks.run(body.label, body.cols, body.rows)
    except ws.Refused as err:
        raise _refused(err)


@router.post("/tasks/stop", dependencies=OWNER)
async def stop_task(body: StopBody) -> dict:
    try:
        return await tasks.stop(body.label)
    except ws.Refused as err:
        raise _refused(err)


@router.post("/tasks/file", dependencies=OWNER)
async def create_task_file() -> dict:
    try:
        return await asyncio.to_thread(tasks.create_file)
    except ws.Refused as err:
        raise _refused(err)
