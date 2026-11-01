from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core import config, runtime
from app.core.local_guard import LocalGuard
from app.routers import secrets, sessions, skills, system, terminal, workspace
from app.services import sessions as session_service


@asynccontextmanager
async def lifespan(_: FastAPI):
    data = config.data_dir()
    runtime.start_logging(data)
    await session_service.reconcile()
    yield
    await session_service.shutdown()
    await terminal.shutdown()
    runtime.stop_logging()
    runtime.release(data)


app = FastAPI(title=config.APP_NAME, version=config.VERSION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.cors_origins(), allow_methods=["*"], allow_headers=["*"])
app.add_middleware(LocalGuard, origins=config.window_origins())

app.include_router(system.router, prefix="/api")
app.include_router(workspace.router, prefix="/api")
app.include_router(secrets.router, prefix="/api")
app.include_router(terminal.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(skills.router, prefix="/api")

_dist = config.dist_dir()
if _dist is not None:
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")
