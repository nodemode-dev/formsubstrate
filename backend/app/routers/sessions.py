import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.services import sessions as svc

router = APIRouter()

HEARTBEAT = 15


class NewSession(BaseModel):
    title: str = ""
    mode: str = "interactive"
    prompt: str | None = Field(default=None, max_length=100_000)
    base: str | None = None


def _fail(err: svc.Refused) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


def _frame(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


@router.get("/sessions")
def list_all() -> dict:
    return {"sessions": svc.list_sessions()}


@router.get("/sessions/events")
async def events() -> StreamingResponse:
    queue = svc.subscribe()

    async def stream():
        try:
            yield "retry: 2000\n\n"
            for item in svc.list_sessions():
                yield _frame("session", item)
            while True:
                try:
                    event, payload = await asyncio.wait_for(queue.get(), HEARTBEAT)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield _frame(event, payload)
        finally:
            svc.unsubscribe(queue)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/sessions")
async def create(body: NewSession) -> dict:
    try:
        return await svc.create(body.title, body.mode, body.prompt, body.base)
    except svc.Refused as err:
        raise _fail(err)


@router.post("/sessions/{session_id}/resume")
async def resume(session_id: str) -> dict:
    try:
        return await svc.resume(session_id)
    except svc.Refused as err:
        raise _fail(err)


@router.post("/sessions/{session_id}/stop")
async def stop(session_id: str) -> dict:
    try:
        return await svc.stop(session_id)
    except svc.Refused as err:
        raise _fail(err)


@router.delete("/sessions/{session_id}", status_code=204)
async def delete(session_id: str, removeWorktree: int = 0, force: int = 0) -> Response:
    try:
        await svc.delete(session_id, bool(removeWorktree), bool(force))
    except svc.Refused as err:
        raise _fail(err)
    return Response(status_code=204)
