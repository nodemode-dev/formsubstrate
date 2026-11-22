import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.local_guard import require_window
from app.services.triggers import hooks
from app.services.triggers.manager import TriggerError, triggers

router = APIRouter()


class TriggerIn(BaseModel):
    kind: str
    spec: dict = Field(default_factory=dict)
    action: dict


class EnableBody(BaseModel):
    enabled: bool


def _fail(err: TriggerError) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


@router.get("/triggers")
async def list_triggers() -> dict:
    return triggers.snapshot()


@router.post("/triggers", dependencies=[Depends(require_window)])
async def add_trigger(body: TriggerIn) -> dict:
    try:
        trig, secret = triggers.add(body.kind, body.spec, body.action)
    except TriggerError as err:
        raise _fail(err)
    return {"trigger": trig, "secret": secret}


@router.patch("/triggers/{tid}", dependencies=[Depends(require_window)])
async def set_enabled(tid: str, body: EnableBody) -> dict:
    try:
        return triggers.set_enabled(tid, body.enabled)
    except TriggerError as err:
        raise _fail(err)


@router.delete("/triggers/{tid}", dependencies=[Depends(require_window)])
async def remove_trigger(tid: str) -> dict:
    try:
        triggers.remove(tid)
    except TriggerError as err:
        raise _fail(err)
    return {"removed": tid}


class TrustBody(BaseModel):
    workspace: str = ""
    trusted: bool = False


@router.post("/triggers/trust", dependencies=[Depends(require_window)])
async def announce_trust(body: TrustBody) -> dict:
    return triggers.set_trust(body.workspace, body.trusted)


@router.post("/triggers/{tid}/confirm", dependencies=[Depends(require_window)])
async def confirm(tid: str) -> dict:
    try:
        return triggers.confirm(tid)
    except TriggerError as err:
        raise _fail(err)


@router.post("/triggers/{tid}/fire", dependencies=[Depends(require_window)])
async def fire_now(tid: str) -> dict:
    try:
        return await triggers.fire(tid, "manual", {"manual": True}, force=True)
    except TriggerError as err:
        raise _fail(err)


@router.get("/triggers/{tid}/webhook", dependencies=[Depends(require_window)])
async def webhook_secret(tid: str) -> dict:
    try:
        return triggers.webhook(tid)
    except TriggerError as err:
        raise _fail(err)


@router.post("/hooks/{tid}")
async def fire_hook(tid: str, request: Request) -> dict:
    snap = triggers.snapshot()
    trig = next((t for t in snap["triggers"] if t["id"] == tid and t["kind"] == "webhook"), None)
    if trig is None:
        raise HTTPException(status_code=404, detail="unknown webhook")
    raw = await request.body()
    if len(raw) > 262144:
        raise HTTPException(status_code=413, detail="the body is larger than 256 KB")
    refusal = hooks.verify(
        tid,
        raw,
        *(request.headers.get(name) or request.headers.get(hooks.OLD_HEADERS[name], "") for name in (hooks.HEADER, hooks.TS_HEADER, hooks.NONCE_HEADER)),
    )
    if refusal:
        raise HTTPException(status_code=429 if refusal.startswith("too many") else 401, detail=refusal)
    try:
        payload = json.loads(raw) if raw else {}
    except ValueError:
        payload = {"raw": raw.decode("utf-8", errors="replace")[:2000]}
    if not isinstance(payload, dict):
        payload = {"payload": payload}
    try:
        return await triggers.fire(tid, "webhook", payload)
    except TriggerError as err:
        raise _fail(err)
