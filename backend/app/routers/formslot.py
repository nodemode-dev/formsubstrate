from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from app.core.local_guard import hand_out_token, require_window
from app.services import formslot as svc
from app.services import gates
from app.services import sessions as session_svc

router = APIRouter()


class IndexBody(BaseModel):
    path: str | None = None


class InstallBody(BaseModel):
    mode: Literal["warn", "deny"]


class ConfirmBody(BaseModel):
    id: str = Field(max_length=200)


class GateBody(BaseModel):
    session: str = Field(max_length=200)
    tool: str = Field(default="Write", max_length=200)
    path: str = Field(default="", max_length=4000)
    message: str = Field(default="", max_length=gates.MESSAGE_BODY_MAX)
    slots: list[dict] = Field(default_factory=list, max_length=50)
    tokens: int = 0
    digest: str = Field(default="", max_length=gates.DIGEST_MAX)


class NoteBody(BaseModel):
    session: str = Field(max_length=200)
    tool: str = Field(default="Bash", max_length=200)
    path: str = Field(default="", max_length=4000)
    slot: str = Field(default="", max_length=200)
    kind: str = Field(default="", max_length=20)
    reason: str = Field(default="", max_length=300)
    message: str = Field(default="", max_length=gates.MESSAGE_BODY_MAX)


class AnswerBody(BaseModel):
    choice: Literal["use", "adapt", "write"]


def _fail(err: svc.Refused | session_svc.Refused) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


@router.post("/window-token")
def window_token(request: Request) -> dict:
    return {"token": hand_out_token(request)}


@router.get("/formslot/status")
async def status() -> dict:
    return await svc.status()


@router.get("/formslot/onboard")
async def onboard() -> dict:
    return await svc.onboard()


@router.post("/formslot/start", dependencies=[Depends(require_window)])
async def start() -> dict:
    try:
        return await svc.start()
    except svc.Refused as err:
        raise _fail(err)


@router.post("/formslot/index", dependencies=[Depends(require_window)])
async def index(body: IndexBody | None = None) -> dict:
    try:
        return await svc.index(body.path if body else None)
    except svc.Refused as err:
        raise _fail(err)


@router.post("/formslot/install", dependencies=[Depends(require_window)])
async def install(body: InstallBody) -> dict:
    try:
        return await svc.install(body.mode)
    except svc.Refused as err:
        raise _fail(err)


@router.post("/formslot/mcp", dependencies=[Depends(require_window)])
async def mcp(body: Any = Body(...)):
    try:
        answer = await svc.mcp(body)
    except svc.Refused as err:
        raise _fail(err)
    if answer is None:
        return Response(status_code=202)
    return JSONResponse(answer)


@router.post("/formslot/confirm", dependencies=[Depends(require_window)])
async def confirm(body: ConfirmBody) -> dict:
    try:
        return await svc.confirm(body.id)
    except svc.Refused as err:
        raise _fail(err)


@router.get("/formslot/drift", dependencies=[Depends(require_window)])
async def drift() -> dict:
    try:
        return await svc.drift()
    except svc.Refused as err:
        raise _fail(err)


@router.post("/gates")
async def open_gate(body: GateBody, session_token: str | None = Header(default=None, alias="X-Subform-Session")) -> dict:
    try:
        gates.verify(body.session, session_token)
        return gates.create(body.model_dump())
    except session_svc.Refused as err:
        raise _fail(err)


@router.get("/gates")
def list_gates() -> dict:
    return {"gates": gates.open_list()}


@router.post("/gates/notes")
def add_gate_note(body: NoteBody, session_token: str | None = Header(default=None, alias="X-Subform-Session")) -> dict:
    try:
        gates.verify(body.session, session_token)
        return gates.add_note(body.model_dump())
    except session_svc.Refused as err:
        raise _fail(err)


@router.get("/gates/waived")
def gate_waived(session: str, path: str, slot: str, digest: str, session_token: str | None = Header(default=None, alias="X-Subform-Session")) -> dict:
    try:
        return gates.is_waived(session, session_token, path, slot, digest)
    except session_svc.Refused as err:
        raise _fail(err)


@router.get("/gates/notes", dependencies=[Depends(require_window)])
async def list_gate_notes(session: str) -> dict:
    return {"notes": await gates.live_notes(session)}


@router.post("/gates/{gate_id}/answer", dependencies=[Depends(require_window)])
def answer_gate(gate_id: str, body: AnswerBody) -> dict:
    try:
        return gates.answer(gate_id, body.choice)
    except session_svc.Refused as err:
        raise _fail(err)


@router.get("/gates/{gate_id}/wait")
async def wait_gate(gate_id: str, request: Request, timeout: float = 120, session_token: str | None = Header(default=None, alias="X-Subform-Session")) -> dict:
    try:
        gates.verify_gate(gate_id, session_token)
        return await gates.wait(gate_id, timeout, request)
    except session_svc.Refused as err:
        raise _fail(err)
