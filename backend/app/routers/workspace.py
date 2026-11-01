import fnmatch
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import tomllib

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.core import workspace_root as ws
from app.core.binres import find_bin

router = APIRouter()

READ_MAX = 4 * 1024 * 1024
SNIFF_BYTES = 8192
TEXT_MAX = 240
SEARCH_LIMIT_MAX = 1000
SEARCH_TIMEOUT = 15
FORM_APPS = ("formvis", "formcut", "formwav", "formslot", "formhub", "formnodal", "formbend", "formai", "subform")
FORM_DOC_RE = re.compile(r"\b(" + "|".join(FORM_APPS) + r")\b", re.IGNORECASE)
GUIDE_FILES = ("CLAUDE.md", "AGENTS.md")
UMASK = os.umask(0)
os.umask(UMASK)


def _fail(err: ws.Refused) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


def _guard(rel: str, **kwargs) -> tuple[str, str]:
    try:
        return ws.resolve(rel, **kwargs)
    except ws.Refused as err:
        raise _fail(err)


def _base() -> str:
    try:
        return ws.real_root()
    except ws.Refused as err:
        raise _fail(err)


def _form_name(name: object) -> bool:
    return isinstance(name, str) and (name.lower().startswith("form") or name.lower() == "subform")


def _is_form_repo(root: str) -> bool:
    for guide in GUIDE_FILES:
        try:
            with open(os.path.join(root, guide), "r", encoding="utf-8", errors="replace") as handle:
                if FORM_DOC_RE.search(handle.read(65536)):
                    return True
        except OSError:
            continue
    try:
        with open(os.path.join(root, "package.json"), "r", encoding="utf-8") as handle:
            if _form_name(json.load(handle).get("name")):
                return True
    except (OSError, ValueError, AttributeError):
        pass
    try:
        with open(os.path.join(root, "Cargo.toml"), "rb") as handle:
            package = tomllib.load(handle).get("package")
            if isinstance(package, dict) and _form_name(package.get("name")):
                return True
    except (OSError, ValueError):
        pass
    return False


def _branch(root: str) -> str | None:
    git = shutil.which("git")
    if not git:
        return None
    try:
        result = subprocess.run([git, "rev-parse", "--abbrev-ref", "HEAD"], cwd=root, capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    text = result.stdout.strip()
    return text if result.returncode == 0 and text else None


def _state() -> dict:
    root = ws.current()
    if root is None:
        return {"root": None, "name": None, "isFormRepo": False, "branch": None}
    return {"root": root, "name": ws.display_name(root), "isFormRepo": _is_form_repo(root), "branch": _branch(root)}


@router.get("/workspace")
def get_workspace() -> dict:
    return _state()


@router.post("/workspace/open")
async def open_workspace(request: Request) -> dict:
    body = await request.json()
    path = body.get("path") if isinstance(body, dict) else None
    if not isinstance(path, str) or not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="path must be absolute")
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail="not a directory")
    root = ws.set_current(path)
    ws.push_recent(root)
    return _state()


@router.get("/workspace/recent")
def get_recent() -> dict:
    return {"recent": ws.recent_list()}


@router.delete("/workspace/recent")
async def delete_recent(request: Request) -> dict:
    body = await request.json()
    path = body.get("path") if isinstance(body, dict) else None
    if not isinstance(path, str):
        raise HTTPException(status_code=400, detail="path required")
    ws.drop_recent(path)
    return {"recent": ws.recent_list()}


def _entry(rel: str, item: os.DirEntry) -> dict:
    try:
        info = item.stat()
        is_dir = item.is_dir()
    except OSError:
        info = item.stat(follow_symlinks=False)
        is_dir = False
    return {
        "name": item.name,
        "path": f"{rel}/{item.name}" if rel else item.name,
        "kind": "dir" if is_dir else "file",
        "size": 0 if is_dir else info.st_size,
        "mtime": info.st_mtime,
    }


@router.get("/workspace/tree")
def tree(path: str = "") -> dict:
    real, rel = _guard(path)
    if not os.path.isdir(real):
        raise HTTPException(status_code=404, detail="not a directory")
    entries = []
    try:
        with os.scandir(real) as scan:
            for item in scan:
                if item.name in ws.HIDDEN_NAMES:
                    continue
                try:
                    entries.append(_entry(rel, item))
                except OSError:
                    continue
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    entries.sort(key=lambda e: (e["kind"] != "dir", e["name"].lower(), e["name"]))
    return {"path": rel, "entries": entries}


def _is_binary(chunk: bytes) -> bool:
    return b"\0" in chunk


@router.get("/workspace/file")
def read_file(path: str) -> dict:
    real, rel = _guard(path)
    try:
        info = os.stat(real)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="not found")
    except OSError:
        raise HTTPException(status_code=404, detail="not readable")
    if not os.path.isfile(real):
        raise HTTPException(status_code=400, detail="not a file")
    if info.st_size > READ_MAX:
        return JSONResponse({"detail": "file is larger than 4 MiB"}, status_code=415)
    try:
        with open(real, "rb") as handle:
            data = handle.read(READ_MAX + 1)
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    if len(data) > READ_MAX:
        return JSONResponse({"detail": "file is larger than 4 MiB"}, status_code=415)
    if _is_binary(data[:SNIFF_BYTES]):
        return JSONResponse({"detail": "binary file"}, status_code=415)
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return JSONResponse({"detail": "not UTF-8 text"}, status_code=415)
    return {"path": rel, "text": text, "size": info.st_size, "mtime": info.st_mtime}


def _atomic_write(target: str, data: bytes) -> None:
    folder = os.path.dirname(target)
    fd, temp = tempfile.mkstemp(prefix=".sf-", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.chmod(temp, os.stat(target).st_mode & 0o7777)
        except FileNotFoundError:
            os.chmod(temp, 0o666 & ~UMASK)
        os.replace(temp, target)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


@router.put("/workspace/file")
async def write_file(request: Request) -> dict:
    body = await request.json()
    if not isinstance(body, dict) or not isinstance(body.get("path"), str) or not isinstance(body.get("text"), str):
        raise HTTPException(status_code=400, detail="path and text required")
    expected = body.get("expectedMtime")
    if expected is not None and (isinstance(expected, bool) or not isinstance(expected, (int, float))):
        raise HTTPException(status_code=400, detail="expectedMtime must be a number or null")
    real, rel = _guard(body["path"], write=True)
    if not rel:
        raise HTTPException(status_code=400, detail="path required")
    if os.path.isdir(real):
        raise HTTPException(status_code=400, detail="path is a directory")
    if not os.path.isdir(os.path.dirname(real)):
        raise HTTPException(status_code=404, detail="parent folder does not exist")
    if expected is not None:
        try:
            current = os.stat(real).st_mtime
        except FileNotFoundError:
            raise HTTPException(status_code=409, detail="file no longer exists")
        if abs(current - float(expected)) > 1e-6:
            raise HTTPException(status_code=409, detail="file changed on disk")
    try:
        data = body["text"].encode("utf-8")
    except UnicodeEncodeError:
        raise HTTPException(status_code=400, detail="text is not valid unicode")
    try:
        _atomic_write(real, data)
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    info = os.stat(real)
    return {"path": rel, "size": info.st_size, "mtime": info.st_mtime}


async def _json(request: Request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="body must be json")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be an object")
    return body


def _need(body: dict, key: str) -> str:
    value = body.get(key)
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail=f"{key} required")
    return value


@router.post("/workspace/mkdir")
async def mkdir(request: Request) -> dict:
    body = await _json(request)
    real, rel = _guard(_need(body, "path"), write=True)
    if not rel:
        raise HTTPException(status_code=400, detail="path required")
    if os.path.lexists(real):
        raise HTTPException(status_code=409, detail="already exists")
    try:
        os.makedirs(real)
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    return {"path": rel}


@router.post("/workspace/rename")
async def rename(request: Request) -> dict:
    body = await _json(request)
    src, src_rel = _guard(_need(body, "from"), write=True, follow=False)
    dst, dst_rel = _guard(_need(body, "to"), write=True, follow=False)
    if not src_rel or not dst_rel:
        raise HTTPException(status_code=400, detail="paths required")
    if not os.path.lexists(src):
        raise HTTPException(status_code=404, detail="not found")
    if os.path.lexists(dst):
        raise HTTPException(status_code=409, detail="already exists")
    if not os.path.isdir(os.path.dirname(dst)):
        raise HTTPException(status_code=404, detail="parent folder does not exist")
    try:
        os.rename(src, dst)
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    return {"from": src_rel, "to": dst_rel}


@router.post("/workspace/delete")
async def delete(request: Request) -> dict:
    body = await _json(request)
    real, rel = _guard(_need(body, "path"), write=True, follow=False)
    if not rel:
        raise HTTPException(status_code=400, detail="cannot delete the workspace root")
    if not os.path.lexists(real):
        raise HTTPException(status_code=404, detail="not found")
    try:
        if os.path.isdir(real) and not os.path.islink(real):
            if os.listdir(real):
                raise HTTPException(status_code=409, detail="folder is not empty")
            os.rmdir(real)
        else:
            os.unlink(real)
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    return {"path": rel}


def _trim(text: str) -> str:
    return text.strip()[:TEXT_MAX]


def _rg_search(rg: str, base: str, q: str, regex: bool, case: bool, glob: str, cap: int) -> list[dict]:
    args = [rg, "--json", "--hidden", "--no-ignore", "--no-messages", "--max-columns", "2000", "--case-sensitive" if case else "--ignore-case"]
    for name in ws.HIDDEN_NAMES:
        args += ["--glob", f"!{name}"]
    if glob:
        args += ["--glob", glob]
    if not regex:
        args.append("--fixed-strings")
    args += ["-e", q, "--", "."]
    proc = subprocess.Popen(args, cwd=base, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    hits: list[dict] = []
    timer = threading.Timer(SEARCH_TIMEOUT, proc.kill)
    timer.start()
    try:
        assert proc.stdout is not None
        for raw in proc.stdout:
            try:
                event = json.loads(raw)
            except ValueError:
                continue
            if event.get("type") != "match":
                continue
            data = event["data"]
            path = data.get("path", {}).get("text")
            text = data.get("lines", {}).get("text")
            if path is None or text is None:
                continue
            sub = (data.get("submatches") or [{}])[0]
            start = sub.get("start") or 0
            col = len(text.encode("utf-8")[:start].decode("utf-8", errors="ignore")) + 1
            rel = path[2:] if path.startswith("./") else path
            hits.append({"path": rel.replace("\\", "/"), "line": data.get("line_number") or 1, "col": col, "text": _trim(text)})
            if len(hits) > cap:
                proc.kill()
                break
        proc.wait()
        stderr = proc.stderr.read() if proc.stderr else ""
    finally:
        timer.cancel()
    if proc.returncode not in (0, 1, -9) and not hits:
        raise HTTPException(status_code=400, detail=(stderr.strip().splitlines() or ["search failed"])[0][:200])
    return hits


def _py_search(base: str, q: str, regex: bool, case: bool, glob: str, cap: int) -> list[dict]:
    try:
        pattern = re.compile(q if regex else re.escape(q), 0 if case else re.IGNORECASE)
    except re.error as err:
        raise HTTPException(status_code=400, detail=f"bad pattern: {err}")
    hits: list[dict] = []
    for folder, dirs, files in os.walk(base):
        dirs[:] = sorted(d for d in dirs if d not in ws.HIDDEN_NAMES and not os.path.islink(os.path.join(folder, d)))
        for name in sorted(files):
            full = os.path.join(folder, name)
            rel = os.path.relpath(full, base).replace(os.sep, "/")
            if os.path.islink(full):
                continue
            if glob and not (fnmatch.fnmatch(rel, glob) or fnmatch.fnmatch(name, glob)):
                continue
            try:
                if os.path.getsize(full) > READ_MAX:
                    continue
                with open(full, "rb") as handle:
                    data = handle.read()
            except OSError:
                continue
            if _is_binary(data[:SNIFF_BYTES]):
                continue
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                continue
            for number, line in enumerate(text.splitlines(), 1):
                found = pattern.search(line)
                if found:
                    hits.append({"path": rel, "line": number, "col": found.start() + 1, "text": _trim(line)})
                    if len(hits) > cap:
                        return hits
    return hits


@router.get("/workspace/search")
def search(q: str = "", regex: bool = False, case: bool = False, glob: str = "", limit: int = 200) -> dict:
    if not q:
        raise HTTPException(status_code=400, detail="q required")
    base = _base()
    cap = min(SEARCH_LIMIT_MAX, max(1, limit))
    rg = find_bin("rg")
    if rg:
        engine = "rg"
        hits = _rg_search(rg, base, q, bool(regex), bool(case), glob.strip(), cap)
    else:
        engine = "python"
        hits = _py_search(base, q, bool(regex), bool(case), glob.strip(), cap)
    return {"hits": hits[:cap], "truncated": len(hits) > cap, "engine": engine}
