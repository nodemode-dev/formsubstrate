import hashlib
import os
import posixpath
import re
import threading
import time

from app.core import workspace_root as ws

MAX_FILES = 8000
MAX_FILE_BYTES = 262144
MAX_READ_TOTAL = 64 * 1024 * 1024
BUDGET_SECONDS = 6.0
EDGE_CAP = 60000
SPEC_CAP = 400
SKIP_DIRS = frozenset(ws.HIDDEN_NAMES) | {".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", "build", "out", "coverage", "site-packages", ".gradle", "Pods"}

JS_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte")
STYLE_EXTS = (".css", ".scss", ".sass", ".less")
HTML_EXTS = (".html", ".htm")
DOC_EXTS = (".md", ".mdx", ".markdown")
C_EXTS = (".c", ".h", ".cc", ".cpp", ".hpp", ".cxx", ".hxx", ".m", ".mm")
NODE_EXTS = frozenset(JS_EXTS + STYLE_EXTS + HTML_EXTS + DOC_EXTS + C_EXTS + (
    ".py", ".pyi", ".rs", ".go", ".java", ".kt", ".swift", ".rb", ".php", ".cs", ".lua", ".sh", ".bash", ".zsh", ".ps1", ".bat",
    ".json", ".jsonc", ".toml", ".yaml", ".yml", ".ini", ".cfg", ".sql", ".graphql", ".proto", ".txt", ".xml", ".svg", ".lock",
))
JS_TRY = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".json", ".css", ".scss")
JS_SWAP = {".js": (".ts", ".tsx"), ".jsx": (".tsx",), ".mjs": (".mts",), ".cjs": (".cts",)}

JS_FROM = re.compile(r"""(?:^|[;\s}])(?:import|export)\s+(?:type\s+)?(?:[^'";`]{0,400}?\s*from\s*)?['"]([^'"\n]{1,300})['"]""")
JS_CALL = re.compile(r"""(?:\bimport|\brequire)\s*\(\s*['"]([^'"\n]{1,300})['"]\s*[,)]""")
JS_URL = re.compile(r"""new\s+(?:URL|Worker)\(\s*['"]([^'"\n]{1,300})['"]""")
PY_FROM = re.compile(r"^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]*)", re.M)
PY_IMPORT = re.compile(r"^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)", re.M)
CSS_IMPORT = re.compile(r"""@(?:import|use|forward)\s+(?:url\()?\s*['"]([^'"\n]{1,300})['"]""")
HTML_REF = re.compile(r"""\b(?:src|href)\s*=\s*["']([^"'#?\s]{1,300})""", re.I)
MD_LINK = re.compile(r"""\]\(\s*<?([^)\s>#]{1,300})(?:#[^)\s]*)?(?:\s+["'][^"']*["'])?\s*\)""")
RS_MOD = re.compile(r"^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;", re.M)
C_INCLUDE = re.compile(r"""^[ \t]*#[ \t]*include[ \t]+"([^"\n]{1,300})\"""", re.M)

_lock = threading.Lock()
_scan_lock = threading.Lock()
_specs: dict[str, dict[str, tuple[int, int, tuple]]] = {}
_results: dict[str, tuple[str, dict]] = {}


def _walk(base: str, deadline: float) -> tuple[list[tuple[str, int, int]], bool]:
    out: list[tuple[str, int, int]] = []
    stack = [""]
    cut = False
    while stack:
        rel_dir = stack.pop()
        if time.monotonic() > deadline or len(out) >= MAX_FILES:
            cut = True
            break
        try:
            scan = os.scandir(os.path.join(base, rel_dir) if rel_dir else base)
        except OSError:
            continue
        with scan:
            for item in scan:
                try:
                    if item.is_symlink():
                        continue
                    rel = f"{rel_dir}/{item.name}" if rel_dir else item.name
                    if item.is_dir(follow_symlinks=False):
                        if item.name not in SKIP_DIRS:
                            stack.append(rel)
                        continue
                    ext = os.path.splitext(item.name)[1].lower()
                    if ext not in NODE_EXTS:
                        continue
                    info = item.stat(follow_symlinks=False)
                except OSError:
                    continue
                if len(out) >= MAX_FILES:
                    cut = True
                    break
                out.append((rel, info.st_mtime_ns, info.st_size))
    out.sort(key=lambda row: row[0])
    return out, cut


def _read(base: str, rel: str) -> str:
    try:
        real, _ = ws.resolve(rel, follow=False)
        with open(real, "rb") as handle:
            raw = handle.read(MAX_FILE_BYTES)
    except (OSError, ws.Refused):
        return ""
    if b"\0" in raw[:4096]:
        return ""
    return raw.decode("utf-8", errors="replace")


def _specs_for(rel: str, text: str) -> tuple:
    ext = os.path.splitext(rel)[1].lower()
    found: list[tuple[str, str]] = []
    if ext in JS_EXTS:
        for rx in (JS_FROM, JS_CALL, JS_URL):
            found.extend(("js", m.group(1)) for m in rx.finditer(text))
    elif ext in (".py", ".pyi"):
        for m in PY_FROM.finditer(text):
            names = [n.strip().split(" ")[0] for n in m.group(2).strip("() \t\n").replace("\n", " ").split(",")]
            found.append(("pyfrom", m.group(1) + "\0" + "\0".join(n for n in names if n and n != "*")))
        for m in PY_IMPORT.finditer(text):
            found.extend(("pyabs", part.strip().split(" ")[0]) for part in m.group(1).split(","))
    elif ext in STYLE_EXTS:
        found.extend(("css", m.group(1)) for m in CSS_IMPORT.finditer(text))
    elif ext in HTML_EXTS:
        found.extend(("web", m.group(1)) for m in HTML_REF.finditer(text))
    elif ext in DOC_EXTS:
        found.extend(("web", m.group(1)) for m in MD_LINK.finditer(text))
    elif ext == ".rs":
        found.extend(("rs", m.group(1)) for m in RS_MOD.finditer(text))
    elif ext in C_EXTS:
        found.extend(("web", m.group(1)) for m in C_INCLUDE.finditer(text))
    return tuple(found[:SPEC_CAP])


def _clean(spec: str) -> str:
    return spec.split("?", 1)[0].split("#", 1)[0]


def _under(path: str, files: set[str]) -> str | None:
    return path if path in files else None


def _resolve_js(here: str, spec: str, files: set[str]) -> str | None:
    spec = _clean(spec)
    if spec.startswith("/"):
        target = posixpath.normpath(spec.lstrip("/"))
    elif spec.startswith("."):
        target = posixpath.normpath(posixpath.join(posixpath.dirname(here), spec))
    else:
        return None
    if target.startswith(".."):
        return None
    hit = _under(target, files)
    if hit:
        return hit
    stem, ext = posixpath.splitext(target)
    for swap in JS_SWAP.get(ext, ()):
        hit = _under(stem + swap, files)
        if hit:
            return hit
    for ext in JS_TRY:
        hit = _under(target + ext, files)
        if hit:
            return hit
    for ext in JS_TRY:
        hit = _under(f"{target}/index{ext}", files)
        if hit:
            return hit
    return None


def _resolve_css(here: str, spec: str, files: set[str]) -> str | None:
    spec = _clean(spec)
    if not spec.startswith((".", "/")) and ":" not in spec:
        spec = "./" + spec
    if ":" in spec:
        return None
    target = posixpath.normpath(spec.lstrip("/")) if spec.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(here), spec))
    if target.startswith(".."):
        return None
    head, tail = posixpath.split(target)
    for cand in (target, target + ".css", target + ".scss", target + ".sass", target + ".less", posixpath.join(head, "_" + tail) + ".scss", posixpath.join(head, "_" + tail)):
        if cand in files:
            return cand
    return None


def _resolve_web(here: str, spec: str, files: set[str]) -> str | None:
    spec = _clean(spec)
    if not spec or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", spec) or spec.startswith("//"):
        return None
    target = posixpath.normpath(spec.lstrip("/")) if spec.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(here), spec))
    if target.startswith(".."):
        return None
    hit = _under(target, files)
    if hit:
        return hit
    return _resolve_js(here, "/" + target, files) if not spec.startswith("/") else None


def _py_index(files: set[str]) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}
    for rel in files:
        if not rel.endswith((".py", ".pyi")):
            continue
        parts = rel.rsplit(".", 1)[0].split("/")
        if parts[-1] == "__init__":
            parts = parts[:-1]
        if not parts:
            continue
        for i in range(len(parts)):
            index.setdefault(".".join(parts[i:]), []).append(rel)
    return index


def _py_pick(index: dict[str, list[str]], dotted: str, here: str) -> str | None:
    cands = index.get(dotted)
    if not cands:
        return None
    if len(cands) == 1:
        return cands[0]
    mine = here.split("/")
    best = max(cands, key=lambda c: len(os.path.commonprefix([mine, c.split("/")])))
    return best if best != here else None


def _resolve_py(here: str, kind: str, spec: str, files: set[str], index: dict[str, list[str]]) -> list[str]:
    out: list[str] = []
    if kind == "pyabs":
        hit = _py_pick(index, spec, here)
        return [hit] if hit else []
    head, *names = spec.split("\0")
    level = len(head) - len(head.lstrip("."))
    mod = head.lstrip(".")
    if level:
        base = posixpath.dirname(here)
        for _ in range(level - 1):
            base = posixpath.dirname(base)
        prefix = posixpath.join(base, *mod.split(".")) if mod else base
        prefix = prefix.strip("/")
        cands = [prefix + ".py", posixpath.join(prefix, "__init__.py")] if mod else [posixpath.join(prefix, "__init__.py") if prefix else "__init__.py"]
        out.extend(c for c in cands if c in files)
        for name in names:
            sub = posixpath.join(prefix, name) if prefix else name
            out.extend(c for c in (sub + ".py", posixpath.join(sub, "__init__.py")) if c in files)
        return out
    if mod:
        hit = _py_pick(index, mod, here)
        if hit:
            out.append(hit)
        for name in names:
            sub = _py_pick(index, f"{mod}.{name}", here)
            if sub:
                out.append(sub)
    return out


def _resolve_rs(here: str, name: str, files: set[str]) -> str | None:
    folder = posixpath.dirname(here)
    stem = posixpath.splitext(posixpath.basename(here))[0]
    bases = [folder] if stem in ("mod", "lib", "main") else [posixpath.join(folder, stem), folder]
    for base in bases:
        for cand in (posixpath.join(base, name + ".rs"), posixpath.join(base, name, "mod.rs")):
            if cand in files:
                return cand
    return None


def _targets(here: str, spec: tuple[str, str], files: set[str], index: dict[str, list[str]]) -> list[str]:
    kind, text = spec
    if kind == "js":
        hit = _resolve_js(here, text, files)
    elif kind == "css":
        hit = _resolve_css(here, text, files)
    elif kind == "web":
        hit = _resolve_web(here, text, files)
    elif kind == "rs":
        hit = _resolve_rs(here, text, files)
    else:
        return _resolve_py(here, kind, text, files, index)
    return [hit] if hit else []


def compute(known_sig: str | None = None) -> dict:
    started = time.monotonic()
    deadline = started + BUDGET_SECONDS
    base = ws.real_root()
    with _scan_lock:
        rows, cut = _walk(base, deadline)
        digest = hashlib.sha1()
        for rel, mtime, size in rows:
            digest.update(f"{rel}\0{mtime}\0{size}\n".encode("utf-8", "surrogatepass"))
        sig = digest.hexdigest()
        with _lock:
            held = _results.get(base)
        if held and held[0] == sig and not cut:
            if known_sig == sig:
                return {"unchanged": True, "sig": sig}
            return {**held[1], "cached": True, "elapsedMs": int((time.monotonic() - started) * 1000)}
        files = {rel for rel, _, _ in rows}
        index = _py_index(files)
        with _lock:
            memo = _specs.setdefault(base, {})
            for stale in [k for k in memo if k not in files]:
                del memo[stale]
        read_bytes = 0
        parsed = 0
        late = False
        ids = {rel: i for i, (rel, _, _) in enumerate(rows)}
        edges: set[tuple[int, int]] = set()
        for rel, mtime, size in rows:
            with _lock:
                entry = memo.get(rel)
            if entry and entry[0] == mtime and entry[1] == size:
                specs = entry[2]
            elif time.monotonic() > deadline or read_bytes > MAX_READ_TOTAL:
                late = True
                continue
            else:
                text = _read(base, rel)
                read_bytes += min(size, MAX_FILE_BYTES)
                specs = _specs_for(rel, text) if text else ()
                parsed += 1
                with _lock:
                    memo[rel] = (mtime, size, specs)
            src = ids[rel]
            for spec in specs:
                for target in _targets(rel, spec, files, index):
                    dst = ids.get(target)
                    if dst is not None and dst != src and len(edges) < EDGE_CAP:
                        edges.add((src, dst))
        cut = cut or late
        payload = {
            "sig": sig,
            "root": ws.display_name(base),
            "nodes": [{"path": rel, "size": size, "mtime": mtime // 1_000_000} for rel, mtime, size in rows],
            "edges": [[a, b] for a, b in sorted(edges)],
            "truncated": cut,
            "reason": "time or size budget reached; refresh to continue" if cut else "",
            "parsed": parsed,
            "cached": False,
        }
        if not cut:
            with _lock:
                _results[base] = (sig, payload)
        payload["elapsedMs"] = int((time.monotonic() - started) * 1000)
        return payload
