import asyncio
import os
import re
import secrets
import shutil
import socket
import time
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from fastapi.concurrency import run_in_threadpool

from app.services import formslot as formslot_svc
from app.services import gitops

TEMPLATES = Path(__file__).resolve().parents[1] / "templates"
CLONE_TIMEOUT = 900
CLONE_MAX_RUNNING = 3
JOBS_KEEP = 20
JOB_LINGER = 600
URL_MAX = 2048
NAME_RE = re.compile(r"^form[a-z0-9]{1,28}$")
FOLDER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
HOST_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")
USER_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
URL_CHARS_RE = re.compile(r"^[A-Za-z0-9._~%+@:/-]+$")
SCP_RE = re.compile(r"^([A-Za-z0-9._-]{1,64})@([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?):([A-Za-z0-9._~/-]{1,1000})$")
PROGRESS_RE = re.compile(r"(Receiving objects|Resolving deltas):\s+(\d+)%")
PORT_LOW = 5600
PORT_HIGH = 5999
KNOWN_BLOCKS = {
    5620: "formMCP",
    5630: "formskills",
    5640: "formslot",
    5650: "subform",
}
PORT_SCAN_RE = re.compile(r"\b(5[6-9]\d\d)\b")
SCAN_FILES = ("CLAUDE.md", "README.md", "AGENTS.md")
SCAN_SIBLINGS = 60
SCAN_BYTES = 65536
GIT_STEP_TIMEOUT = 60
INSTALL_TIMEOUT = 60
FALLBACK_IDENTITY = {"name": "nodemode-ai", "email": "mackin@nodemode.ai"}
RAW_FILES = ("LICENSE",)
EXEC_NAME = "__name__"
KINDS = {
    "rust": {
        "label": "Rust core, cli and Tauri shell (like formMCP)",
        "short": "Rust core, cli and Tauri shell",
        "stack": "a Rust 2024 workspace with a `core` crate for the logic, a thin `cli` crate and a Tauri 2 shell",
        "quickstart": "```bash\n./{name} version        # builds the cli on first use and prints the version\n./{name} ports\ncargo build --release   # core and cli\n```",
        "notice": "| Rust crates | none beyond the standard library |\n| --- | --- |",
        "shell": "src-tauri` is excluded from the Cargo workspace, so `cargo build` at the root never fetches Tauri.",
    },
    "python": {
        "label": "Python engine and Tauri shell (like formvis)",
        "short": "Python engine and Tauri shell",
        "stack": "a Python 3.13 and FastAPI engine on 127.0.0.1 with a Tauri 2 shell over a window in `frontend`",
        "quickstart": "```bash\n./{name}               # creates backend/venv and serves the engine\ncurl http://127.0.0.1:{engine}/api/health\n```",
        "notice": "| Package | Version | Licence |\n| --- | --- | --- |\n| fastapi | 0.141.1 | MIT |\n| uvicorn | 0.53.0 | BSD-3-Clause |\n\nTransitive packages (starlette, pydantic, click, h11 and others) get rows when the engine is first frozen.",
        "shell": "src-tauri` has its own Cargo workspace and is built only by `cargo tauri build`.",
    },
}


class Refused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _clean_dest(dest: object) -> str:
    if not isinstance(dest, str) or not dest or "\0" in dest or not os.path.isabs(dest):
        raise Refused(400, "the destination must be an absolute folder")
    real = os.path.realpath(dest)
    if not os.path.isdir(real):
        raise Refused(404, "the destination folder does not exist")
    if not os.access(real, os.W_OK | os.X_OK):
        raise Refused(403, "the destination folder is not writable")
    return real


def _host_ok(host: str | None) -> bool:
    return bool(host) and HOST_RE.match(host or "") is not None and ".." not in (host or "")


def _path_ok(path: str) -> bool:
    parts = [p for p in path.split("/") if p]
    return bool(parts) and all(p not in (".", "..") for p in parts) and "//" not in path


def clean_url(raw: object) -> tuple[str, str]:
    if not isinstance(raw, str):
        raise Refused(400, "give the address of a repository")
    url = raw.strip()
    if not url or len(url) > URL_MAX:
        raise Refused(400, "give the address of a repository")
    if url.startswith("-") or not URL_CHARS_RE.match(url):
        raise Refused(400, "the address has characters a repository address cannot have")
    scp = SCP_RE.match(url)
    if scp:
        if not _path_ok(scp.group(3).lstrip("/")):
            raise Refused(400, "the repository path is not valid")
        return url, scp.group(3)
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise Refused(400, "the address is not valid")
    if parts.scheme not in ("https", "ssh"):
        raise Refused(400, "only https and ssh addresses can be cloned")
    if parts.password is not None or (parts.username is not None and not USER_RE.match(parts.username)):
        raise Refused(400, "leave passwords out of the address; git's own credential helper signs you in")
    if parts.query or parts.fragment or not _host_ok(parts.hostname):
        raise Refused(400, "the address is not valid")
    if port is not None and not 1 <= port <= 65535:
        raise Refused(400, "the port is not valid")
    if not _path_ok(parts.path):
        raise Refused(400, "the repository path is not valid")
    return url, parts.path


def folder_for(path: str) -> str:
    last = [p for p in path.replace(":", "/").split("/") if p][-1]
    if last.endswith(".git"):
        last = last[:-4]
    return last


def clean_folder(raw: object, fallback: str) -> str:
    name = raw.strip() if isinstance(raw, str) and raw.strip() else fallback
    if not FOLDER_RE.match(name) or name.endswith("."):
        raise Refused(400, "the folder name may use letters, digits, dot, dash and underscore, and must start with a letter or digit")
    return name


_jobs: dict[str, dict] = {}


def _purge() -> None:
    now = time.time()
    for key in [k for k, j in _jobs.items() if j["state"] != "running" and now - j["finished"] > JOB_LINGER]:
        _jobs.pop(key, None)
    extra = len(_jobs) - JOBS_KEEP
    if extra > 0:
        for key in [k for k, j in _jobs.items() if j["state"] != "running"][:extra]:
            _jobs.pop(key, None)


def _view(job: dict) -> dict:
    return {"id": job["id"], "kind": job["kind"], "state": job["state"], "progress": job["progress"], "message": job["message"], "path": job["path"], "name": job["name"], "error": job["error"]}


def get_job(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if job is None:
        raise Refused(404, "no such job")
    return _view(job)


async def start_clone(url_raw: object, dest_raw: object, folder_raw: object) -> dict:
    url, path = clean_url(url_raw)
    dest = _clean_dest(dest_raw)
    name = clean_folder(folder_raw, folder_for(path))
    target = os.path.join(dest, name)
    if os.path.lexists(target):
        raise Refused(409, f"{name} already exists in the destination folder")
    _purge()
    if sum(1 for j in _jobs.values() if j["state"] == "running") >= CLONE_MAX_RUNNING:
        raise Refused(429, "too many clones are running; wait for one to finish")
    git = gitops._git_bin()
    job = {"id": secrets.token_hex(8), "kind": "clone", "state": "running", "progress": 0.0, "message": "Starting", "path": target, "name": name, "error": "", "finished": 0.0, "cancel": False, "proc": None, "task": None}
    _jobs[job["id"]] = job
    job["task"] = asyncio.create_task(_run_clone(job, git, url, dest, target))
    return _view(job)


def _git_env() -> dict:
    env = {}
    if not os.environ.get("GIT_SSH_COMMAND") and not os.environ.get("GIT_SSH"):
        env["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes"
    return env


async def _read_progress(job: dict, stream: asyncio.StreamReader, tail: list[str]) -> None:
    buffer = b""
    while True:
        chunk = await stream.read(2048)
        if not chunk:
            break
        buffer += chunk
        pieces = re.split(rb"[\r\n]", buffer)
        buffer = pieces.pop()
        for piece in pieces:
            line = gitops._clip(piece.decode("utf-8", "replace"), 300)
            if not line:
                continue
            tail.append(line)
            del tail[:-8]
            found = PROGRESS_RE.search(line)
            if found:
                share = int(found.group(2)) / 100
                job["progress"] = round(share * 0.8 if found.group(1).startswith("Receiving") else 0.8 + share * 0.2, 3)
                job["message"] = found.group(1)
            elif not line.startswith(("fatal", "error")):
                job["message"] = line[:120]


def _finish(job: dict, state: str, error: str = "") -> None:
    job["state"] = state
    job["error"] = error
    job["finished"] = time.time()
    job["proc"] = None
    if state == "done":
        job["progress"] = 1.0


async def _run_clone(job: dict, git: str, url: str, dest: str, target: str) -> None:
    argv = [git, "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always", "-c", "core.askPass=", "clone", "--progress", "--", url, target]
    tail: list[str] = []
    try:
        proc = await asyncio.create_subprocess_exec(*argv, cwd=dest, env=gitops._env(_git_env()), stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE, start_new_session=os.name == "posix")
        job["proc"] = proc
        if job["cancel"]:
            await gitops._reap(proc)
        reader = asyncio.create_task(_read_progress(job, proc.stderr, tail))
        try:
            await asyncio.wait_for(proc.wait(), CLONE_TIMEOUT)
            timed_out = False
        except asyncio.TimeoutError:
            timed_out = True
            await gitops._reap(proc)
        await reader
        code = proc.returncode or 0
    except asyncio.CancelledError:
        _drop_partial(target)
        _finish(job, "cancelled", "cancelled")
        raise
    except OSError as err:
        _drop_partial(target)
        _finish(job, "failed", f"git could not be started: {err}")
        return
    if job["cancel"]:
        _drop_partial(target)
        _finish(job, "cancelled", "cancelled")
    elif timed_out:
        _drop_partial(target)
        _finish(job, "failed", "the clone took longer than 15 minutes and was stopped")
    elif code != 0:
        _drop_partial(target)
        message = next((line for line in reversed(tail) if line.startswith(("fatal", "error", "remote"))), tail[-1] if tail else "git clone failed")
        _finish(job, "failed", message)
    else:
        _finish(job, "done")


def _drop_partial(target: str) -> None:
    if os.path.isdir(target) and not os.path.islink(target):
        shutil.rmtree(target, ignore_errors=True)


async def cancel_job(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if job is None:
        raise Refused(404, "no such job")
    if job["state"] == "running":
        job["cancel"] = True
        proc = job["proc"]
        if proc is not None and proc.returncode is None:
            await gitops._reap(proc)
    return _view(job)


def _bindable(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def _scan_sibling_blocks(dest: str) -> dict[int, str]:
    found: dict[int, str] = {}
    try:
        entries = sorted(os.scandir(dest), key=lambda e: e.name)
    except OSError:
        return found
    for entry in entries[:SCAN_SIBLINGS]:
        if not entry.is_dir(follow_symlinks=False) or entry.name.startswith("."):
            continue
        for name in SCAN_FILES:
            try:
                with open(os.path.join(entry.path, name), "r", encoding="utf-8", errors="replace") as handle:
                    text = handle.read(SCAN_BYTES)
            except OSError:
                continue
            for match in PORT_SCAN_RE.finditer(text):
                found.setdefault(int(match.group(1)) // 10 * 10, entry.name)
    return found


def used_blocks(dest: str | None) -> dict[int, str]:
    blocks = dict(KNOWN_BLOCKS)
    for base in range(PORT_LOW, 5620, 10):
        blocks.setdefault(base, "the family's reserved ports")
    if dest:
        for base, owner in _scan_sibling_blocks(dest).items():
            blocks.setdefault(base, owner)
    return blocks


def check_block(base: int, dest: str | None) -> str:
    if not PORT_LOW <= base <= PORT_HIGH - 9 or base % 10:
        return f"the port block must start at a multiple of 10 from {PORT_LOW} to {PORT_HIGH - 9}"
    owner = used_blocks(dest).get(base)
    if owner:
        return f"{base} to {base + 9} belongs to {owner}"
    busy = [p for p in range(base, base + 10) if not _bindable(p)]
    if busy:
        return f"port {busy[0]} is in use on this computer"
    return ""


def suggest_block(dest: str | None) -> int | None:
    for base in range(PORT_LOW, PORT_HIGH - 8, 10):
        if not check_block(base, dest):
            return base
    return None


def _who() -> tuple[dict, bool]:
    ident = gitops._stored_identity()
    if ident and ident["name"].strip() and ident["email"].strip():
        return ident, True
    return {**FALLBACK_IDENTITY, "sign": False, "signingKey": ""}, False


async def options(dest_raw: str | None) -> dict:
    dest = _clean_dest(dest_raw) if dest_raw else None
    who, named = _who()
    block = await run_in_threadpool(suggest_block, dest)
    return {
        "kinds": [{"id": key, "label": value["label"]} for key, value in KINDS.items()],
        "block": block,
        "formslot": formslot_svc.binary() is not None,
        "identity": {"name": who["name"], "email": who["email"], "stored": named},
    }


def _tokens(name: str, kind: str, base: int) -> dict[str, str]:
    spec = KINDS[kind]
    engine = base + 5
    return {
        "name": name,
        "date": date.today().isoformat(),
        "kind_label": spec["short"],
        "purpose": f"A Form family app ({spec['short']}).",
        "stack": spec["stack"],
        "quickstart": spec["quickstart"].replace("{name}", name).replace("{engine}", str(engine)),
        "notice_rows": spec["notice"],
        "shell_note": spec["shell"],
        "port_base": str(base),
        "port_frontend": str(base),
        "port_preview": str(base + 1),
        "port_engine": str(engine),
        "port_end": str(base + 9),
    }


TOKEN_RE = re.compile(r"\{\{(\w+)\}\}")


def _render(text: str, tokens: dict[str, str]) -> str:
    return TOKEN_RE.sub(lambda m: tokens.get(m.group(1), m.group(0)), text)


def _target_rel(rel: Path, tokens: dict[str, str]) -> Path:
    parts = []
    for part in rel.parts:
        if part == EXEC_NAME:
            part = tokens["name"]
        elif part.startswith("dot_"):
            part = "." + part[4:]
        parts.append(part)
    return Path(*parts)


def _write_tree(target: Path, kind: str, tokens: dict[str, str]) -> list[str]:
    written = []
    for source_root in (TEMPLATES / "common", TEMPLATES / kind):
        for source in sorted(source_root.rglob("*")):
            if not source.is_file() or source.name == "__pycache__":
                continue
            rel = source.relative_to(source_root)
            out = target / _target_rel(rel, tokens)
            out.parent.mkdir(parents=True, exist_ok=True)
            if source.name in RAW_FILES:
                shutil.copyfile(source, out)
            else:
                out.write_text(_render(source.read_text(encoding="utf-8"), tokens), encoding="utf-8", newline="\n")
            if rel.name == EXEC_NAME:
                out.chmod(0o755)
            written.append(str(out.relative_to(target)).replace(os.sep, "/"))
    return written


async def _run_formslot(found: str, root: str) -> tuple[bool, str]:
    try:
        proc = await asyncio.create_subprocess_exec(found, "install", root, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=dict(os.environ))
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), INSTALL_TIMEOUT)
        except asyncio.TimeoutError:
            await gitops._reap(proc)
            return False, "formslot install timed out"
    except OSError as err:
        return False, f"formslot could not be run: {err}"
    text = gitops._clip(out.decode("utf-8", "replace"), 600)
    return (proc.returncode == 0), text


async def create_app(name_raw: object, kind_raw: object, dest_raw: object, port_raw: object) -> dict:
    name = name_raw.strip() if isinstance(name_raw, str) else ""
    if not NAME_RE.match(name):
        raise Refused(400, "the name is lowercase letters and digits, starts with form, and has at least one more character")
    kind = kind_raw if isinstance(kind_raw, str) else ""
    if kind not in KINDS:
        raise Refused(400, "choose a kind of app")
    dest = _clean_dest(dest_raw)
    if isinstance(port_raw, bool) or not isinstance(port_raw, int):
        raise Refused(400, "give the first port of the block")
    problem = await run_in_threadpool(check_block, port_raw, dest)
    if problem:
        raise Refused(409, problem)
    target = Path(dest) / name
    if os.path.lexists(target):
        raise Refused(409, f"{name} already exists in the destination folder")
    who, named = _who()
    sign = bool(named and who["sign"] and who["signingKey"])
    root = str(target)
    try:
        target.mkdir()
        tokens = _tokens(name, kind, port_raw)
        files = await run_in_threadpool(_write_tree, target, kind, tokens)
        await gitops.must(root, ["init", "-q", "-b", "main"], timeout=GIT_STEP_TIMEOUT)
        slot_ok, slot_note = False, "formslot was not found on this computer"
        found = formslot_svc.binary()
        if found:
            slot_ok, slot_note = await _run_formslot(found, root)
        await gitops.must(root, ["add", "-A"], timeout=GIT_STEP_TIMEOUT)
        args = ["commit", "-q", "--no-verify", "--no-gpg-sign" if not sign else "-S", "-F", "-"]
        configs = gitops._ident_configs(who, sign) + ["core.hooksPath=/dev/null" if os.name == "posix" else "core.hooksPath=NUL", "commit.gpgsign=" + ("true" if sign else "false")]
        message = f"Initial commit of {name}\n\nScaffolded by subform from the {KINDS[kind]['short']} template.\n"
        await gitops.must(root, args, configs=configs, env=gitops._ident_env(who), stdin=message.encode("utf-8"), timeout=GIT_STEP_TIMEOUT)
        sha = (await gitops.must(root, ["rev-parse", "HEAD"])).strip()
    except gitops.Refused as err:
        shutil.rmtree(root, ignore_errors=True)
        raise Refused(500, err.detail)
    except BaseException:
        shutil.rmtree(root, ignore_errors=True)
        raise
    return {"path": os.path.realpath(root), "name": name, "kind": kind, "ports": {"base": port_raw, "end": port_raw + 9, "engine": port_raw + 5}, "commit": sha, "files": len(files), "identity": {"name": who["name"], "email": who["email"]}, "signed": sign, "formslot": {"installed": slot_ok, "note": slot_note}}
