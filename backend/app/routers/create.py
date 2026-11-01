from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.core.local_guard import require_window
from app.services import create as svc

router = APIRouter(dependencies=[Depends(require_window)])


class CloneBody(BaseModel):
    url: str = Field(max_length=svc.URL_MAX)
    dest: str = Field(max_length=4096)
    folder: str = Field(default="", max_length=120)


class AppBody(BaseModel):
    name: str = Field(max_length=64)
    kind: str = Field(max_length=32)
    dest: str = Field(max_length=4096)
    port: int


def _fail(err: svc.Refused) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


@router.post("/create/clone")
async def clone(body: CloneBody) -> dict:
    try:
        return await svc.start_clone(body.url, body.dest, body.folder)
    except svc.Refused as err:
        raise _fail(err)


@router.get("/create/jobs/{job_id}")
async def job(job_id: str) -> dict:
    try:
        return svc.get_job(job_id)
    except svc.Refused as err:
        raise _fail(err)


@router.post("/create/jobs/{job_id}/cancel")
async def cancel(job_id: str) -> dict:
    try:
        return await svc.cancel_job(job_id)
    except svc.Refused as err:
        raise _fail(err)


@router.get("/create/options")
async def options(dest: str | None = Query(default=None, max_length=4096)) -> dict:
    try:
        return await svc.options(dest)
    except svc.Refused as err:
        raise _fail(err)


@router.get("/create/port")
async def port(base: int, dest: str | None = Query(default=None, max_length=4096)) -> dict:
    try:
        clean = await run_in_threadpool(svc._clean_dest, dest) if dest else None
    except svc.Refused as err:
        raise _fail(err)
    problem = await run_in_threadpool(svc.check_block, base, clean)
    return {"ok": not problem, "problem": problem}


@router.post("/create/app")
async def app(body: AppBody) -> dict:
    try:
        return await svc.create_app(body.name, body.kind, body.dest, body.port)
    except svc.Refused as err:
        raise _fail(err)
