import os
import stat
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core import workspace_root as ws

router = APIRouter()

IMAGE_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "svg": "image/svg+xml",
    "bmp": "image/bmp",
    "ico": "image/x-icon",
    "avif": "image/avif",
}
VIDEO_TYPES = {
    "mp4": "video/mp4",
    "m4v": "video/mp4",
    "webm": "video/webm",
    "mov": "video/quicktime",
    "mkv": "video/x-matroska",
    "ogv": "video/ogg",
}
AUDIO_TYPES = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "oga": "audio/ogg",
    "opus": "audio/ogg",
    "flac": "audio/flac",
    "m4a": "audio/mp4",
    "aac": "audio/aac",
}
PDF_TYPES = {"pdf": "application/pdf"}
KINDS = (("image", IMAGE_TYPES), ("video", VIDEO_TYPES), ("audio", AUDIO_TYPES), ("pdf", PDF_TYPES))


def _kind_of(name: str) -> tuple[str, str] | None:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    for kind, table in KINDS:
        if ext in table:
            return kind, table[ext]
    return None


def _file(path: str) -> tuple[str, str, str, os.stat_result]:
    try:
        real, rel = ws.resolve(path)
    except ws.Refused as err:
        raise HTTPException(status_code=err.status, detail=err.detail)
    found = _kind_of(rel)
    if found is None:
        raise HTTPException(status_code=415, detail="not a previewable media type")
    try:
        info = os.stat(real)
    except OSError:
        raise HTTPException(status_code=404, detail="not found")
    if not stat.S_ISREG(info.st_mode):
        raise HTTPException(status_code=400, detail="not a file")
    return real, found[0], found[1], info


@router.get("/media/info")
def media_info(path: str) -> dict:
    real, kind, mime, info = _file(path)
    return {"path": path, "kind": kind, "type": mime, "size": info.st_size, "mtime": info.st_mtime}


@router.api_route("/media/raw", methods=["GET", "HEAD"])
def media_raw(path: str) -> FileResponse:
    real, kind, mime, info = _file(path)
    if not os.access(real, os.R_OK):
        raise HTTPException(status_code=403, detail="permission denied")
    headers = {
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(os.path.basename(real))}",
    }
    if kind != "pdf":
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src 'self'"
    return FileResponse(real, media_type=mime, headers=headers)
