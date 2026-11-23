import asyncio
import json

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.local_guard import require_window
from app.services import ide_link
from app.services import sessions as session_service

router = APIRouter()
OWNER = [Depends(require_window)]
HEARTBEAT = 15.0


class Settings(BaseModel):
    enabled: bool


def _frame(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


@router.get("/ide/settings")
async def read_settings() -> dict:
    return ide_link.status()


@router.put("/ide/settings", dependencies=OWNER)
async def write_settings(body: Settings) -> dict:
    return await ide_link.set_enabled(body.enabled)


@router.post("/ide/state", dependencies=OWNER)
async def post_state(body: dict = Body(...)) -> dict:
    await ide_link.sync()
    ide_link.set_state(body)
    return {"running": ide_link.status()["running"]}


@router.post("/ide/reply", dependencies=OWNER)
async def post_reply(body: dict = Body(...)) -> dict:
    return {"taken": ide_link.reply(body)}


@router.post("/ide/mention", dependencies=OWNER)
async def post_mention(body: dict = Body(...)) -> dict:
    try:
        return {"sent": ide_link.mention(body)}
    except ide_link.Refused as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/ide/events")
async def events() -> StreamingResponse:
    queue = ide_link.subscribe()
    closing = session_service.subscribe()

    async def stream():
        own = asyncio.ensure_future(queue.get())
        end = asyncio.ensure_future(closing.get())
        try:
            yield "retry: 2000\n\n"
            while True:
                done, _ = await asyncio.wait({own, end}, timeout=HEARTBEAT, return_when=asyncio.FIRST_COMPLETED)
                if end in done:
                    if end.result()[0] == session_service.CLOSE:
                        return
                    end = asyncio.ensure_future(closing.get())
                if own in done:
                    event, payload = own.result()
                    own = asyncio.ensure_future(queue.get())
                    yield _frame(event, payload)
                if not done:
                    yield ": keepalive\n\n"
        finally:
            own.cancel()
            end.cancel()
            ide_link.unsubscribe(queue)
            session_service.unsubscribe(closing)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
