import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import signal
import stat
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.core import config, workspace_root as ws
from app.core.binres import find_bin

IDENTITY_NAME = "identity.json"
HOOKS_NAME = "githooks"
SNAP_ROOT = "refs/formsubstrate/snapshots"
OLD_SNAP_ROOT = "refs/subform/snapshots"
SNAP_MAX = 50
GIT_TIMEOUT = 60
NET_TIMEOUT = 120
DIFF_MAX = 2 * 1024 * 1024
WRITE_MAX = 8 * 1024 * 1024
AUDIT_MAX = 50
ERR_MAX = 2000
OUT_MAX = 4000
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
SESSION_RE = re.compile(r"^[a-z0-9]{16}$")
REMOTE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
BRANCH_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._/-]*$")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")
LINE_TRAILER_RE = re.compile(r"^\s*(Co-Authored-By\s*:|Claude-Session\s*:|Signed-off-by:\s*Claude\b)", re.IGNORECASE)
HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$")
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
TRAILER_RE = re.compile(r"^(Co-Authored-By|Claude-Session|Generated with|Signed-off-by: Claude)\b", re.IGNORECASE)
GENERATED_MARK = "Generated with [Claude Code]"
STALE = "the file changed; reload the review"
LIVE_STATES = ("working", "needs-input")
DIFF_FLAGS = ["--diff-algorithm=histogram", "-U3", "--no-color", "--no-ext-diff"]
SNAP_IDENT = {"GIT_AUTHOR_NAME": "formsubstrate", "GIT_AUTHOR_EMAIL": "formsubstrate@localhost", "GIT_COMMITTER_NAME": "formsubstrate", "GIT_COMMITTER_EMAIL": "formsubstrate@localhost"}
HOOK_SCRIPT = """#!/bin/sh
f="$1"
[ -f "$f" ] || exit 0
tmp="$f.sfstrip"
grep -v -i -E '^[[:space:]]*(Co-Authored-By[[:space:]]*:|Claude-Session[[:space:]]*:|Signed-off-by:[[:space:]]*Claude([^A-Za-z0-9_]|$))' "$f" | grep -v -F 'Generated with [Claude Code]' > "$tmp"
cat "$tmp" > "$f"
rm -f "$tmp"
exit 0
"""


_locks: dict[str, asyncio.Lock] = {}


def lock_for(t: "Target") -> asyncio.Lock:
    lock = _locks.get(t.root)
    if lock is None:
        lock = _locks[t.root] = asyncio.Lock()
    return lock


class Refused(Exception):
    def __init__(self, status: int, detail: str, extra: dict | None = None) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.extra = extra or {}


@dataclass
class Target:
    root: str
    key: str
    session: str | None
    item: dict | None


def _git_bin() -> str:
    found = find_bin("git")
    if not found:
        raise Refused(404, "git was not found on this computer")
    return found


def _env(extra: dict | None = None) -> dict:
    env = dict(os.environ)
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"):
        env.pop(name, None)
    env["LC_ALL"] = "C"
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    if extra:
        env.update(extra)
    return env


async def _exec(argv: list[str], cwd: str | None, env: dict | None = None, stdin: bytes | None = None, timeout: int = GIT_TIMEOUT) -> tuple[int, bytes, bytes]:
    proc = await asyncio.create_subprocess_exec(*argv, cwd=cwd, env=_env(env), stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=os.name == "posix")
    try:
        out, err = await asyncio.wait_for(proc.communicate(stdin), timeout)
    except asyncio.TimeoutError:
        await _reap(proc)
        return 124, b"", b"git timed out"
    except BaseException:
        await asyncio.shield(_reap(proc))
        raise
    return proc.returncode or 0, out, err


async def _reap(proc: asyncio.subprocess.Process) -> None:
    try:
        if os.name == "posix":
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            proc.kill()
    except (ProcessLookupError, PermissionError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass
    await proc.wait()


def _text(raw: bytes) -> str:
    return raw.decode("utf-8", "surrogateescape")


def _pub(text: str) -> str:
    return text.encode("utf-8", "surrogateescape").decode("utf-8", "replace")


def _clip(text: str, size: int = ERR_MAX) -> str:
    text = ANSI_RE.sub("", text)
    lines = [line.rstrip("\r").split("\r")[-1] for line in text.split("\n")]
    return "\n".join(lines).strip()[:size]


async def run(root: str, args: list[str], configs: list[str] | None = None, env: dict | None = None, stdin: bytes | None = None, timeout: int = GIT_TIMEOUT) -> tuple[int, str, str]:
    argv = [_git_bin(), "-c", "core.quotepath=off"]
    for entry in configs or []:
        argv += ["-c", entry]
    argv += args
    code, out, err = await _exec(argv, root, env, stdin, timeout)
    return code, _text(out), _text(err)


async def must(root: str, args: list[str], **kwargs) -> str:
    code, out, err = await run(root, args, **kwargs)
    if code != 0:
        raise Refused(500, _clip(_pub(err) or _pub(out) or "git failed"))
    return out


async def resolve_target(session: str | None) -> Target:
    if session:
        from app.services import sessions as sv

        if not SESSION_RE.match(session):
            raise Refused(404, "no such session")
        try:
            item = sv._entry(session)
        except sv.Refused as err:
            raise Refused(err.status, err.detail)
        root = item.get("worktree") or ""
        if not root or not os.path.isdir(root):
            raise Refused(409, "the worktree of this session no longer exists")
        return Target(os.path.realpath(root), session, session, item)
    try:
        root = ws.real_root()
    except ws.Refused as err:
        raise Refused(err.status, err.detail)
    code, out, _ = await run(root, ["rev-parse", "--show-toplevel"])
    if code != 0:
        raise Refused(409, "the open workspace is not a git repository")
    if os.path.realpath(out.strip()) != root:
        raise Refused(409, "the open folder is not the top folder of its git repository")
    return Target(root, "workspace", None, None)


def clean_path(root: str, rel: object) -> str:
    if not isinstance(rel, str) or not rel or "\0" in rel:
        raise Refused(400, "bad path")
    if CONTROL_RE.search(rel):
        raise Refused(400, "bad path")
    flat = rel.replace("\\", "/") if os.sep == "\\" else rel
    if flat.startswith("/") or (len(flat) > 1 and flat[1] == ":"):
        raise Refused(400, "bad path")
    parts = [part for part in flat.split("/") if part not in ("", ".")]
    if not parts or ".." in parts or any(part.lower() == ".git" for part in parts):
        raise Refused(400, "bad path")
    base = os.path.realpath(root)
    parent = os.path.realpath(os.path.join(base, *parts[:-1]))
    if parent != base and not parent.startswith(base.rstrip(os.sep) + os.sep):
        raise Refused(400, "bad path")
    resolved = os.path.realpath(os.path.join(base, *parts))
    if resolved != base and resolved.startswith(base.rstrip(os.sep) + os.sep):
        if any(part.lower() == ".git" for part in os.path.relpath(resolved, base).split(os.sep)):
            raise Refused(400, "bad path")
    return "/".join(parts)


def _identity_file() -> Path:
    return config.data_dir() / IDENTITY_NAME


def _stored_identity() -> dict | None:
    try:
        data = json.loads(_identity_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("name"), str) or not isinstance(data.get("email"), str):
        return None
    return {"name": data["name"], "email": data["email"], "sign": bool(data.get("sign")), "signingKey": data.get("signingKey") if isinstance(data.get("signingKey"), str) else ""}


async def identity_get() -> dict:
    stored = _stored_identity()
    if stored and (stored["name"] or stored["email"]):
        return {**stored, "source": "formsubstrate"}
    name = email = ""
    if find_bin("git"):
        code, out, _ = await run(str(config.data_dir()), ["config", "--global", "user.name"])
        name = out.strip() if code == 0 else ""
        code, out, _ = await run(str(config.data_dir()), ["config", "--global", "user.email"])
        email = out.strip() if code == 0 else ""
    return {"name": name, "email": email, "sign": False, "signingKey": "", "source": "git" if name or email else "none"}


async def identity_put(name: object, email: object, sign: object, signing_key: object) -> dict:
    name = str(name or "").strip()
    email = str(email or "").strip()
    key = str(signing_key or "").strip()
    if not 1 <= len(name) <= 200 or any(c in name for c in "\r\n\0<>"):
        raise Refused(400, "the name must be 1 to 200 characters")
    if "@" not in email or len(email) > 320 or any(c in email for c in " \t\r\n\0<>"):
        raise Refused(400, "the email must contain @")
    if key:
        expanded = os.path.expanduser(key)
        if not expanded.endswith(".pub") or not os.path.isfile(expanded):
            raise Refused(400, "the signing key must be the path of an existing .pub file")
        key = expanded
    record = {"name": name, "email": email, "sign": bool(sign), "signingKey": key}
    target = _identity_file()
    temp = target.with_name(target.name + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(record, indent=2))
    os.replace(temp, target)
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass
    from app.services import sessions as sv
    for tree in sv.worktree_roots():
        if os.path.isdir(tree):
            await run(tree, ["config", "--worktree", "user.name", name])
            await run(tree, ["config", "--worktree", "user.email", email])
    return {**record, "source": "formsubstrate"}


async def _need_identity() -> dict:
    ident = await identity_get()
    if not ident["name"].strip() or not ident["email"].strip():
        raise Refused(409, "set your commit name and email in Preferences, Git and Identity")
    return ident


def _verify_configs() -> list[str]:
    ident = _stored_identity()
    if not ident or not ident["signingKey"] or not ident["email"]:
        return []
    try:
        key = Path(ident["signingKey"]).read_text(encoding="utf-8").strip()
        target = config.data_dir() / "allowed_signers"
        target.write_text(f'{ident["email"]} namespaces="git" {key}\n', encoding="utf-8")
    except OSError:
        return []
    return [f"gpg.ssh.allowedSignersFile={target}"]


def _ident_env(ident: dict) -> dict:
    return {"GIT_AUTHOR_NAME": ident["name"], "GIT_AUTHOR_EMAIL": ident["email"], "GIT_COMMITTER_NAME": ident["name"], "GIT_COMMITTER_EMAIL": ident["email"]}


def _ident_configs(ident: dict, sign: bool = False) -> list[str]:
    configs = [f"user.name={ident['name']}", f"user.email={ident['email']}"]
    if sign:
        configs += ["gpg.format=ssh", f"user.signingkey={ident['signingKey']}"]
    return configs


def ensure_hooks() -> Path:
    folder = config.data_dir() / HOOKS_NAME
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / "commit-msg"
    try:
        current = target.read_text(encoding="utf-8") if target.is_file() else ""
    except OSError:
        current = ""
    if current != HOOK_SCRIPT:
        temp = target.with_name("commit-msg.tmp")
        temp.write_text(HOOK_SCRIPT, encoding="utf-8", newline="\n")
        os.replace(temp, target)
    try:
        target.chmod(target.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    except OSError:
        logging.getLogger("formsubstrate").warning("the commit-msg hook %s could not be made executable", target, exc_info=True)
    return folder


async def configure_worktree(top: str, worktree: str) -> None:
    hooks = ensure_hooks()
    await must(top, ["config", "extensions.worktreeConfig", "true"])
    ident = _stored_identity()
    if ident and ident["name"].strip() and ident["email"].strip():
        await must(worktree, ["config", "--worktree", "user.name", ident["name"]])
        await must(worktree, ["config", "--worktree", "user.email", ident["email"]])
    await must(worktree, ["config", "--worktree", "core.hooksPath", str(hooks)])


def _map_kind(xy: str, unmerged: bool) -> str:
    if unmerged:
        return "conflicted"
    if "R" in xy or "C" in xy:
        return "renamed"
    if "D" in xy:
        return "deleted"
    if "A" in xy:
        return "added"
    return "modified"


def _letter(value: str) -> str:
    return "M" if value == "T" else value


async def status(t: Target) -> dict:
    out = await must(t.root, ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"])
    parts = out.split("\0")
    branch = head = upstream = None
    ahead = behind = 0
    files: list[dict] = []
    index = 0
    while index < len(parts):
        rec = parts[index]
        index += 1
        if not rec:
            continue
        if rec.startswith("# "):
            fields = rec[2:].split(" ", 1)
            name, value = fields[0], fields[1] if len(fields) > 1 else ""
            if name == "branch.oid":
                head = None if value == "(initial)" else value
            elif name == "branch.head":
                branch = None if value == "(detached)" else value
            elif name == "branch.upstream":
                upstream = value
            elif name == "branch.ab":
                match = re.match(r"^\+(\d+) -(\d+)$", value)
                if match:
                    ahead, behind = int(match.group(1)), int(match.group(2))
            continue
        kind = rec[0]
        old = None
        if kind == "?":
            files.append({"path": _pub(rec[2:]), "oldPath": None, "index": "?", "worktree": "?", "staged": False, "unstaged": True, "kind": "untracked"})
            continue
        if kind == "1":
            fields = rec.split(" ", 8)
            xy, path = fields[1], fields[8]
        elif kind == "2":
            fields = rec.split(" ", 9)
            xy, path = fields[1], fields[9]
            old = parts[index] if index < len(parts) else None
            index += 1
        elif kind == "u":
            fields = rec.split(" ", 10)
            xy, path = fields[1], fields[10]
        else:
            continue
        unmerged = kind == "u"
        x, y = ("U", "U") if unmerged else (_letter(xy[0]), _letter(xy[1]))
        files.append({"path": _pub(path), "oldPath": _pub(old) if old else None, "index": x, "worktree": y, "staged": x not in (".", "?") and not unmerged, "unstaged": y != "." or unmerged, "kind": _map_kind(xy, unmerged)})
    return {"root": t.root, "session": t.session, "branch": branch, "head": head, "upstream": upstream, "ahead": ahead, "behind": behind, "files": files, "conflicted": any(f["kind"] == "conflicted" for f in files)}


def _hunk_id(path: str, header: str, lines: list[tuple[str, str]]) -> str:
    digest = hashlib.sha1()
    digest.update(path.encode("utf-8", "surrogateescape"))
    digest.update(b"\n")
    digest.update(header.encode("utf-8", "surrogateescape"))
    for tag, text in lines:
        digest.update(b"\n")
        digest.update((tag + text).encode("utf-8", "surrogateescape"))
    return "h-" + digest.hexdigest()[:12]


def parse_diff(path: str, text: str) -> tuple[bool, list[dict]]:
    binary = False
    hunks: list[dict] = []
    current: dict | None = None
    for line in text.split("\n"):
        match = HUNK_RE.match(line)
        if match:
            current = {"header": line, "oldStart": int(match.group(1)), "oldLines": int(match.group(2)) if match.group(2) is not None else 1, "newStart": int(match.group(3)), "newLines": int(match.group(4)) if match.group(4) is not None else 1, "lines": [], "raw": [line]}
            hunks.append(current)
            continue
        if current is None:
            if line.startswith("Binary files ") or line.startswith("GIT binary patch"):
                binary = True
            continue
        if line[:1] in (" ", "+", "-"):
            current["lines"].append((line[0], line[1:]))
            current["raw"].append(line)
        elif line.startswith("\\"):
            current["raw"].append(line)
    for hunk in hunks:
        hunk["id"] = _hunk_id(path, hunk["header"], hunk["lines"])
    return binary, hunks


def _public_hunk(hunk: dict, staged: bool | None = None) -> dict:
    out = {"id": hunk["id"], "header": _pub(hunk["header"]), "oldStart": hunk["oldStart"], "oldLines": hunk["oldLines"], "newStart": hunk["newStart"], "newLines": hunk["newLines"], "lines": [{"t": tag, "text": _pub(text)} for tag, text in hunk["lines"]]}
    if staged is not None:
        out["staged"] = staged
    return out


async def _in_head(root: str, path: str) -> bool:
    code, _, _ = await run(root, ["cat-file", "-e", f"HEAD:{path}"])
    return code == 0


async def _has_head(root: str) -> bool:
    code, _, _ = await run(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
    return code == 0


async def _blob(root: str, spec: str) -> bytes:
    code, out, _ = await _exec([_git_bin(), "cat-file", "blob", spec], root)
    return out if code == 0 else b""


def _read_file(root: str, path: str) -> bytes | None:
    full = os.path.join(root, *path.split("/"))
    base = os.path.realpath(root)
    real = os.path.realpath(full)
    if not real.startswith(base.rstrip(os.sep) + os.sep) or ".git" in os.path.relpath(real, base).lower().split(os.sep):
        return None
    try:
        if os.path.islink(full) or not os.path.isfile(full):
            return None
        fd = os.open(full, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as handle:
            return handle.read(DIFF_MAX + 1)
    except OSError:
        return None


def _file_mtime(root: str, path: str) -> float | None:
    full = os.path.join(root, *path.split("/"))
    try:
        if os.path.islink(full) or not os.path.isfile(full):
            return None
        return os.stat(full).st_mtime
    except OSError:
        return None


def _write_atomic(target: str, data: bytes) -> None:
    folder = os.path.dirname(target)
    fd, temp = tempfile.mkstemp(prefix=".sf-", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, os.stat(target).st_mode & 0o7777)
        os.replace(temp, target)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


async def write_worktree_file(t: Target, path: object, text: object, expected: object) -> dict:
    if t.session is None:
        raise Refused(400, "this route writes into a session worktree; use the workspace file route for the workspace")
    if not isinstance(text, str):
        raise Refused(400, "text required")
    if len(text) > WRITE_MAX:
        raise Refused(413, "file is larger than 8 MiB")
    if expected is not None and (isinstance(expected, bool) or not isinstance(expected, (int, float))):
        raise Refused(400, "expectedMtime must be a number or null")
    rel = clean_path(t.root, path)
    full = os.path.join(t.root, *rel.split("/"))
    try:
        data = await asyncio.to_thread(text.encode, "utf-8")
    except UnicodeEncodeError:
        raise Refused(400, "text is not valid unicode")
    if len(data) > WRITE_MAX:
        raise Refused(413, "file is larger than 8 MiB")
    return await asyncio.to_thread(_write_checked, t.root, rel, full, data, expected)


def _write_checked(root: str, rel: str, full: str, data: bytes, expected: float | None) -> dict:
    base = os.path.realpath(root)
    real = os.path.realpath(full)
    if not real.startswith(base.rstrip(os.sep) + os.sep):
        raise Refused(400, "bad path")
    if os.path.islink(full):
        raise Refused(400, "the path is a symbolic link")
    if not os.path.isfile(full):
        raise Refused(404, "no such file in the worktree")
    if not os.access(full, os.W_OK):
        raise Refused(403, "file is read only")
    try:
        if expected is not None:
            if abs(os.stat(full).st_mtime - float(expected)) > 1e-6:
                raise Refused(409, "file changed on disk")
        _write_atomic(full, data)
        info = os.stat(full)
    except FileNotFoundError:
        raise Refused(404, "no such file in the worktree")
    except PermissionError:
        raise Refused(403, "permission denied")
    return {"path": rel, "size": info.st_size, "mtime": info.st_mtime}


async def _raw_diff(root: str, mode: str, paths: list[str]) -> str:
    base = ["diff"]
    if mode == "staged":
        base += ["--cached", "-M"]
    elif mode == "head":
        base += [("HEAD" if await _has_head(root) else EMPTY_TREE), "-M"]
    elif mode == "untracked":
        base += ["--no-index"]
    base += DIFF_FLAGS
    if mode == "untracked":
        paths = ["/dev/null", *paths]
    code, out, err = await run(root, [*base, "--", *paths])
    if code not in (0, 1):
        raise Refused(500, _clip(_pub(err) or "git diff failed"))
    return out


def _find(st: dict, path: str) -> dict | None:
    for entry in st["files"]:
        if entry["path"] == path:
            return entry
    return None


async def diff_file(t: Target, path: str, staged: bool) -> dict:
    path = clean_path(t.root, path)
    st = await status(t)
    entry = _find(st, path)
    old = entry["oldPath"] if entry else None
    untracked = entry is not None and entry["kind"] == "untracked" and not staged
    if untracked:
        raw = await _raw_diff(t.root, "untracked", [path])
    elif staged:
        raw = await _raw_diff(t.root, "staged", [p for p in (old, path) if p])
    else:
        raw = await _raw_diff(t.root, "worktree", [path])
    binary, hunks = parse_diff(path, raw)
    original = modified = ""
    too_large = False
    if not binary:
        if staged:
            before = await _blob(t.root, f"HEAD:{old or path}")
            after = await _blob(t.root, f":{path}")
        else:
            before = b"" if untracked else await _blob(t.root, f":{path}")
            after = _read_file(t.root, path) or b""
        if len(before) > DIFF_MAX or len(after) > DIFF_MAX:
            too_large = True
        else:
            original, modified = _pub(_text(before)), _pub(_text(after))
    return {"path": path, "oldPath": old, "binary": binary, "staged": staged, "original": original, "modified": modified, "hunks": [_public_hunk(h) for h in hunks], "tooLarge": too_large, "mtime": None if staged else _file_mtime(t.root, path)}


async def _review_entry(t: Target, entry: dict, keep_raw: bool = False) -> dict:
    path, old, kind = entry["path"], entry["oldPath"], entry["kind"]
    if kind == "untracked":
        raw = await _raw_diff(t.root, "untracked", [path])
    else:
        raw = await _raw_diff(t.root, "head", [p for p in (old, path) if p])
    binary, hunks = parse_diff(path, raw)
    staged_sets: set[tuple] = set()
    if kind != "untracked" and hunks:
        staged_raw = await _raw_diff(t.root, "staged", [p for p in (old, path) if p])
        _, staged_hunks = parse_diff(path, staged_raw)
        staged_sets = {tuple(h["lines"]) for h in staged_hunks}
    added = sum(1 for h in hunks for tag, _ in h["lines"] if tag == "+")
    removed = sum(1 for h in hunks for tag, _ in h["lines"] if tag == "-")
    return {"path": path, "oldPath": old, "kind": kind, "binary": binary, "hunks": hunks if keep_raw else [_public_hunk(h, tuple(h["lines"]) in staged_sets) for h in hunks], "added": added, "removed": removed, "empty": not hunks and not binary}


async def review(t: Target) -> dict:
    st = await status(t)
    gate = asyncio.Semaphore(8)

    async def one(entry: dict) -> dict | None:
        async with gate:
            data = await _review_entry(t, entry)
        if data["empty"] and entry["kind"] == "modified":
            return None
        data.pop("empty", None)
        return data

    results = await asyncio.gather(*(one(e) for e in st["files"]))
    files = [r for r in results if r is not None]
    files.sort(key=lambda f: f["path"])
    return {"root": t.root, "session": t.session, "files": files, "snapshots": len(await snapshot_list(t))}


def _patch_for(path: str, hunks: list[dict]) -> bytes:
    body = f"diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n"
    for hunk in hunks:
        body += "\n".join(hunk["raw"]) + "\n"
    return body.encode("utf-8", "surrogateescape")


async def _apply(t: Target, patch: bytes, flags: list[str], check: bool) -> tuple[int, str]:
    argv = ["apply", "--unidiff-zero", *flags]
    if check:
        argv.append("--check")
    code, _, err = await run(t.root, [*argv, "-"], stdin=patch)
    return code, _clip(_pub(err))


async def hunks_action(t: Target, path: str, ids: list, action: str) -> dict:
    if action not in ("accept", "reject"):
        raise Refused(400, "action must be accept or reject")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
        raise Refused(400, "hunks must be a list of hunk ids")
    path = clean_path(t.root, path)
    st = await status(t)
    entry = _find(st, path)
    if entry is None:
        raise Refused(409, STALE)
    if entry["kind"] == "conflicted":
        raise Refused(409, "resolve the conflict in this file first")
    data = await _review_entry(t, entry, keep_raw=True)
    hunks = data["hunks"]
    whole = "*" in ids
    if whole:
        chosen = hunks
    else:
        by_id = {h["id"]: h for h in hunks}
        if any(i not in by_id for i in ids):
            raise Refused(409, STALE)
        chosen = [by_id[i] for i in dict.fromkeys(ids)]
        whole = len(chosen) == len(hunks)
    kind = entry["kind"]
    in_head = await _in_head(t.root, entry["oldPath"] or path)
    whole_only = kind in ("untracked", "renamed", "deleted") or not in_head or data["binary"] or not hunks
    if whole_only and not whole:
        raise Refused(400, "this change can only be accepted or rejected as a whole file")
    paths = [p for p in (entry["oldPath"], path) if p]
    if action == "accept":
        if whole_only or whole:
            await must(t.root, ["add", "-A", "--", *paths])
            return await _after(t, path, len(chosen) or 1)
        patch = _patch_for(path, chosen)
        code, err = await _apply(t, patch, ["--cached"], True)
        if code != 0:
            back, _ = await _apply(t, patch, ["--cached", "-R"], True)
            if back == 0:
                return await _after(t, path, len(chosen))
            raise Refused(409, STALE)
        code, err = await _apply(t, patch, ["--cached"], False)
        if code != 0:
            raise Refused(409, STALE)
        return await _after(t, path, len(chosen))
    patch = _patch_for(path, chosen) if hunks and not whole_only else b""
    if patch and not whole:
        code, _ = await _apply(t, patch, ["-R"], True)
        if code != 0:
            raise Refused(409, STALE)
    await snapshot_create(t, f"before reject {path}")
    if whole_only or whole:
        if kind == "untracked":
            _remove_file(t.root, path)
        elif not in_head:
            await run(t.root, ["rm", "-f", "--cached", "--ignore-unmatch", "--", path])
            _remove_file(t.root, path)
        elif kind == "renamed":
            await run(t.root, ["rm", "-f", "--cached", "--ignore-unmatch", "--", path])
            _remove_file(t.root, path)
            await must(t.root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", entry["oldPath"] or path])
        else:
            await must(t.root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", path])
        return await _after(t, path, len(chosen) or 1)
    code, _ = await _apply(t, patch, ["-R"], False)
    if code != 0:
        raise Refused(409, STALE)
    back, _ = await _apply(t, patch, ["--cached", "-R"], True)
    if back == 0:
        await _apply(t, patch, ["--cached", "-R"], False)
    return await _after(t, path, len(chosen))


def _remove_file(root: str, path: str) -> None:
    full = os.path.join(root, *path.split("/"))
    try:
        if os.path.isdir(full) and not os.path.islink(full):
            shutil.rmtree(full)
        elif os.path.lexists(full):
            os.remove(full)
    except OSError:
        return
    _prune_dirs(root, os.path.dirname(full))


def _prune_dirs(root: str, folder: str) -> None:
    base = os.path.realpath(root)
    while folder and os.path.realpath(folder) != base and os.path.realpath(folder).startswith(base + os.sep):
        try:
            os.rmdir(folder)
        except OSError:
            return
        folder = os.path.dirname(folder)


async def _after(t: Target, path: str, applied: int) -> dict:
    st = await status(t)
    entry = _find(st, path)
    fresh = None
    if entry is not None:
        data = await _review_entry(t, entry)
        if not (data["empty"] and entry["kind"] == "modified"):
            data.pop("empty", None)
            fresh = data
    return {"ok": True, "applied": applied, "review": fresh}


def _under(files: list[dict], paths: list[str]) -> list[dict]:
    chosen = []
    for entry in files:
        for p in paths:
            if entry["path"] == p or entry["path"].startswith(p.rstrip("/") + "/") or entry["oldPath"] == p:
                chosen.append(entry)
                break
    return chosen


def _paths(t: Target, paths: object) -> list[str]:
    if not isinstance(paths, list) or not paths or not all(isinstance(p, str) for p in paths):
        raise Refused(400, "paths must be a list of paths")
    return [clean_path(t.root, p) for p in paths]


async def stage(t: Target, paths: object) -> dict:
    cleaned = _paths(t, paths)
    await must(t.root, ["add", "-A", "--", *cleaned])
    return await status(t)


async def unstage(t: Target, paths: object) -> dict:
    cleaned = _paths(t, paths)
    st = await status(t)
    extra = [e["oldPath"] for e in _under(st["files"], cleaned) if e["oldPath"]]
    await must(t.root, ["reset", "-q", "--", *cleaned, *extra])
    return await status(t)


async def discard(t: Target, paths: object, untracked: bool) -> dict:
    cleaned = _paths(t, paths)
    st = await status(t)
    chosen = _under(st["files"], cleaned)
    tracked = [e for e in chosen if e["kind"] not in ("untracked", "conflicted")]
    loose = [e for e in chosen if e["kind"] == "untracked"] if untracked else []
    if not tracked and not loose:
        return st
    for entry in loose:
        full = os.path.join(t.root, *entry["path"].rstrip("/").split("/"))
        if os.path.isdir(full) and not os.path.islink(full) and os.path.lexists(os.path.join(full, ".git")):
            raise Refused(409, f"{entry['path']} is a separate git repository; remove it yourself if you mean to")
    await snapshot_create(t, "before discard")
    if tracked:
        names = []
        for entry in tracked:
            names.append(entry["path"])
            if entry["oldPath"]:
                names.append(entry["oldPath"])
        await must(t.root, ["restore", "--worktree", "--", *names])
    for entry in loose:
        _remove_file(t.root, entry["path"])
    return await status(t)


def clean_message(message: object) -> str:
    if not isinstance(message, str):
        raise Refused(400, "the commit message is empty")
    lines = [line for line in message.replace("\r\n", "\n").split("\n") if GENERATED_MARK.lower() not in line.lower() and not LINE_TRAILER_RE.match(line)]
    while lines and (not lines[-1].strip() or TRAILER_RE.match(lines[-1].strip())):
        lines.pop()
    text = "\n".join(line.rstrip() for line in lines).strip("\n")
    if not text.strip():
        raise Refused(400, "the commit message is empty")
    return text + "\n"


def count_trailers(body: str) -> int:
    return sum(1 for line in body.split("\n") if LINE_TRAILER_RE.match(line) or GENERATED_MARK.lower() in line.lower())


async def _audit(t_root: str, ident: dict) -> dict:
    out = await must(t_root, ["log", "-1", "--format=%an <%ae>%x00%cn <%ce>%x00%G?%x00%B"], configs=_verify_configs())
    author, committer, sig, body = (out.split("\0", 3) + ["", "", "", ""])[:4]
    want = f"{ident['name']} <{ident['email']}>"
    return {"author": _pub(author), "committer": _pub(committer), "identityOk": author == want and committer == want, "trailers": count_trailers(body), "signature": sig.strip() or "N"}


async def commit(t: Target, message: object, amend: bool, all_: bool) -> dict:
    text = clean_message(message)
    ident = await _need_identity()
    sign = bool(ident["sign"]) and bool(ident["signingKey"])
    if ident["sign"] and not ident["signingKey"]:
        raise Refused(409, "signing is on but no signing key is set; choose a .pub key in Preferences, Git and Identity")
    if amend:
        code, out, _ = await run(t.root, ["for-each-ref", "--contains", "HEAD", "--format=%(refname:short)", "refs/remotes"])
        pushed = [line for line in out.split("\n") if line.strip() and not line.strip().endswith("/HEAD")]
        if code == 0 and pushed:
            raise Refused(409, f"the last commit is already on {pushed[0]}; amending it would rewrite pushed history, so make a new commit instead")
    if not amend:
        code, _, _ = await run(t.root, ["diff", "--cached", "--quiet"])
        has_staged = code == 1
        has_tracked = False
        if all_:
            code, _, _ = await run(t.root, ["diff", "--quiet"])
            has_tracked = code == 1
        if not has_staged and not has_tracked:
            raise Refused(409, "nothing to commit")
    args = ["commit", "-F", "-"]
    if amend:
        args += ["--amend", "--reset-author"]
    if all_:
        args.append("-a")
    if sign:
        args.append("-S")
    code, out, err = await run(t.root, args, configs=[*_ident_configs(ident, sign), f"commit.gpgsign={'true' if sign else 'false'}"], env=_ident_env(ident), stdin=text.encode("utf-8", "surrogateescape"), timeout=NET_TIMEOUT)
    if code != 0:
        message_out = _clip(_pub(err) or _pub(out) or "git commit failed")
        if sign or "nothing to commit" in message_out or "nothing added" in message_out:
            raise Refused(409, message_out)
        raise Refused(500, message_out)
    sha = (await must(t.root, ["rev-parse", "HEAD"])).strip()
    summary = text.split("\n", 1)[0]
    return {"commit": sha, "summary": summary, "identitySource": ident["source"], "audit": await _audit(t.root, ident)}


async def _is_signed(root: str, sha: str) -> bool:
    header = _text((await _exec([_git_bin(), "cat-file", "commit", sha], root))[1]).split("\n\n", 1)[0]
    return any(line.startswith("gpgsig") for line in header.split("\n"))


async def _range_rows(root: str, rev: list[str]) -> list[dict]:
    listing = await must(root, ["log", "--format=%H%x00%h%x00%an <%ae>%x00%cn <%ce>%x00%s%x00%B%x01", *rev, "--"])
    rows = []
    for rec in listing.split("\x01"):
        rec = rec.strip("\n")
        if not rec:
            continue
        sha, short, author, committer, subject, body = (rec.split("\0", 5) + ["", "", "", "", "", ""])[:6]
        rows.append({"sha": sha, "short": short, "author": _pub(author), "committer": _pub(committer), "subject": _pub(subject), "trailers": count_trailers(body)})
    return rows


async def _range_check(root: str, rev: list[str], ident: dict | None, sign: bool) -> dict:
    rows = await _range_rows(root, rev)
    want = f"{ident['name']} <{ident['email']}>" if ident and ident["name"].strip() and ident["email"].strip() else None
    unsigned = other = trailers = 0
    for row in rows:
        if sign and not await _is_signed(root, row["sha"]):
            unsigned += 1
        if want is not None and (row["author"] != want or row["committer"] != want):
            other += 1
        trailers += row["trailers"]
    shown_unsigned = str(unsigned) if sign else "-"
    check = f"New: {len(rows)}  Unsigned: {shown_unsigned}  Other identity: {other}  Trailers: {trailers}"
    return {"new": len(rows), "unsigned": unsigned, "other": other, "trailers": trailers, "check": check, "rows": rows}


async def _branch_base(t: Target) -> str | None:
    branch = (t.item or {}).get("branch")
    if not isinstance(branch, str) or not BRANCH_RE.match(branch):
        return None
    code, out, _ = await run(t.root, ["reflog", "show", "--format=%H", f"refs/heads/{branch}", "--"])
    lines = [line.strip() for line in out.split("\n") if line.strip()]
    if code != 0 or not lines:
        return None
    return lines[-1]


async def agent_audit(t: Target) -> dict:
    if t.session is None or not await _has_head(t.root):
        return {"commits": []}
    stored = _stored_identity()
    ident = stored if stored and stored["name"].strip() and stored["email"].strip() else None
    base = await _branch_base(t)
    rev = ["HEAD", "--not", base] if base else ["HEAD", "--not", "--remotes"]
    rows = await _range_rows(t.root, rev)
    want = f"{ident['name']} <{ident['email']}>" if ident else None
    flagged = []
    for row in rows:
        reasons = []
        if row["trailers"] > 0:
            reasons.append("trailer")
        if want is not None and (row["author"] != want or row["committer"] != want):
            reasons.append("identity")
        if reasons:
            flagged.append({"sha": row["sha"], "short": row["short"], "subject": row["subject"], "author": row["author"], "committer": row["committer"], "reasons": reasons})
    return {"commits": flagged[:AUDIT_MAX]}


async def log(t: Target, limit: int, ref: str | None) -> dict:
    if not 1 <= limit <= 500:
        raise Refused(400, "limit must be between 1 and 500")
    if ref is not None and (not ref or ref.startswith("-") or "\0" in ref):
        raise Refused(400, "bad ref")
    if not await _has_head(t.root):
        return {"commits": []}
    fmt = "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%cI%x1f%G?%x1e"
    args = ["log", f"-n{limit}", fmt]
    if ref:
        args += ["--end-of-options", ref]
    code, out, err = await run(t.root, args, configs=_verify_configs())
    if code != 0:
        raise Refused(404 if ref else 500, _clip(_pub(err)))
    commits = []
    for rec in out.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        f = rec.split("\x1f")
        if len(f) < 7:
            continue
        commits.append({"sha": f[0], "short": f[1], "subject": _pub(f[2]), "author": _pub(f[3]), "email": _pub(f[4]), "date": f[5], "signature": f[6].strip() or "N"})
    return {"commits": commits}


def _snap_ref_prefix(key: str) -> str:
    return f"{SNAP_ROOT}/{key}/"


def _note_count(key: str, count: int) -> None:
    if key == "workspace":
        return
    try:
        from app.services import sessions as sv

        sv.note_snapshots(key, count)
    except Exception:
        return


async def _adopt_old_snapshots(t: Target) -> None:
    code, out, _ = await run(t.root, ["for-each-ref", "--format=%(refname) %(objectname)", f"{OLD_SNAP_ROOT}/{t.key}/"])
    if code != 0:
        return
    for line in out.splitlines():
        name, _, sha = line.strip().partition(" ")
        tail = name.rsplit("/", 1)[-1]
        if tail.isdigit() and sha:
            moved, _, _ = await run(t.root, ["update-ref", f"{_snap_ref_prefix(t.key)}{tail}", sha, "0" * len(sha)])
            if moved == 0:
                await run(t.root, ["update-ref", "-d", name, sha])


async def snapshot_list(t: Target) -> list[dict]:
    await _adopt_old_snapshots(t)
    fmt ="%(refname)%1f%(objectname)%1f%(committerdate:iso-strict)%1f%(contents:subject)%1f%(contents:body)%1e"
    code, out, _ = await run(t.root, ["for-each-ref", f"--format={fmt}", _snap_ref_prefix(t.key)])
    if code != 0:
        return []
    found = []
    for rec in out.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        f = rec.split("\x1f")
        if len(f) < 5:
            continue
        tail = f[0].rsplit("/", 1)[-1]
        if not tail.isdigit():
            continue
        match = re.search(r"files: (\d+)", f[4])
        found.append({"n": int(tail), "ref": f[0], "commit": f[1], "label": _pub(f[3]), "created": f[2], "files": int(match.group(1)) if match else 0})
    found.sort(key=lambda s: s["n"], reverse=True)
    return found


async def snapshot_create(t: Target, label: object = None) -> dict:
    text = " ".join(str(label or "").split())[:200] or "snapshot"
    has_head = await _has_head(t.root)
    folder = tempfile.mkdtemp(prefix="sfsnap-")
    try:
        env = {"GIT_INDEX_FILE": os.path.join(folder, "index")}
        if has_head:
            await must(t.root, ["read-tree", "HEAD"], env=env)
        await must(t.root, ["add", "-A"], env=env)
        tree = (await must(t.root, ["write-tree"], env=env)).strip()
        changed = 0
        if has_head:
            names = await must(t.root, ["diff-tree", "-r", "--name-only", "-z", "HEAD", tree])
            changed = len([n for n in names.split("\0") if n])
        else:
            names = await must(t.root, ["ls-tree", "-r", "--name-only", "-z", tree])
            changed = len([n for n in names.split("\0") if n])
        existing = await snapshot_list(t)
        number = (existing[0]["n"] + 1) if existing else 1
        args = ["commit-tree", tree, "-m", f"{text}\n\nfiles: {changed}"]
        if has_head:
            args += ["-p", "HEAD"]
        sha = (await must(t.root, args, configs=["commit.gpgsign=false"], env=SNAP_IDENT)).strip()
        ref = f"{_snap_ref_prefix(t.key)}{number}"
        for _ in range(SNAP_MAX):
            code, _, _ = await run(t.root, ["update-ref", ref, sha, "0" * len(sha)])
            if code == 0:
                break
            number += 1
            ref = f"{_snap_ref_prefix(t.key)}{number}"
        else:
            raise Refused(409, "could not record the snapshot; try again")
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    listing = await snapshot_list(t)
    for stale in listing[SNAP_MAX:]:
        await run(t.root, ["update-ref", "-d", stale["ref"]])
    kept = listing[:SNAP_MAX]
    _note_count(t.key, len(kept))
    mine = next((s for s in kept if s["n"] == number), None)
    return mine or {"n": number, "ref": ref, "commit": sha, "label": text, "created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "files": changed}


async def snapshot_for_item(item: dict, label: str) -> dict:
    root = item.get("worktree") or ""
    if not os.path.isdir(root):
        raise Refused(409, "the worktree of this session no longer exists")
    return await snapshot_create(Target(os.path.realpath(root), item["id"], item["id"], item), label)


async def rewind(t: Target, n: object) -> dict:
    if not isinstance(n, int) or isinstance(n, bool):
        raise Refused(400, "n must be a snapshot number")
    if t.item is not None and t.item.get("state") in LIVE_STATES:
        raise Refused(409, "the session is running; stop it before rewinding")
    snaps = await snapshot_list(t)
    target = next((s for s in snaps if s["n"] == n), None)
    if target is None:
        raise Refused(404, "no such snapshot")
    safety = await snapshot_create(t, f"before rewind to {n}")
    folder = tempfile.mkdtemp(prefix="sfrewind-")
    try:
        env = {"GIT_INDEX_FILE": os.path.join(folder, "index")}
        await must(t.root, ["read-tree", target["commit"]], env=env)
        wanted_raw = await must(t.root, ["ls-tree", "-r", "--name-only", "-z", target["commit"]])
        wanted = {name for name in wanted_raw.split("\0") if name}
        present_raw = await must(t.root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        present = {name for name in present_raw.split("\0") if name}
        for name in sorted(present - wanted):
            full = os.path.join(t.root, *name.split("/"))
            try:
                if os.path.lexists(full) and not os.path.isdir(full):
                    os.remove(full)
            except OSError:
                continue
            _prune_dirs(t.root, os.path.dirname(full))
        await must(t.root, ["checkout-index", "-a", "-f"], env=env)
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    return {"restored": target, "safety": safety, "status": await status(t)}


async def _current_branch(t: Target) -> str:
    code, out, _ = await run(t.root, ["symbolic-ref", "--short", "-q", "HEAD"])
    name = out.strip()
    if code != 0 or not name:
        raise Refused(409, "HEAD is detached; check out a branch first")
    return name


async def _remote_and_branch(t: Target, remote: object, branch: object) -> tuple[str, str]:
    remote = str(remote or "origin")
    if not REMOTE_RE.match(remote):
        raise Refused(400, "bad remote name")
    name = str(branch).strip() if branch else await _current_branch(t)
    if not BRANCH_RE.match(name):
        raise Refused(400, "bad branch name")
    code, _, _ = await run(t.root, ["check-ref-format", "--branch", name])
    if code != 0:
        raise Refused(400, "bad branch name")
    code, remotes, _ = await run(t.root, ["remote"])
    if code != 0 or remote not in remotes.split():
        raise Refused(400, f"{remote} is not a remote of this repository")
    return remote, name


def _push_args(remote: str, name: str) -> tuple[list[str], list[str]]:
    return ["push", "--no-force-with-lease", "-u", remote, f"refs/heads/{name}:refs/heads/{name}"], []


def _combined(out: str, err: str) -> str:
    return _clip(_pub((out + "\n" + err).strip()), OUT_MAX)


async def push(t: Target, remote: object, branch: object) -> dict:
    remote, name = await _remote_and_branch(t, remote, branch)
    ident = await identity_get()
    signing = ident["source"] == "formsubstrate" and bool(ident["sign"]) and bool(ident["signingKey"])
    found = await _range_check(t.root, [f"refs/heads/{name}", "--not", f"--remotes={remote}"], ident if ident["source"] == "formsubstrate" else None, signing)
    if found["unsigned"] or found["other"] or found["trailers"]:
        raise Refused(409, "not pushed, nothing was changed: " + found["check"], {"ok": False, "check": found["check"], "output": ""})
    args, configs = _push_args(remote, name)
    code, out, err = await run(t.root, args, configs=configs, timeout=NET_TIMEOUT)
    if code != 0:
        raise Refused(409, _clip(_pub(err) or _pub(out) or "git push failed"))
    return {"ok": True, "check": found["check"], "output": _combined(out, err)}


async def _agent_identity(t: Target) -> str:
    code, name, _ = await run(t.root, ["config", "--worktree", "--get", "user.name"])
    code2, email, _ = await run(t.root, ["config", "--worktree", "--get", "user.email"])
    if code != 0 or code2 != 0 or not name.strip() or not email.strip():
        return ""
    return f"{name.strip()} <{email.strip()}>"


async def sign_and_push(t: Target, remote: object, branch: object) -> dict:
    ident = await identity_get()
    if ident["source"] != "formsubstrate" or not ident["sign"] or not ident["signingKey"]:
        raise Refused(409, "signing is off or no signing key is set; turn on signing and choose a .pub key in Preferences, Git and Identity")
    remote, name = await _remote_and_branch(t, remote, branch)
    if name != await _current_branch(t):
        raise Refused(409, f"check out {name} before signing and pushing it")
    code, out, err = await run(t.root, ["fetch", remote], timeout=NET_TIMEOUT)
    if code != 0:
        raise Refused(409, _clip(_pub(err) or "git fetch failed"))
    upstream = f"{remote}/{name}"
    code, tip, _ = await run(t.root, ["rev-parse", "--verify", "--quiet", f"refs/remotes/{upstream}^{{commit}}"])
    floor = tip.strip()
    where = upstream
    if code != 0:
        start = await _branch_base(t) if t.session is not None else None
        if not start:
            raise Refused(409, f"{upstream} was not found on the remote; use Push for a new branch")
        floor = start
        where = f"the point {name} was created from"
    code, base, _ = await run(t.root, ["merge-base", f"refs/heads/{name}", floor])
    if code != 0 or base.strip() != floor:
        raise Refused(409, f"{where} has commits that {name} does not; pull or rebase first")
    span = f"{floor}..refs/heads/{name}"
    count = int((await must(t.root, ["rev-list", "--count", span])).strip() or 0)
    if count == 0:
        raise Refused(409, "there is nothing new to sign and push")
    want_before = f"{ident['name']} <{ident['email']}>"
    merges = (await must(t.root, ["rev-list", "--merges", "--count", span])).strip()
    if merges not in ("", "0"):
        raise Refused(409, f"the range holds {merges} merge commit(s); signing would flatten them, so nothing was changed")
    allowed = {want_before}
    if t.session is not None:
        allowed.add(await _agent_identity(t))
    pre_rows = [line.split("\0") for line in (await must(t.root, ["log", "--format=%an <%ae>%x00%cn <%ce>%x00%T%x00%s", span])).split("\n") if line]
    foreign = sum(1 for row in pre_rows if row[0] not in allowed or row[1] not in allowed)
    if foreign:
        check = f"New: {count}  Unsigned: -  Other identity: {foreign}  Trailers: -"
        raise Refused(409, f"not signed: {foreign} commit(s) in the range are by an author or committer who is neither you nor this session's agent, and signing would take them over; nothing was changed", {"ok": False, "check": check, "output": ""})
    pre_shape = [(row[2], row[3]) for row in pre_rows]
    code, dirty, _ = await run(t.root, ["status", "--porcelain", "--untracked-files=no"])
    if code == 0 and dirty.strip():
        raise Refused(409, "there are uncommitted changes to tracked files; commit or discard them first, because signing rewrites the new commits")
    original = (await must(t.root, ["rev-parse", f"refs/heads/{name}"])).strip()
    configs = [*_ident_configs(ident, True), "commit.gpgsign=true", f"core.hooksPath={ensure_hooks()}"]
    code, out, err = await run(t.root, ["rebase", "--exec", "git commit --amend --allow-empty --no-edit --reset-author -S", floor], configs=configs, env=_ident_env(ident), timeout=NET_TIMEOUT)
    if code != 0:
        await run(t.root, ["rebase", "--abort"])
        raise Refused(409, _clip(_pub(err) or _pub(out) or "git rebase failed"))

    async def restore() -> None:
        await run(t.root, ["reset", "--keep", original])
    found = await _range_check(t.root, [span], ident, True)
    unsigned, other, trailers, check = found["unsigned"], found["other"], found["trailers"], found["check"]
    post_rows = [line.split("\0") for line in (await run(t.root, ["log", "--format=%T%x00%s", span]))[1].split("\n") if line]
    if [(row[0], row[1]) for row in post_rows] != pre_shape:
        other += 1
        check += "  Rewritten commits do not match the originals"
    if unsigned or other or trailers:
        await restore()
        raise Refused(409, "not pushed, and the branch was put back as it was: " + check, {"ok": False, "check": check, "output": ""})
    args, push_configs = _push_args(remote, name)
    code, out, err = await run(t.root, args, configs=push_configs, timeout=NET_TIMEOUT)
    if code != 0:
        await restore()
        raise Refused(409, "not pushed, and the branch was put back as it was: " + _clip(_pub(err) or _pub(out) or "git push failed"), {"ok": False, "check": check, "output": ""})
    return {"ok": True, "check": check, "output": _combined(out, err)}
