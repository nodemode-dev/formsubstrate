import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from app import __version__

APP_NAME = "formsubstrate"
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

OLD_NAME = "subform"
OLD_ENV_PREFIX = "SUBFORM_"
NEW_ENV_PREFIX = "FORMSUBSTRATE_"
MARKER_NAME = ".migrated-from-subform.json"
USER_DATA = (
    "recent.json",
    "secrets-index.json",
    "identity.json",
    "allowed_signers",
    "library",
    "triggers",
    "cogentics-provider.json",
    "cogentics-models.json",
)
DEPRECATED_ENV: list[str] = []
MIGRATION_NOTES: list[str] = []


def _adopt_old_env() -> None:
    for key in sorted(os.environ):
        if not key.startswith(OLD_ENV_PREFIX):
            continue
        new_key = NEW_ENV_PREFIX + key[len(OLD_ENV_PREFIX):]
        if new_key not in os.environ:
            os.environ[new_key] = os.environ[key]
        os.environ.pop(key, None)
        DEPRECATED_ENV.append(key)


_adopt_old_env()


def _ensure(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def portable_dir() -> Path | None:
    frozen = getattr(sys, "frozen", False)
    beside = Path(sys.executable).resolve().parent if frozen else BACKEND_DIR
    if os.environ.get("FORMSUBSTRATE_PORTABLE") == "1" or (frozen and any((beside / name).is_file() for name in ("portable", "portable.txt"))):
        return beside / "FormSubstrateData"
    return None


def platform_data_dir() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "formsubstrate"
    if sys.platform.startswith("win"):
        return Path(os.environ.get("APPDATA") or home / "AppData" / "Roaming") / "formsubstrate"
    base = Path(os.environ.get("XDG_DATA_HOME") or ".")
    return (base if base.is_absolute() else home / ".local" / "share") / "formsubstrate"


def _old_platform_dir() -> Path:
    return platform_data_dir().with_name(OLD_NAME)


def _copy_old_data(old: Path, new: Path) -> None:
    staging = new.with_name(new.name + ".migrating")
    if staging.exists():
        shutil.rmtree(staging, ignore_errors=True)
    new.parent.mkdir(parents=True, exist_ok=True)
    kept: list[str] = []
    try:
        staging.mkdir()
        for name in USER_DATA:
            source = old / name
            if source.is_symlink() or not source.exists():
                continue
            if source.is_dir():
                shutil.copytree(source, staging / name, symlinks=True)
            else:
                shutil.copy2(source, staging / name)
            kept.append(name)
        marker = {"from": str(old), "at": datetime.now(timezone.utc).isoformat(), "copied": kept, "old_left_in_place": True}
        (staging / MARKER_NAME).write_text(json.dumps(marker), encoding="utf-8")
        os.replace(staging, new)
    except OSError as error:
        shutil.rmtree(staging, ignore_errors=True)
        MIGRATION_NOTES.append(f"could not copy the old data folder {old} to {new}: {error.__class__.__name__}; the old folder was left alone")
        return
    MIGRATION_NOTES.append(f"copied the old data folder {old} to {new} once; the old folder was left in place")


def _migrate_data_dir() -> None:
    if os.environ.get("FORMSUBSTRATE_DATA_DIR"):
        return
    portable = portable_dir()
    if portable:
        old, new = portable.with_name("SubformData"), portable
    else:
        home = Path.home()
        if (home / "Subform").is_dir():
            old, new = home / "Subform", home / "FormSubstrate"
            if not new.exists() and platform_data_dir().exists():
                new = platform_data_dir()
        elif (home / "FormSubstrate").exists():
            return
        else:
            old, new = _old_platform_dir(), platform_data_dir()
    if not old.is_dir():
        return
    if new.exists():
        MIGRATION_NOTES.append(f"both the old data folder {old} and the new one {new} exist; the old one was left alone")
        return
    _copy_old_data(old, new)


def old_data_dir() -> Path | None:
    if os.environ.get("FORMSUBSTRATE_DATA_DIR"):
        return None
    portable = portable_dir()
    candidates = [portable.with_name("SubformData")] if portable else [Path.home() / "Subform", _old_platform_dir()]
    return next((item for item in candidates if item.is_dir()), None)


_migrated = False


def data_dir() -> Path:
    global _migrated
    raw = os.environ.get("FORMSUBSTRATE_DATA_DIR")
    if raw:
        return _ensure(Path(raw).expanduser())
    if not _migrated:
        _migrated = True
        _migrate_data_dir()
    portable = portable_dir()
    if portable:
        return _ensure(portable)
    path = Path.home() / "FormSubstrate"
    if path.exists():
        return _ensure(path)
    return _ensure(platform_data_dir())


def data_dir_source() -> str:
    if os.environ.get("FORMSUBSTRATE_DATA_DIR"):
        return "override"
    return "portable" if portable_dir() else "default"


def dist_dir() -> Path | None:
    raw = os.environ.get("FORMSUBSTRATE_DIST")
    folder = Path(raw).expanduser() if raw else REPO_DIR / "frontend" / "dist"
    return folder if (folder / "index.html").is_file() else None


def is_desktop() -> bool:
    return os.environ.get("FORMSUBSTRATE_DESKTOP") == "1"


def cors_origins() -> list[str]:
    raw = os.environ.get("FORMSUBSTRATE_CORS_ORIGINS")
    if raw:
        return [item.strip() for item in raw.split(",") if item.strip()]
    return [f"http://localhost:{FRONTEND_PORT}", f"http://127.0.0.1:{FRONTEND_PORT}"]


def window_origins() -> list[str]:
    preview = FRONTEND_PORT + 1
    return [*cors_origins(), f"http://localhost:{preview}", f"http://127.0.0.1:{preview}", "tauri://localhost", "http://tauri.localhost"]
