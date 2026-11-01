import asyncio
import json
import shutil
import time
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core import workspace_root as ws
from app.core.local_guard import require_window
from app.services.cogentics import catalog, usage
from app.services.cogentics.hub import hub
from app.services.cogentics.llm import PROVIDER_BASES, client as llm
from app.services.cogentics.paths import root as ws_root


def need_workspace() -> None:
    try:
        ws.real_root()
    except ws.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)


router = APIRouter(prefix="/cogentics", dependencies=[Depends(need_workspace)])
owner = [Depends(require_window)]


class ChannelCreate(BaseModel):
    name: str


class MemberCreate(BaseModel):
    handle: str
    role_prompt: str = ""
    kind: str = "agent"
    full_access: bool = False
    model: str = ""


class MemberPatch(BaseModel):
    state: str
    trusted: bool = False


class PostBody(BaseModel):
    body: str
    trusted: bool = False


class Trusted(BaseModel):
    trusted: bool = False


class Decision(BaseModel):
    approved: bool
    by: str = "human"


class ConfigPatch(BaseModel):
    turn_brake: int | None = None
    approval_tools: list[str] | None = None


class ProviderBody(BaseModel):
    provider: str = ""
    base_url: str = ""
    model: str = ""
    api_key: str = ""


def _channel(name: str):
    ch = hub().channel(name)
    if not ch:
        raise HTTPException(404, f"no channel: {name}")
    return ch


@router.get("/status")
async def status() -> dict:
    snap = llm.snapshot()
    return {"llm_configured": snap["configured"], "provider": snap["provider"], "model": snap["model"],
            "claude_cli": bool(shutil.which("claude")), "simulator": not snap["configured"]}


@router.get("/provider")
async def provider() -> dict:
    return llm.snapshot()


@router.put("/provider", dependencies=owner)
async def set_provider(req: ProviderBody) -> dict:
    if req.provider and req.provider not in (*PROVIDER_BASES, "custom"):
        raise HTTPException(400, "provider must be openrouter, ollama, lmstudio or custom")
    try:
        llm.apply(provider=req.provider, base_url=req.base_url, model=req.model, api_key=req.api_key)
    except Exception as e:
        raise HTTPException(503, f"could not save the provider: {e.__class__.__name__}")
    return llm.snapshot()


@router.delete("/provider/key", dependencies=owner)
async def forget_key() -> dict:
    llm.forget_key()
    return llm.snapshot()


@router.post("/provider/test", dependencies=owner)
async def test_provider() -> dict:
    return await llm.test_connection()


@router.get("/channels")
async def list_channels() -> dict:
    return {"channels": hub().list_channels()}


@router.post("/channels", dependencies=owner)
async def create_channel(req: ChannelCreate) -> dict:
    try:
        return hub().create(req.name).to_dict()
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/channels/{name}")
async def get_channel(name: str, after: int = 0) -> dict:
    doc = _channel(name).to_dict()
    if after:
        doc["messages"] = [m for m in doc["messages"] if m["seq"] > after]
    return doc


@router.delete("/channels/{name}", dependencies=owner)
async def delete_channel(name: str) -> dict:
    if not hub().delete(name):
        raise HTTPException(404, f"no channel: {name}")
    return {"ok": True}


@router.post("/channels/{name}/messages", dependencies=owner)
async def post_message(name: str, req: PostBody) -> dict:
    ch = _channel(name)
    if not req.body.strip():
        raise HTTPException(400, "empty message")
    hub().trusted = req.trusted
    try:
        return hub().post(ch, "operator", req.body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/channels/{name}/members", dependencies=owner)
async def add_member(name: str, req: MemberCreate) -> dict:
    ch = _channel(name)
    try:
        return hub().add_member(ch, req.handle, req.role_prompt, kind=req.kind,
                                full_access=req.full_access, model=req.model).to_dict()
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/channels/{name}/config", dependencies=owner)
async def patch_config(name: str, req: ConfigPatch) -> dict:
    ch = _channel(name)
    if req.turn_brake is not None:
        ch.config["turn_brake"] = max(0, min(99, req.turn_brake))
    if req.approval_tools is not None:
        ch.config["approval_tools"] = [t.strip() for t in req.approval_tools if t.strip()][:12]
    hub()._save_meta(ch)
    return {"config": ch.config, "gated": hub().gated_tools(ch)}


@router.get("/models")
async def models(live: bool = True) -> dict:
    if live:
        await catalog.refresh_live(llm)
    return {"catalog": catalog.merged_catalog(), "cli_models": catalog.CLI_MODELS,
            "verified": catalog.CATALOG_DATE, "live": catalog.has_live()}


@router.get("/presets")
async def presets() -> dict:
    return {"presets": [{"name": k, "label": v["label"], "note": v["note"], "members": v["members"]}
                        for k, v in catalog.MEMBER_PRESETS.items()]}


@router.post("/channels/{name}/presets/{preset}", dependencies=owner)
async def install_preset(name: str, preset: str) -> dict:
    ch = _channel(name)
    spec = catalog.MEMBER_PRESETS.get(preset)
    if not spec:
        raise HTTPException(404, f"no preset: {preset}")
    added, skipped = [], []
    for m in spec["members"]:
        try:
            hub().add_member(ch, m["handle"], m["role_prompt"], kind=m["kind"],
                             full_access=m.get("full_access", False), model=m.get("model", ""))
            added.append(m["handle"])
        except ValueError:
            skipped.append(m["handle"])
    return {"added": added, "skipped": skipped}


@router.patch("/channels/{name}/members/{handle}", dependencies=owner)
async def patch_member(name: str, handle: str, req: MemberPatch) -> dict:
    ch = _channel(name)
    if req.state not in ("active", "paused"):
        raise HTTPException(400, "state must be active or paused")
    hub().trusted = req.trusted
    try:
        return hub().set_member_state(ch, handle, req.state).to_dict()
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/channels/{name}/members/{handle}", dependencies=owner)
async def remove_member(name: str, handle: str) -> dict:
    ch = _channel(name)
    if not hub().remove_member(ch, handle):
        raise HTTPException(400, f"cannot remove: {handle}")
    return {"ok": True}


@router.get("/channels/{name}/stream")
async def stream(name: str) -> StreamingResponse:
    _channel(name)
    q = hub().subscribe(name)

    async def gen() -> AsyncIterator[str]:
        try:
            yield "event: hello\ndata: {}\n\n"
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=20.0)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            hub().unsubscribe(name, q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.get("/search")
async def search_all(q: str, limit: int = 20) -> dict:
    h = hub()
    ql = q.lower().strip()
    hits: list[dict] = []
    if not ql:
        return {"hits": []}
    for meta in h.list_channels():
        ch = h.channel(meta["name"])
        if not ch:
            continue
        for m in reversed(ch.messages):
            body = m.get("body") or ""
            if ql in body.lower():
                hits.append({"channel": ch.name, "seq": m.get("seq"), "author": m.get("author"), "snippet": body[:200]})
                if len(hits) >= limit:
                    return {"hits": hits}
    return {"hits": hits}


@router.post("/channels/{name}/archive", dependencies=owner)
async def archive_channel(name: str, keep: int = 200) -> dict:
    h = hub()
    ch = _channel(name)
    keep = max(20, min(keep, 2000))
    if len(ch.messages) <= keep:
        return {"archived": 0, "kept": len(ch.messages)}
    cut = ch.messages[:-keep]
    ch.messages = ch.messages[-keep:]
    ap = h._dir() / f"{name}.archive-{int(time.time())}.jsonl"
    ap.write_text("".join(json.dumps(m) + "\n" for m in cut), encoding="utf-8")
    h._save(ch)
    h._system(ch, f"archived {len(cut)} older messages to {ap.name}")
    return {"archived": len(cut), "kept": keep, "file": ap.name}


@router.post("/channels/{name}/members/{handle}/release", dependencies=owner)
async def release_member(name: str, handle: str, req: Trusted) -> dict:
    h = hub()
    ch = _channel(name)
    if not ch.member(handle):
        raise HTTPException(404, "no such member")
    h.trusted = req.trusted
    return {"released": h.release_held(ch, handle)}


@router.post("/channels/{name}/approvals/{seq}", dependencies=owner)
async def decide(name: str, seq: int, body: Decision) -> dict:
    h = hub()
    ch = _channel(name)
    if not h.decide_approval(ch, seq, body.approved, body.by):
        raise HTTPException(409, "approval is not pending")
    return {"decided": seq, "approved": body.approved}


@router.get("/approvals")
async def approvals() -> dict:
    return {"approvals": hub().pending_approvals()}


@router.get("/channels/{name}/meter")
async def meter(name: str) -> dict:
    ch = _channel(name)
    turns = sum(1 for m in ch.messages
                if m.get("kind") == "run" and m.get("status") == "final" and not m.get("run_parent"))
    agg = usage.meter(ws_root()).for_scope(f"cogentics:{name}:")
    return {"turns": turns, **agg, "groups_open": sum(1 for g in ch.groups if g["status"] == "open")}
