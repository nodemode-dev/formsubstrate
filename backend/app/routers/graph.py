from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from app.core import workspace_root as ws
from app.services import graph as svc

router = APIRouter()


@router.get("/graph")
async def graph(sig: str = "") -> dict:
    try:
        return await run_in_threadpool(svc.compute, sig or None)
    except ws.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)
