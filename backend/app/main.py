import asyncio
import logging
import signal
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core import binres, config, lsp, runtime
from app.core import debug as debug_core
from app.core.engine_addr import remember
from app.core.local_guard import LocalGuard, token_mode
from app.routers import debug, formslot, git, secrets, sessions, skills, system, terminal, workspace
from app.routers import lsp as lsp_router
from app.routers import graph as graph_router
from app.routers import graphs as graphs_router
from app.routers import media as media_router
from app.routers import create as create_router
from app.routers import mcp as mcp_router
from app.routers import mcp_clients as mcp_clients_router
from app.routers import cogentics as cogentics_router
from app.routers import insight as insight_router
from app.services.cogentics.hub import hub as cogentics_hub
from app.routers import harness as harness_router
from app.routers import collections as collections_router
from app.routers import tools as tools_router
from app.routers import plugins as plugins_router
from app.routers import mcp_servers as mcp_servers_router
from app.routers import recipes as recipes_router
from app.routers import triggers as triggers_router
from app.services.triggers.manager import triggers as trigger_service
from app.routers import runs as runs_router
from app.routers import presets as presets_router
from app.services.runs import manager as runs_manager
from app.services import create as create_service
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
    log = logging.getLogger("formsubstrate")
    log.info("%s", token_mode())
    for key in config.DEPRECATED_ENV:
        log.warning("environment variable %s is deprecated and will stop working in the next release; use %s%s (the new name wins when both are set)", key, config.NEW_ENV_PREFIX, key[len(config.OLD_ENV_PREFIX):])
    for note in config.MIGRATION_NOTES:
        log.info("%s", note)
    for note in await asyncio.to_thread(secrets.migrate_keyring):
        log.info("%s", note)
    saved = _end_streams_on_signal()
    binres.warm()
    await session_service.reconcile()
    trigger_service.start()
    yield
    await trigger_service.stop()
    await runs_manager.shutdown()
    session_service.close_streams()
    await create_service.shutdown()
    await cogentics_hub().shutdown()
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
app.include_router(presets_router.router, prefix="/api")
app.include_router(graph_router.router, prefix="/api")
app.include_router(graphs_router.router, prefix="/api")
app.include_router(create_router.router, prefix="/api")
app.include_router(harness_router.router, prefix="/api")
app.include_router(collections_router.router, prefix="/api")
app.include_router(tools_router.router, prefix="/api")
app.include_router(plugins_router.router, prefix="/api")
app.include_router(mcp_servers_router.router, prefix="/api")
app.include_router(recipes_router.router, prefix="/api")
app.include_router(triggers_router.router, prefix="/api")
app.include_router(runs_router.router, prefix="/api")
app.include_router(cogentics_router.router, prefix="/api")
app.include_router(insight_router.router, prefix="/api")
app.include_router(mcp_clients_router.router, prefix="/api")
app.include_router(mcp_router.router)

_dist = config.dist_dir()
if _dist is not None:
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")
