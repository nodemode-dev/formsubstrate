from typing import Any, Literal

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

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
    session: str
    tool: str = "Write"
    path: str = ""
    message: str = ""
    slots: list[dict] = Field(default_factory=list, max_length=50)
    tokens: int = 0


class AnswerBody(BaseModel):
    choice: Literal["use", "adapt", "write"]


def _fail(err: svc.Refused | session_svc.Refused) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


@router.get("/formslot/status")
async def status() -> dict:
    return await svc.status()


@router.post("/formslot/start")
async def start() -> dict:
    try:
        return await svc.start()
    except svc.Refused as err:
        raise _fail(err)


@router.post("/formslot/index")
async def index(body: IndexBody | None = None) -> dict:
    try:
        return await svc.index(body.path if body else None)
    except svc.Refused as err:
        raise _fail(err)


@router.post("/formslot/install")
async def install(body: InstallBody) -> dict:
    try:
        return await svc.install(body.mode)
    except svc.Refused as err:
        raise _fail(err)


@router.post("/formslot/mcp")
async def mcp(body: Any = Body(...)):
    try:
        answer = await svc.mcp(body)
    except svc.Refused as err:
        raise _fail(err)
    if answer is None:
        return Response(status_code=202)
    return JSONResponse(answer)


@router.post("/formslot/confirm")
async def confirm(body: ConfirmBody) -> dict:
    try:
        return await svc.confirm(body.id)
    except svc.Refused as err:
        raise _fail(err)


@router.get("/formslot/drift")
async def drift() -> dict:
    try:
        return await svc.drift()
    except svc.Refused as err:
        raise _fail(err)


@router.post("/gates")
async def open_gate(body: GateBody) -> dict:
    try:
        return gates.create(body.model_dump())
    except session_svc.Refused as err:
        raise _fail(err)


@router.get("/gates")
def list_gates() -> dict:
    return {"gates": gates.open_list()}


@router.post("/gates/{gate_id}/answer")
def answer_gate(gate_id: str, body: AnswerBody) -> dict:
    try:
        return gates.answer(gate_id, body.choice)
    except session_svc.Refused as err:
        raise _fail(err)


@router.get("/gates/{gate_id}/wait")
async def wait_gate(gate_id: str, request: Request, timeout: float = 120) -> dict:
    try:
        return await gates.wait(gate_id, timeout, request)
    except session_svc.Refused as err:
        raise _fail(err)
