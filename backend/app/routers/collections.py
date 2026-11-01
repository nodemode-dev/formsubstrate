from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.core import workspace_root as ws
from app.core.local_guard import require_window
from app.services.library import collections as svc

router = APIRouter(prefix="/collections")


class DocIn(BaseModel):
    collection: str
    text: str
    meta: dict[str, Any] = Field(default_factory=dict)


async def _run(fn, *args):
    try:
        return await run_in_threadpool(fn, *args)
    except ws.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)


@router.get("")
async def list_collections() -> dict:
    try:
        return {"collections": await run_in_threadpool(svc.list_collections)}
    except ws.Refused as err:
        if err.status == 409:
            return {"collections": [], "workspace": False}
        raise HTTPException(status_code=err.status, detail=err.detail)


@router.get("/search")
async def search(collection: str, query: str, k: int = 4) -> dict:
    return {"hits": await _run(svc.search, collection, query, k)}


@router.get("/docs/list")
async def list_docs(collection: str, limit: int = 50) -> dict:
    return {"docs": await _run(svc.list_docs, collection, limit)}


@router.post("/docs", dependencies=[Depends(require_window)])
async def add(body: DocIn) -> dict:
    return await _run(svc.add_doc, body.collection, body.text, body.meta)


@router.delete("/{collection}", dependencies=[Depends(require_window)])
async def remove(collection: str) -> dict:
    return await _run(svc.delete_collection, collection)
