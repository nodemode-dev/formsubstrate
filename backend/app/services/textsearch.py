import hashlib
import multiprocessing
import os
import re
import time

SNIFF_BYTES = 8192
TEXT_MAX = 240
REGEX_BUDGET = 8.0
LITERAL_BUDGET = 15.0
APPLY_TEXT_MAX = 64 * 1024 * 1024


class BadPattern(Exception):
    pass


class Stopped(Exception):
    pass


def compile_pattern(q: str, regex: bool, case: bool) -> re.Pattern:
    try:
        return re.compile(q if regex else re.escape(q), 0 if case else re.IGNORECASE)
    except re.error as err:
        raise BadPattern(f"bad pattern: {err}")
    except (OverflowError, RecursionError):
        raise BadPattern("bad pattern: too complex")


def compile_template(template: str, regex: bool, pattern: re.Pattern):
    if not regex:
        return lambda m: template
    parts: list = []
    text: list[str] = []
    i = 0
    n = len(template)
    while i < n:
        c = template[i]
        if c != "$" or i + 1 >= n:
            text.append(c)
            i += 1
            continue
        nxt = template[i + 1]
        ref: object = None
        if nxt == "$":
            text.append("$")
            i += 2
            continue
        if nxt == "&":
            ref, i = 0, i + 2
        elif nxt.isdigit():
            j = i + 1
            while j < n and j < i + 3 and template[j].isdigit():
                j += 1
            digits = template[i + 1:j]
            while len(digits) > 1 and int(digits) > pattern.groups:
                digits = digits[:-1]
            ref, i = int(digits), i + 1 + len(digits)
        elif nxt == "{":
            end = template.find("}", i + 2)
            if end < 0:
                text.append(c)
                i += 1
                continue
            name = template[i + 2:end]
            ref = int(name) if name.isdigit() else name
            i = end + 1
        else:
            text.append(c)
            i += 1
            continue
        if isinstance(ref, int) and ref > pattern.groups:
            raise BadPattern(f"replacement names group {ref}; the pattern has {pattern.groups}")
        if isinstance(ref, str) and ref not in pattern.groupindex:
            raise BadPattern(f"replacement names group {ref!r}, which the pattern does not have")
        if text:
            parts.append("".join(text))
            text = []
        parts.append((ref,))
    if text:
        parts.append("".join(text))

    def expand(m: re.Match) -> str:
        return "".join(p if isinstance(p, str) else (m.group(p[0]) or "") for p in parts)

    return expand


def _translate(body: str) -> str:
    out: list[str] = []
    i = 0
    n = len(body)
    while i < n:
        c = body[i]
        if body.startswith("**/", i) and (i == 0 or body[i - 1] == "/"):
            out.append("(?:.*/)?")
            i += 3
        elif body.startswith("**", i) and (i == 0 or body[i - 1] == "/") and i + 2 == n:
            out.append(".*")
            i += 2
        elif c == "*":
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        elif c == "[":
            end = body.find("]", i + 2 if body.startswith("[!", i) or body.startswith("[^", i) else i + 1)
            if end < 0:
                out.append(re.escape(c))
                i += 1
                continue
            inner = body[i + 1:end]
            if inner[:1] in ("!", "^"):
                inner = "^" + inner[1:]
            out.append("[" + inner.replace("\\", "\\\\") + "]")
            i = end + 1
        elif c == "{":
            end = body.find("}", i + 1)
            if end < 0:
                out.append(re.escape(c))
                i += 1
                continue
            out.append("(?:" + "|".join(_translate(alt) for alt in body[i + 1:end].split(",")) + ")")
            i = end + 1
        elif c == "\\" and i + 1 < n:
            out.append(re.escape(body[i + 1]))
            i += 2
        else:
            out.append(re.escape(c))
            i += 1
    return "".join(out)


def glob_regex(glob: str) -> re.Pattern:
    body = glob.strip()
    anchored = "/" in body.rstrip("/")
    body = body.strip("/")
    rx = _translate(body)
    return re.compile(r"\A" + (rx if anchored else r"(?:.*/)?" + rx) + r"\Z")


class Filter:
    def __init__(self, glob: str, hidden: tuple[str, ...], excludes: tuple[str, ...] = ()):
        glob = glob.strip()
        self.include: list[re.Pattern] = []
        self.exclude: list[re.Pattern] = [glob_regex(x) for x in tuple(hidden) + tuple(excludes) if x.strip()]
        if glob.startswith("!") and glob[1:].strip():
            self.exclude.append(glob_regex(glob[1:]))
        elif glob:
            self.include.append(glob_regex(glob))

    def pruned(self, rel: str) -> bool:
        return any(p.match(rel) for p in self.exclude)

    def wanted(self, rel: str, ancestors: bool = False) -> bool:
        parts = rel.split("/")
        heads = ["/".join(parts[:k]) for k in range(1, len(parts) + 1)] if ancestors else [rel]
        if any(self.pruned(head) for head in heads):
            return False
        return not self.include or any(p.match(rel) for p in self.include)


def walk(base: str, filt: Filter):
    for folder, dirs, files in os.walk(base):
        here = os.path.relpath(folder, base).replace(os.sep, "/")
        here = "" if here == "." else here
        keep = []
        for d in sorted(dirs):
            rel = f"{here}/{d}" if here else d
            if os.path.islink(os.path.join(folder, d)) or filt.pruned(rel):
                continue
            keep.append(d)
        dirs[:] = keep
        for name in sorted(files):
            full = os.path.join(folder, name)
            rel = f"{here}/{name}" if here else name
            if os.path.islink(full) or not filt.wanted(rel):
                continue
            yield rel, full


def load(full: str, cap: int) -> tuple[str, bytes] | None:
    try:
        if os.path.getsize(full) > cap:
            return None
        with open(full, "rb") as handle:
            data = handle.read(cap + 1)
    except OSError:
        return None
    if len(data) > cap or b"\0" in data[:SNIFF_BYTES]:
        return None
    try:
        return data.decode("utf-8"), data
    except UnicodeDecodeError:
        return None


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _lines(text: str):
    rows = text.split("\n")
    last = len(rows) - 1
    for index, row in enumerate(rows):
        if index == last and row == "":
            return
        yield index + 1, row[:-1] if row.endswith("\r") else row


def _trim(text: str) -> str:
    return text.strip()[:TEXT_MAX]


def search_files(base, q, regex, case, glob, hidden, excludes, cap, read_max, deadline, emit) -> bool:
    pattern = compile_pattern(q, regex, case)
    filt = Filter(glob, hidden, excludes)
    count = 0
    for rel, full in walk(base, filt):
        if time.monotonic() > deadline:
            return True
        got = load(full, read_max)
        if got is None:
            continue
        hits = []
        for number, line in _lines(got[0]):
            found = pattern.search(line)
            if found:
                hits.append({"path": rel, "line": number, "col": found.start() + 1, "text": _trim(line)})
                count += 1
                if count > cap:
                    break
        if hits:
            emit(hits)
        if count > cap:
            return False
    return False


def replace_text(pattern: re.Pattern, expand, text: str, lines=None) -> tuple[str, int, list[dict]]:
    want = set(lines) if lines is not None else None
    out: list[str] = []
    hits: list[dict] = []
    count = 0
    rows = text.split("\n")
    for index, row in enumerate(rows):
        number = index + 1
        body, tail = (row[:-1], "\r") if row.endswith("\r") else (row, "")
        if (want is None or number in want) and not (index == len(rows) - 1 and row == ""):
            found = pattern.search(body)
            if found:
                new, made = pattern.subn(expand, body)
                if made:
                    count += made
                    hits.append({"line": number, "col": found.start() + 1, "before": _trim(body), "after": _trim(new), "count": made})
                    body = new
        out.append(body + tail)
    return "\n".join(out), count, hits


def plan_files(base, q, regex, case, glob, hidden, excludes, template, cap, read_max, deadline, emit, paths=None, full=False) -> bool:
    pattern = compile_pattern(q, regex, case)
    expand = compile_template(template, regex, pattern)
    filt = Filter(glob, hidden, excludes)
    source = iter(paths) if paths is not None else walk(base, filt)
    count = 0
    for rel, path in source:
        if time.monotonic() > deadline:
            return True
        if paths is not None and not filt.wanted(rel, ancestors=True):
            continue
        got = load(path, read_max)
        if got is None:
            continue
        text, data = got
        after, made, hits = replace_text(pattern, expand, text)
        if not hits:
            continue
        if count + len(hits) > cap:
            hits = hits[:max(0, cap - count)]
            if not hits:
                return False
        count += len(hits)
        try:
            info = os.stat(path)
        except OSError:
            continue
        item = {"path": rel, "hash": digest(data), "size": info.st_size, "mtime": info.st_mtime, "hits": hits}
        if full:
            item["before"] = text
            item["after"] = after
        emit(item)
        if count >= cap:
            return False
    return False


def apply_many(q, regex, case, template, jobs, deadline, emit) -> bool:
    pattern = compile_pattern(q, regex, case)
    expand = compile_template(template, regex, pattern)
    for key, text, lines in jobs:
        if time.monotonic() > deadline:
            return True
        after, made, _ = replace_text(pattern, expand, text, lines)
        emit((key, after, made))
    return False


JOBS = {"search": search_files, "plan": plan_files, "apply": apply_many}


def _child(conn, job: str, args: tuple, kwargs: dict, budget: float) -> None:
    try:
        stopped = JOBS[job](*args, deadline=time.monotonic() + budget, emit=lambda part: conn.send(("part", part)), **kwargs)
        conn.send(("done", stopped))
    except BadPattern as err:
        conn.send(("bad", str(err)))
    except Exception as err:
        conn.send(("error", type(err).__name__))
    finally:
        conn.close()


def run(job: str, args: tuple, kwargs: dict, guarded: bool) -> tuple[list, bool]:
    if not guarded:
        parts: list = []
        stopped = JOBS[job](*args, deadline=time.monotonic() + LITERAL_BUDGET, emit=parts.append, **kwargs)
        return parts, stopped
    ctx = multiprocessing.get_context("spawn")
    reader, writer = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_child, args=(writer, job, args, kwargs, REGEX_BUDGET), daemon=True, name="formsubstrate-regex")
    deadline = time.monotonic() + REGEX_BUDGET + 2.0
    parts = []
    proc.start()
    writer.close()
    try:
        while True:
            left = deadline - time.monotonic()
            if left <= 0 or not reader.poll(left):
                return parts, True
            try:
                kind, payload = reader.recv()
            except EOFError:
                raise Stopped("the search worker ended early")
            if kind == "part":
                parts.append(payload)
            elif kind == "done":
                return parts, bool(payload)
            elif kind == "bad":
                raise BadPattern(payload)
            else:
                raise Stopped(f"the search worker failed ({payload})")
    finally:
        if proc.is_alive():
            proc.kill()
        proc.join(1)
        reader.close()
