from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.core.local_guard import require_window
from app.services import gitops, sessions as sv

router = APIRouter()
OWNER = [Depends(require_window)]

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
    force: bool = False


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
    hunk: str | None = Field(default=None, max_length=200000)
    text: str = ""


class WorktreeFileBody(BaseModel):
    session: str = ""
    path: str = ""
    text: str | None = Field(default=None, max_length=8 * 1024 * 1024)
    expectedMtime: float | None = None


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


@router.get("/git/audit")
async def audit(session: str | None = None) -> dict:
    try:
        return await gitops.agent_audit(await gitops.resolve_target(session))
    except gitops.Refused as err:
        raise _fail(err)


@router.put("/git/worktree-file", dependencies=OWNER)
async def worktree_file(body: WorktreeFileBody) -> dict:
    try:
        if not body.session:
            raise gitops.Refused(400, "session required")
        t = await gitops.resolve_target(body.session)
        async with gitops.lock_for(t):
            return await gitops.write_worktree_file(t, body.path, body.text, body.expectedMtime)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/hunks", dependencies=OWNER)
async def hunks(body: HunksBody) -> dict:
    try:
        t = await gitops.resolve_target(body.session)
        async with gitops.lock_for(t):
            return await gitops.hunks_action(t, body.path, body.hunks, body.action)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/stage", dependencies=OWNER)
async def stage(body: PathsBody):
    return await _locked(body.session, lambda t: gitops.stage(t, body.paths, body.force))


class TakeBody(BaseModel):
    session: str | None = None
    path: str = ""
    side: str = ""


@router.post("/git/conflicts/take", dependencies=OWNER)
async def conflicts_take(body: TakeBody):
    return await _locked(body.session, lambda t: gitops.take_side(t, body.path, body.side))


@router.post("/git/unstage", dependencies=OWNER)
async def unstage(body: PathsBody) -> dict:
    try:
        t = await gitops.resolve_target(body.session)
        async with gitops.lock_for(t):
            return await gitops.unstage(t, body.paths)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/discard", dependencies=OWNER)
async def discard(body: PathsBody) -> dict:
    try:
        t = await gitops.resolve_target(body.session)
        async with gitops.lock_for(t):
            return await gitops.discard(t, body.paths, body.untracked)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/commit", dependencies=OWNER)
async def commit(body: CommitBody) -> dict:
    try:
        t = await gitops.resolve_target(body.session)
        async with gitops.lock_for(t):
            return await gitops.commit(t, body.message, body.amend, body.all)
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


@router.put("/git/identity", dependencies=OWNER)
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


@router.post("/git/snapshots", dependencies=OWNER)
async def snapshot(body: SnapshotBody) -> dict:
    try:
        t = await gitops.resolve_target(body.session)
        async with gitops.lock_for(t):
            return await gitops.snapshot_create(t, body.label)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/rewind", dependencies=OWNER)
async def rewind(body: RewindBody) -> dict:
    try:
        t = await gitops.resolve_target(body.session)
        async with gitops.lock_for(t):
            return await gitops.rewind(t, body.n)
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/comments", dependencies=OWNER)
async def comments(body: CommentBody) -> dict:
    try:
        target = await gitops.resolve_target(body.session or None)
        if target.session is None:
            raise gitops.Refused(400, "comments need a session")
        text = gitops.CONTROL_RE.sub("", body.text).strip()
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


@router.post("/git/push", dependencies=OWNER)
async def push(body: PushBody) -> dict:
    try:
        t = await gitops.resolve_target(body.session)
        async with gitops.lock_for(t):
            return await gitops.push(t, body.remote, body.branch)
    except gitops.Refused as err:
        if err.extra:
            return JSONResponse(status_code=err.status, content={"detail": err.detail, **err.extra})
        raise _fail(err)


@router.post("/git/sign-and-push", dependencies=OWNER)
async def sign_and_push(body: PushBody):
    try:
        t = await gitops.resolve_target(body.session)
        async with gitops.lock_for(t):
            return await gitops.sign_and_push(t, body.remote, body.branch)
    except gitops.Refused as err:
        if err.extra:
            return JSONResponse(status_code=err.status, content={"detail": err.detail, **err.extra})
        raise _fail(err)


class BranchBody(BaseModel):
    session: str | None = None
    name: str = ""
    start: str | None = None
    switch: bool = False
    force: bool = False


class FetchBody(BaseModel):
    session: str | None = None
    remote: str | None = None
    prune: bool = True


class PullBody(BaseModel):
    session: str | None = None
    mode: str = "ff-only"


class StashBody(BaseModel):
    session: str | None = None
    message: str = Field(default="", max_length=TEXT_MAX)
    untracked: bool = False


class StashPickBody(BaseModel):
    session: str | None = None
    index: int = -1
    sha: str = ""
    pop: bool = False


class TagBody(BaseModel):
    session: str | None = None
    name: str = ""
    message: str = Field(default="", max_length=TEXT_MAX)
    ref: str | None = None
    remote: str = "origin"


def _answer(err: gitops.Refused):
    if err.extra:
        return JSONResponse(status_code=err.status, content={"detail": err.detail, **err.extra})
    raise _fail(err)


async def _locked(session: str | None, job):
    try:
        t = await gitops.resolve_target(session)
        async with gitops.lock_for(t):
            return await job(t)
    except gitops.Refused as err:
        return _answer(err)


@router.get("/git/branches")
async def branches(session: str | None = None) -> dict:
    try:
        return await gitops.branches(await gitops.resolve_target(session))
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/branches", dependencies=OWNER)
async def branch_create(body: BranchBody):
    return await _locked(body.session, lambda t: gitops.branch_create(t, body.name, body.start, body.switch))


@router.post("/git/switch", dependencies=OWNER)
async def branch_switch(body: BranchBody):
    return await _locked(body.session, lambda t: gitops.branch_switch(t, body.name))


@router.post("/git/branches/delete", dependencies=OWNER)
async def branch_delete(body: BranchBody):
    return await _locked(body.session, lambda t: gitops.branch_delete(t, body.name, body.force))


@router.post("/git/fetch", dependencies=OWNER)
async def fetch(body: FetchBody):
    return await _locked(body.session, lambda t: gitops.fetch(t, body.remote, body.prune))


@router.post("/git/pull", dependencies=OWNER)
async def pull(body: PullBody):
    return await _locked(body.session, lambda t: gitops.pull(t, body.mode))


@router.get("/git/stashes")
async def stashes(session: str | None = None) -> dict:
    try:
        return {"stashes": await gitops.stash_list(await gitops.resolve_target(session))}
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/stashes", dependencies=OWNER)
async def stash_push(body: StashBody):
    return await _locked(body.session, lambda t: gitops.stash_push(t, body.message, body.untracked))


@router.post("/git/stashes/apply", dependencies=OWNER)
async def stash_apply(body: StashPickBody):
    return await _locked(body.session, lambda t: gitops.stash_apply(t, body.index, body.sha, body.pop))


@router.post("/git/stashes/drop", dependencies=OWNER)
async def stash_drop(body: StashPickBody):
    return await _locked(body.session, lambda t: gitops.stash_drop(t, body.index, body.sha))


@router.get("/git/tags")
async def tags(session: str | None = None) -> dict:
    try:
        return {"tags": await gitops.tag_list(await gitops.resolve_target(session))}
    except gitops.Refused as err:
        raise _fail(err)


@router.post("/git/tags", dependencies=OWNER)
async def tag_create(body: TagBody):
    return await _locked(body.session, lambda t: gitops.tag_create(t, body.name, body.message, body.ref))


@router.post("/git/tags/push", dependencies=OWNER)
async def tag_push(body: TagBody):
    return await _locked(body.session, lambda t: gitops.tag_push(t, body.name, body.remote))
