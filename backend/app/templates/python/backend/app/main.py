from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import config

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
    f"connect-src 'self' http://127.0.0.1:{config.BACKEND_PORT} http://localhost:{config.BACKEND_PORT}; "
    "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)

LOOPBACK = {"127.0.0.1", "localhost", "::1"}
PORTS = {config.FRONTEND_PORT, config.PREVIEW_PORT, config.BACKEND_PORT}


def split_host(value: str) -> tuple[str, int | None]:
    value = value.strip().lower()
    if value.startswith("["):
        name, _, rest = value[1:].partition("]")
        port = rest[1:] if rest.startswith(":") else ""
    elif value.count(":") == 1:
        name, _, port = value.partition(":")
    else:
        name, port = value, ""
    return name, int(port) if port.isdigit() else None


class LocalGuard:
    def __init__(self, inner) -> None:
        self.inner = inner
        self.origins = set(config.window_origins())

    def permitted(self, headers: dict[str, str]) -> bool:
        name, port = split_host(headers.get("host", ""))
        if name not in LOOPBACK or port not in PORTS:
            return False
        origin = headers.get("origin")
        if origin is None:
            return headers.get("sec-fetch-site", "").strip().lower() != "cross-site"
        return origin.strip().lower() in self.origins

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.inner(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        if self.permitted(headers):
            await self.inner(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4403})
            return
        body = b'{"detail":"this app answers this computer only"}'
        await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


app = FastAPI(title=config.APP_NAME, version=config.VERSION)
app.add_middleware(CORSMiddleware, allow_origins=config.window_origins(), allow_methods=["*"], allow_headers=["*"])
app.add_middleware(LocalGuard)


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
