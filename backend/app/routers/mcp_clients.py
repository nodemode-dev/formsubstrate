import asyncio

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.core.local_guard import require_window
from app.services import mcp_clients

router = APIRouter(dependencies=[Depends(require_window)])

NO_STORE = {"Cache-Control": "no-store"}


class NewClient(BaseModel):
    name: str


@router.get("/mcp-clients")
async def list_clients(response: Response) -> dict:
    response.headers.update(NO_STORE)
    return {"clients": await asyncio.to_thread(mcp_clients.list_clients)}


@router.post("/mcp-clients")
async def add_client(body: NewClient, response: Response) -> dict:
    try:
        client, token = await asyncio.to_thread(mcp_clients.create, body.name)
    except mcp_clients.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)
    except OSError:
        raise HTTPException(status_code=500, detail="the client list could not be saved in the data folder")
    response.headers.update(NO_STORE)
    return {"client": client, "token": token}


@router.delete("/mcp-clients/{client_id}", status_code=204)
async def remove_client(client_id: str) -> Response:
    try:
        await asyncio.to_thread(mcp_clients.revoke, client_id)
    except mcp_clients.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)
    except OSError:
        raise HTTPException(status_code=500, detail="the client list could not be saved in the data folder")
    return Response(status_code=204)
