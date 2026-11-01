import asyncio
import signal
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core import config, lsp, runtime
from app.core import debug as debug_core
from app.core.engine_addr import remember
from app.core.local_guard import LocalGuard
from app.routers import debug, formslot, git, secrets, sessions, skills, system, terminal, workspace
from app.routers import lsp as lsp_router
from app.routers import graph as graph_router
from app.routers import media as media_router
from app.routers import create as create_router
from app.routers import mcp as mcp_router
from app.services import sessions as session_service


def _end_streams_on_signal() -> list[tuple[int, object]]:
    loop = asyncio.get_running_loop()
    saved: list[tuple[int, object]] = []
    for name in ("SIGTERM", "SIGINT"):
        number = getattr(signal, name, None)
        if number is None:
            continue
        previous = signal.getsignal(number)

        def handler(signum, frame, previous=previous):
            loop.call_soon_threadsafe(session_service.close_streams)
            if callable(previous):
                previous(signum, frame)

        try:
            signal.signal(number, handler)
        except ValueError:
            continue
        saved.append((number, previous))
    return saved


@asynccontextmanager
async def lifespan(_: FastAPI):
    data = config.data_dir()
    runtime.start_logging(data)
    saved = _end_streams_on_signal()
    await session_service.reconcile()
    yield
    session_service.close_streams()
    for number, previous in saved:
        try:
            signal.signal(number, previous)
        except (ValueError, TypeError):
            pass
    await session_service.shutdown()
    await terminal.shutdown()
    await debug_core.shutdown()
    await lsp.shutdown()
    runtime.stop_logging()
    runtime.release(data)


app = FastAPI(title=config.APP_NAME, version=config.VERSION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.cors_origins(), allow_methods=["*"], allow_headers=["*"])
app.add_middleware(LocalGuard, origins=config.window_origins())

app.include_router(system.router, prefix="/api")
app.include_router(workspace.router, prefix="/api")
app.include_router(secrets.router, prefix="/api")
app.include_router(terminal.router, prefix="/api")
app.include_router(sessions.router, prefix="/api", dependencies=[Depends(remember)])
app.include_router(formslot.router, prefix="/api", dependencies=[Depends(remember)])
app.include_router(skills.router, prefix="/api")
app.include_router(git.router, prefix="/api")
app.include_router(debug.router, prefix="/api")
app.include_router(lsp_router.router, prefix="/api")
app.include_router(media_router.router, prefix="/api")
app.include_router(graph_router.router, prefix="/api")
app.include_router(create_router.router, prefix="/api")
app.include_router(mcp_router.router)

_dist = config.dist_dir()
if _dist is not None:
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")
