import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.local_guard import require_window
from app.services import agent_programs, formnet

router = APIRouter()

OWNER = [Depends(require_window)]


class AgentPath(BaseModel):
    path: str = Field(default="", max_length=4096)


class FormnetBody(BaseModel):
    enabled: bool | None = None
    certPath: str | None = Field(default=None, max_length=4096)


@router.get("/agents")
async def list_agents() -> dict:
    found = await asyncio.gather(*(asyncio.to_thread(agent_programs.describe, program) for program in agent_programs.ORDER))
    return {"agents": list(found)}


@router.put("/agents/{program}/path", dependencies=OWNER)
async def set_agent_path(program: str, body: AgentPath) -> dict:
    try:
        agent_programs.set_path(program, body.path)
    except agent_programs.Refused as err:
        raise HTTPException(err.status, err.detail) from err
    return await asyncio.to_thread(agent_programs.describe, program)


@router.get("/formnet")
async def formnet_status() -> dict:
    return await asyncio.to_thread(formnet.status)


@router.put("/formnet", dependencies=OWNER)
async def formnet_save(body: FormnetBody) -> dict:
    try:
        return await asyncio.to_thread(formnet.save, body.enabled, body.certPath)
    except formnet.Refused as err:
        raise HTTPException(err.status, err.detail) from err
