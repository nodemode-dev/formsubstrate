import os
import sys
from pathlib import Path

from app import __version__

APP_NAME = "subform"
VERSION = __version__
FRONTEND_PORT = 5650
BACKEND_PORT = 5655
BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


def _load_env_file() -> None:
    env_file = BACKEND_DIR / ".env"
    if not env_file.is_file():
        return
    for entry in env_file.read_text(encoding="utf-8").splitlines():
        entry = entry.strip()
        if not entry or entry.startswith("#") or "=" not in entry:
            continue
        key, _, value = entry.partition("=")
        key, value = key.strip(), value.strip()
        if key and value:
            os.environ.setdefault(key, value)


_load_env_file()


def _ensure(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def portable_dir() -> Path | None:
    frozen = getattr(sys, "frozen", False)
    beside = Path(sys.executable).resolve().parent if frozen else BACKEND_DIR
    if os.environ.get("SUBFORM_PORTABLE") == "1" or (frozen and any((beside / name).is_file() for name in ("portable", "portable.txt"))):
        return beside / "SubformData"
    return None


def platform_data_dir() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "subform"
    if sys.platform.startswith("win"):
        return Path(os.environ.get("APPDATA") or home / "AppData" / "Roaming") / "subform"
    base = Path(os.environ.get("XDG_DATA_HOME") or ".")
    return (base if base.is_absolute() else home / ".local" / "share") / "subform"


def data_dir() -> Path:
    raw = os.environ.get("SUBFORM_DATA_DIR")
    if raw:
        return _ensure(Path(raw).expanduser())
    portable = portable_dir()
    if portable:
        return _ensure(portable)
    path = Path.home() / "Subform"
    if path.exists():
        return _ensure(path)
    return _ensure(platform_data_dir())


def data_dir_source() -> str:
    if os.environ.get("SUBFORM_DATA_DIR"):
        return "override"
    return "portable" if portable_dir() else "default"


def dist_dir() -> Path | None:
    raw = os.environ.get("SUBFORM_DIST")
    folder = Path(raw).expanduser() if raw else REPO_DIR / "frontend" / "dist"
    return folder if (folder / "index.html").is_file() else None


def is_desktop() -> bool:
    return os.environ.get("SUBFORM_DESKTOP") == "1"


def cors_origins() -> list[str]:
    raw = os.environ.get("SUBFORM_CORS_ORIGINS")
    if raw:
        return [item.strip() for item in raw.split(",") if item.strip()]
    return [f"http://localhost:{FRONTEND_PORT}", f"http://127.0.0.1:{FRONTEND_PORT}"]


def window_origins() -> list[str]:
    preview = FRONTEND_PORT + 1
    return [*cors_origins(), f"http://localhost:{preview}", f"http://127.0.0.1:{preview}", "tauri://localhost", "http://tauri.localhost"]
