from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services import gitops, sessions as sv

router = APIRouter()

TEXT_MAX = 4000
COMMENTS_MAX = 200


class HunksBody(BaseModel):
    session: str | None = None
    path: str = ""
    hunks: list[str] = []
    action: str = ""


class PathsBody(BaseModel):
    session: str | None = None
    paths: list[str] = []
    untracked: bool = False


class CommitBody(BaseModel):
    session: str | None = None
    message: str = ""
    amend: bool = False
    all: bool = False


class IdentityBody(BaseModel):
    name: str = ""
    email: str = ""
    sign: bool = False
    signingKey: str = ""


class SnapshotBody(BaseModel):
    session: str | None = None
    label: str | None = None


class RewindBody(BaseModel):
    session: str | None = None
    n: int = 0


class CommentBody(BaseModel):
    session: str = ""
    path: str = ""
    line: int | None = None
    hunk: str | None = None
    text: str = ""


class PushBody(BaseModel):
    session: str | None = None
    remote: str = "origin"
    branch: str | None = None


def _fail(err: gitops.Refused) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


@router.get("/git/status")
async def status(session: str | None = None) -> dict:
    try:
        return await gitops.status(await gitops.resolve_target(session))
    except gitops.Refused as err:
        raise _fail(err)


@router.get("/git/diff")
async def diff(path: str, staged: int = 0, session: str | None = None) -> dict:
    try:
        return await gitops.diff_file(await gitops.resolve_target(session), path, bool(staged))
    except gitops.Refused as err:
        raise _fail(err)


@router.get("/git/review")
async def review(session: str | None = None) -> dict:
    try:
        return await gitops.review(await gitops.resolve_target(session))
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/hunks")
async def hunks(body: HunksBody) -> dict:
    try:
        return await gitops.hunks_action(await gitops.resolve_target(body.session), body.path, body.hunks, body.action)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/stage")
async def stage(body: PathsBody) -> dict:
    try:
        return await gitops.stage(await gitops.resolve_target(body.session), body.paths)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/unstage")
async def unstage(body: PathsBody) -> dict:
    try:
        return await gitops.unstage(await gitops.resolve_target(body.session), body.paths)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/discard")
async def discard(body: PathsBody) -> dict:
    try:
        return await gitops.discard(await gitops.resolve_target(body.session), body.paths, body.untracked)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/commit")
async def commit(body: CommitBody) -> dict:
    try:
        return await gitops.commit(await gitops.resolve_target(body.session), body.message, body.amend, body.all)
    except gitops.Refused as err:
        raise _fail(err)


@router.get("/git/log")
async def log(session: str | None = None, limit: int = 50, ref: str | None = None) -> dict:
    try:
        return await gitops.log(await gitops.resolve_target(session), limit, ref)
    except gitops.Refused as err:
        raise _fail(err)


@router.get("/git/identity")
async def identity() -> dict:
    return await gitops.identity_get()


@router.put("/git/identity")
async def set_identity(body: IdentityBody) -> dict:
    try:
        return await gitops.identity_put(body.name, body.email, body.sign, body.signingKey)
    except gitops.Refused as err:
        raise _fail(err)


@router.get("/git/snapshots")
async def snapshots(session: str | None = None) -> dict:
    try:
        return {"snapshots": await gitops.snapshot_list(await gitops.resolve_target(session))}
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/snapshots")
async def snapshot(body: SnapshotBody) -> dict:
    try:
        return await gitops.snapshot_create(await gitops.resolve_target(body.session), body.label)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/rewind")
async def rewind(body: RewindBody) -> dict:
    try:
        return await gitops.rewind(await gitops.resolve_target(body.session), body.n)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/comments")
async def comments(body: CommentBody) -> dict:
    try:
        target = await gitops.resolve_target(body.session or None)
        if target.session is None:
            raise gitops.Refused(400, "comments need a session")
        text = body.text.strip()
        if not 1 <= len(text) <= TEXT_MAX:
            raise gitops.Refused(400, "the comment must be 1 to 4000 characters")
        path = gitops.clean_path(target.root, body.path)
        line = body.line if body.line is None or body.line >= 1 else None
        comment = sv.record_comment(target.session, path, line, body.hunk, text, COMMENTS_MAX)
        where = f"{path}:{line}" if line else path
        sent = await sv.send_feedback(target.session, f"Review comment on {where}: {text}")
        return {"sent": sent, "comment": comment}
    except gitops.Refused as err:
        raise _fail(err)
    except sv.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)


@router.post("/git/push")
async def push(body: PushBody) -> dict:
    try:
        return await gitops.push(await gitops.resolve_target(body.session), body.remote, body.branch)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/sign-and-push")
async def sign_and_push(body: PushBody):
    try:
        return await gitops.sign_and_push(await gitops.resolve_target(body.session), body.remote, body.branch)
    except gitops.Refused as err:
        if err.extra:
            return JSONResponse(status_code=err.status, content={"detail": err.detail, **err.extra})
        raise _fail(err)
