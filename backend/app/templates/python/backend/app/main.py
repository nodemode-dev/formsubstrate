from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import config

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
    f"connect-src 'self' http://127.0.0.1:{config.BACKEND_PORT} http://localhost:{config.BACKEND_PORT}; "
    "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)

app = FastAPI(title=config.APP_NAME, version=config.VERSION)
app.add_middleware(CORSMiddleware, allow_origins=config.window_origins(), allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = CSP
    return response


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "app": config.APP_NAME, "version": config.VERSION}


if (config.FRONTEND_DIR / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR), html=True), name="frontend")
