from pathlib import Path

from app import __version__

APP_NAME = "{{name}}"
VERSION = __version__
FRONTEND_PORT = {{port_frontend}}
PREVIEW_PORT = {{port_preview}}
BACKEND_PORT = {{port_engine}}
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


def window_origins() -> list[str]:
    ports = (FRONTEND_PORT, PREVIEW_PORT, BACKEND_PORT)
    return [f"http://{host}:{port}" for port in ports for host in ("localhost", "127.0.0.1")]
