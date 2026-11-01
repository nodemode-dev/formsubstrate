import shutil
import subprocess

from fastapi import APIRouter

from app.core import config

router = APIRouter()

GIT_PREFIX = "git version "


def git_version() -> str | None:
    found = shutil.which("git")
    if not found:
        return None
    try:
        result = subprocess.run([found, "--version"], capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    text = result.stdout.strip()
    if result.returncode != 0 or not text:
        return None
    return text[len(GIT_PREFIX):] if text.startswith(GIT_PREFIX) else text


@router.get("/system/status")
def status() -> dict:
    return {
        "app": config.APP_NAME,
        "version": config.VERSION,
        "engine": "python",
        "data_dir": str(config.data_dir()),
        "git": git_version(),
        "claude": shutil.which("claude"),
    }
