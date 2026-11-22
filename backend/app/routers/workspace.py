import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import threading
import tomllib
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from app.core import workspace_root as ws
from app.core.binres import find_bin
from app.core.local_guard import require_window
from app.services import textsearch as ts

router = APIRouter()
OWNER = [Depends(require_window)]

READ_MAX = 4 * 1024 * 1024
WRITE_MAX = 8 * 1024 * 1024
GUIDE_MAX = 1024 * 1024
SNIFF_BYTES = 8192
TEXT_MAX = 240
SEARCH_LIMIT_MAX = 1000
SEARCH_TIMEOUT = 15
FORM_APPS = ("formvis", "formcut", "formwav", "formslot", "formhub", "formnodal", "formbend", "formai", "formsubstrate", "subform")
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


def _regular(path: str) -> bool:
    try:
        info = os.stat(path)
    except OSError:
        return False
    return stat.S_ISREG(info.st_mode) and info.st_size <= GUIDE_MAX


def _form_name(name: object) -> bool:
    return isinstance(name, str) and (name.lower().startswith("form") or name.lower() == "subform")


def _is_form_repo(root: str) -> bool:
    for guide in GUIDE_FILES:
        if not _regular(os.path.join(root, guide)):
            continue
        try:
            with open(os.path.join(root, guide), "r", encoding="utf-8", errors="replace") as handle:
                if FORM_DOC_RE.search(handle.read(65536)):
                    return True
        except OSError:
            continue
    try:
        if _regular(os.path.join(root, "package.json")):
            with open(os.path.join(root, "package.json"), "r", encoding="utf-8") as handle:
                if _form_name(json.load(handle).get("name")):
                    return True
    except (OSError, ValueError, AttributeError):
        pass
    try:
        if not _regular(os.path.join(root, "Cargo.toml")):
            return False
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


def _local_tools(root: str) -> list[str]:
    from app.core import debug as debug_core
    from app.core import lsp as lsp_core

    found: list[str] = []
    for lang in lsp_core.LANGS.values():
        for cand in lang["candidates"]:
            if lsp_core._local(root, cand["exe"]) and cand["name"] not in found:
                found.append(cand["name"])
    if debug_core.venv_python(root):
        found.append("workspace python")
    return found


def _state() -> dict:
    root = ws.current()
    if root is None:
        return {"root": None, "name": None, "isFormRepo": False, "branch": None, "localTools": []}
    return {"root": root, "name": ws.display_name(root), "isFormRepo": _is_form_repo(root), "branch": _branch(root), "localTools": _local_tools(root)}


@router.get("/workspace")
def get_workspace() -> dict:
    return _state()


@router.post("/workspace/open", dependencies=OWNER)
async def open_workspace(request: Request) -> dict:
    body = await _json(request)
    path = body.get("path")
    if not isinstance(path, str) or not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="path must be absolute")
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail="not a directory")
    root = ws.set_current(path)
    ws.push_recent(root)
    return await run_in_threadpool(_state)


def _git_summary(root: str) -> dict:
    git = shutil.which("git")
    if not git or not os.path.isdir(os.path.join(root, ".git")):
        return {"branch": None, "changed": 0}
    try:
        result = subprocess.run([git, "status", "--porcelain", "-b", "-uno"], cwd=root, capture_output=True, text=True, timeout=2, check=False)
    except (OSError, subprocess.SubprocessError):
        return {"branch": None, "changed": 0}
    if result.returncode != 0:
        return {"branch": None, "changed": 0}
    lines = result.stdout.splitlines()
    head = lines[0][3:] if lines and lines[0].startswith("## ") else ""
    name = head.split("...")[0].split(" ")[0] if head else None
    return {"branch": name or None, "changed": max(0, len(lines) - 1)}


def _recent_row(item: dict) -> dict:
    path = item["path"]
    if not os.path.isdir(path):
        return {**item, "missing": True, "formRepo": False, "branch": None, "changed": 0}
    return {**item, "missing": False, "formRepo": _is_form_repo(path), **_git_summary(path)}


@router.get("/workspace/recent")
def get_recent() -> dict:
    items = ws.recent_list()
    if not items:
        return {"recent": []}
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(_recent_row, items))
    return {"recent": rows}


BROWSE_MAX = 5000


def _browse_roots() -> list[str]:
    if os.name != "nt":
        return ["/"]
    return [f"{letter}:\\" for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if os.path.isdir(f"{letter}:\\")]


@router.get("/workspace/browse")
def browse(path: str = "", files: bool = False, hidden: bool = False) -> dict:
    home = os.path.expanduser("~")
    target = path or home
    if "\0" in target or not os.path.isabs(target):
        raise HTTPException(status_code=400, detail="path must be absolute")
    real = os.path.normpath(target)
    if not os.path.isdir(real):
        raise HTTPException(status_code=404, detail="not a directory")
    entries: list[dict] = []
    truncated = False
    try:
        with os.scandir(real) as scan:
            for item in scan:
                if not hidden and item.name.startswith("."):
                    continue
                try:
                    is_dir = item.is_dir()
                    if not is_dir and not files:
                        continue
                except OSError:
                    continue
                if len(entries) >= BROWSE_MAX:
                    truncated = True
                    break
                entries.append({"name": item.name, "path": os.path.join(real, item.name), "kind": "dir" if is_dir else "file"})
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    entries.sort(key=lambda e: (e["kind"] != "dir", e["name"].lower(), e["name"]))
    parent = os.path.dirname(real)
    return {"path": real, "parent": parent if parent != real else None, "home": home, "roots": _browse_roots(), "entries": entries, "truncated": truncated}


@router.delete("/workspace/recent", dependencies=OWNER)
async def delete_recent(request: Request) -> dict:
    body = await _json(request)
    path = body.get("path")
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


FILES_MAX = 20000
HIDE_MAX = 200


def _list_files(base: str, hide: frozenset[str]) -> tuple[list[str], bool]:
    files: list[str] = []
    queue = [("", base)]
    at = 0
    while at < len(queue):
        rel, real = queue[at]
        at += 1
        try:
            with os.scandir(real) as scan:
                items = sorted(scan, key=lambda item: item.name)
        except OSError:
            continue
        for item in items:
            if item.name in ws.HIDDEN_NAMES:
                continue
            path = f"{rel}/{item.name}" if rel else item.name
            try:
                if item.is_symlink():
                    continue
                if item.is_dir(follow_symlinks=False):
                    if item.name not in hide:
                        queue.append((path, item.path))
                    continue
                if not item.is_file(follow_symlinks=False):
                    continue
            except OSError:
                continue
            if len(files) >= FILES_MAX:
                return files, True
            files.append(path)
    return files, False


@router.get("/workspace/files")
def list_files(hide: list[str] = Query(default=[])) -> dict:
    base = _base()
    names = frozenset(name for name in hide[:HIDE_MAX] if name and "\0" not in name and "/" not in name)
    files, truncated = _list_files(base, names)
    return {"files": files, "truncated": truncated}


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


@router.put("/workspace/file", dependencies=OWNER)
async def write_file(request: Request) -> dict:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > WRITE_MAX:
        raise HTTPException(status_code=413, detail="file is larger than 8 MiB")
    body = await _json(request)
    if not isinstance(body.get("path"), str) or not isinstance(body.get("text"), str):
        raise HTTPException(status_code=400, detail="path and text required")
    if len(body["text"]) > WRITE_MAX:
        raise HTTPException(status_code=413, detail="file is larger than 8 MiB")
    create = body.get("create") is True
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
    if create and os.path.lexists(real):
        raise HTTPException(status_code=409, detail="already exists")
    if os.path.exists(real) and not os.access(real, os.W_OK):
        raise HTTPException(status_code=403, detail="file is read only")
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


@router.post("/workspace/mkdir", dependencies=OWNER)
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


@router.post("/workspace/rename", dependencies=OWNER)
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
    if dst_rel == src_rel or dst_rel.startswith(src_rel + "/"):
        raise HTTPException(status_code=409, detail="cannot move a folder into itself")
    try:
        os.rename(src, dst)
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    except OSError as err:
        raise HTTPException(status_code=409, detail=err.strerror or "rename failed")
    return {"from": src_rel, "to": dst_rel}


@router.post("/workspace/delete", dependencies=OWNER)
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


def _rg_search(rg: str, base: str, q: str, regex: bool, case: bool, glob: str, cap: int, excludes: tuple[str, ...] = ()) -> list[dict]:
    args = [rg, "--json", "--hidden", "--no-ignore", "--no-messages", "--max-columns", "2000", "--max-filesize", "4M", "--case-sensitive" if case else "--ignore-case"]
    for name in ws.HIDDEN_NAMES + excludes:
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


REPLACE_FILES_MAX = 1000
PREVIEW_PATHS_MAX = 20


def _budget_detail(regex: bool) -> str:
    if regex:
        return f"the regular expression ran past its {ts.REGEX_BUDGET:g} s budget without a result; it may backtrack heavily, or the workspace is large. Make the pattern more specific or narrow the files"
    return f"the search ran past its {ts.LITERAL_BUDGET:g} s budget without a result; narrow the files"


def _py_run(job: str, args: tuple, kwargs: dict, regex: bool) -> tuple[list, bool]:
    try:
        return ts.run(job, args, kwargs, guarded=regex)
    except ts.BadPattern as err:
        raise HTTPException(status_code=400, detail=str(err))
    except ts.Stopped as err:
        raise HTTPException(status_code=503, detail=str(err))


def _py_found(base: str, q: str, regex: bool, case: bool, glob: str, cap: int, excludes: tuple[str, ...] = ()) -> tuple[list[dict], bool]:
    parts, stopped = _py_run("search", (base, q, regex, case, glob, ws.HIDDEN_NAMES, tuple(excludes), cap, READ_MAX), {}, regex)
    hits = [hit for part in parts for hit in part]
    if stopped and not hits:
        raise HTTPException(status_code=400, detail=_budget_detail(regex))
    return hits, stopped


def _py_search(base: str, q: str, regex: bool, case: bool, glob: str, cap: int, excludes: tuple[str, ...] = ()) -> list[dict]:
    return _py_found(base, q, regex, case, glob, cap, excludes)[0]


@router.get("/workspace/search")
def search(q: str = "", regex: bool = False, case: bool = False, glob: str = "", limit: int = 200) -> dict:
    if not q:
        raise HTTPException(status_code=400, detail="q required")
    if "\0" in q or "\0" in glob:
        raise HTTPException(status_code=400, detail="bad query")
    base = _base()
    cap = min(SEARCH_LIMIT_MAX, max(1, limit))
    rg = find_bin("rg")
    stopped = False
    if rg:
        engine = "rg"
        hits = _rg_search(rg, base, q, bool(regex), bool(case), glob.strip(), cap)
    else:
        engine = "python"
        hits, stopped = _py_found(base, q, bool(regex), bool(case), glob.strip(), cap)
    return {"hits": hits[:cap], "truncated": len(hits) > cap or stopped, "engine": engine, "stopped": stopped}


def _replace_query(body: dict) -> tuple[str, bool, bool, str, str]:
    q = body.get("q")
    template = body.get("replace")
    glob = body.get("glob") or ""
    if not isinstance(q, str) or not q:
        raise HTTPException(status_code=400, detail="q required")
    if not isinstance(template, str):
        raise HTTPException(status_code=400, detail="replace required")
    if not isinstance(glob, str) or "\0" in q or "\0" in glob or "\0" in template:
        raise HTTPException(status_code=400, detail="bad query")
    return q, body.get("regex") is True, body.get("case") is True, glob.strip(), template


@router.post("/workspace/replace/preview", dependencies=OWNER)
async def replace_preview(request: Request) -> dict:
    body = await _json(request)
    q, regex, case, glob, template = _replace_query(body)
    limit = body.get("limit", 500)
    if isinstance(limit, bool) or not isinstance(limit, int):
        raise HTTPException(status_code=400, detail="limit must be a number")
    full = body.get("full") is True
    paths = body.get("paths")
    base = _base()
    picked = None
    if paths is not None:
        if not isinstance(paths, list) or not 1 <= len(paths) <= PREVIEW_PATHS_MAX or not all(isinstance(p, str) for p in paths):
            raise HTTPException(status_code=400, detail=f"paths must be a list of 1 to {PREVIEW_PATHS_MAX} paths")
        picked = []
        for path in paths:
            real, rel = _guard(path)
            if rel and os.path.isfile(real):
                picked.append((rel, real))
    elif full:
        raise HTTPException(status_code=400, detail="full needs paths")
    cap = min(SEARCH_LIMIT_MAX, max(1, limit))
    return await run_in_threadpool(_preview, base, q, regex, case, glob, template, cap, picked, full)


def _preview(base: str, q: str, regex: bool, case: bool, glob: str, template: str, cap: int, picked: list | None, full: bool) -> dict:
    files, stopped = _py_run("plan", (base, q, regex, case, glob, ws.HIDDEN_NAMES, (), template, cap, READ_MAX), {"paths": picked, "full": full}, regex)
    if stopped and not files:
        raise HTTPException(status_code=400, detail=_budget_detail(regex))
    total = sum(len(item["hits"]) for item in files)
    return {"files": files, "hits": total, "truncated": total >= cap or stopped, "stopped": stopped, "engine": "python"}


def _refused(path: str, reason: str) -> dict:
    return {"path": path, "status": "refused", "reason": reason}


@router.post("/workspace/replace", dependencies=OWNER)
async def replace_files(request: Request) -> dict:
    body = await _json(request)
    q, regex, case, glob, template = _replace_query(body)
    files = body.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= REPLACE_FILES_MAX:
        raise HTTPException(status_code=400, detail=f"files must be a list of 1 to {REPLACE_FILES_MAX} entries")
    _base()
    try:
        ts.compile_template(template, regex, ts.compile_pattern(q, regex, case))
    except ts.BadPattern as err:
        raise HTTPException(status_code=400, detail=str(err))
    return await run_in_threadpool(_replace, q, regex, case, glob, template, files)


def _held(item: object, filt: ts.Filter, seen: set[str]) -> tuple[dict | None, tuple | None]:
    path = item.get("path") if isinstance(item, dict) else None
    if not isinstance(path, str) or not path:
        return _refused(str(path), "path required"), None
    want = item.get("hash")
    lines = item.get("lines")
    if not isinstance(want, str) or not want:
        return _refused(path, "the hash from the preview is required"), None
    if lines is not None and (not isinstance(lines, list) or not all(isinstance(n, int) and not isinstance(n, bool) and n > 0 for n in lines)):
        return _refused(path, "lines must be line numbers"), None
    try:
        real, rel = ws.resolve(path, write=True)
    except ws.Refused as err:
        return _refused(path, err.detail), None
    if not rel or rel in seen:
        return _refused(path, "listed twice" if rel else "path required"), None
    seen.add(rel)
    if not filt.wanted(rel, ancestors=True):
        return _refused(rel, "outside the files this search covers"), None
    try:
        info = os.stat(real)
    except OSError:
        return _refused(rel, "not found"), None
    if not stat.S_ISREG(info.st_mode):
        return _refused(rel, "not a file"), None
    if info.st_size > READ_MAX:
        return _refused(rel, "file is larger than 4 MiB"), None
    try:
        with open(real, "rb") as handle:
            data = handle.read(READ_MAX + 1)
    except OSError:
        return _refused(rel, "not readable"), None
    if len(data) > READ_MAX:
        return _refused(rel, "file is larger than 4 MiB"), None
    if _is_binary(data[:SNIFF_BYTES]):
        return _refused(rel, "binary file"), None
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return _refused(rel, "not UTF-8 text"), None
    if ts.digest(data) != want:
        return _refused(rel, "changed since the preview"), None
    if not os.access(real, os.W_OK):
        return _refused(rel, "file is read only"), None
    return None, (rel, real, want, text, lines)


def _replace(q: str, regex: bool, case: bool, glob: str, template: str, files: list) -> dict:
    filt = ts.Filter(glob, ws.HIDDEN_NAMES)
    results: list[dict | None] = [None] * len(files)
    held: dict[int, tuple] = {}
    seen: set[str] = set()
    total = 0
    for index, item in enumerate(files):
        refusal, keep = _held(item, filt, seen)
        if refusal is not None or keep is None:
            results[index] = refusal
            continue
        size = len(keep[3].encode("utf-8"))
        if total + size > ts.APPLY_TEXT_MAX:
            results[index] = _refused(keep[0], "too much text in one replace; run it again for the rest")
            continue
        total += size
        held[index] = keep
    done: dict[int, tuple[str, int]] = {}
    failed = ""
    if held:
        jobs = [(index, keep[3], keep[4]) for index, keep in held.items()]
        try:
            parts, _ = ts.run("apply", (q, regex, case, template, jobs), {}, guarded=regex)
        except ts.BadPattern as err:
            raise HTTPException(status_code=400, detail=str(err))
        except ts.Stopped as err:
            parts, failed = [], str(err)
        done = {key: (after, made) for key, after, made in parts}
    for index in sorted(held):
        rel, real, want = held[index][:3]
        if index not in done:
            results[index] = _refused(rel, failed or f"stopped: the regular expression ran past its {ts.REGEX_BUDGET:g} s budget")
            continue
        after, made = done[index]
        if not made:
            results[index] = {"path": rel, "status": "skipped", "reason": "no match left on the confirmed lines"}
            continue
        try:
            data = after.encode("utf-8")
        except UnicodeEncodeError:
            results[index] = _refused(rel, "the replacement is not valid unicode")
            continue
        if len(data) > WRITE_MAX:
            results[index] = _refused(rel, "the result is larger than 8 MiB")
            continue
        try:
            with open(real, "rb") as handle:
                current = handle.read(READ_MAX + 1)
        except OSError:
            results[index] = _refused(rel, "no longer readable")
            continue
        if ts.digest(current) != want:
            results[index] = _refused(rel, "changed since the preview")
            continue
        try:
            _atomic_write(real, data)
            info = os.stat(real)
        except PermissionError:
            results[index] = _refused(rel, "permission denied")
            continue
        except OSError as err:
            results[index] = _refused(rel, err.strerror or "write failed")
            continue
        results[index] = {"path": rel, "status": "written", "count": made, "size": info.st_size, "mtime": info.st_mtime, "hash": ts.digest(data)}
    return {"results": results, "written": sum(1 for r in results if r and r["status"] == "written"), "engine": "python"}
