SCRIPT = r'''import ast
import json
import math
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
WAIT_DEFAULT = 120
WAIT_MAX = 120
LINE_TOKENS = 10
SLOT_RE = re.compile(r"slot (\S+) \(\w+\) at (\S+?):(\d+)")
UNIT_RE = re.compile(r"unit (\S+) \((\S+?):(\d+)\)")
BASH_CAP = 8
BASH_WAIT = 125
READ_MAX = 1048576
SNAP_KEEP = 86400
POST_BUDGET = 1.7
POST_FILES = 50
POST_BYTES = 262144
WRAP_ARGS = {"sudo": "ughprtCDRTU", "env": "uCS", "command": "", "builtin": "", "exec": "", "nohup": "", "time": "fo", "nice": "n", "stdbuf": ""}
RESERVED = ("{", "!", "if", "then", "else", "elif", "do", "while", "until")
DECLARE = ("export", "declare", "local", "readonly", "typeset")
UNSET = ("unset", "read", "for", "select", "getopts", "mapfile", "readarray")
ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\+?=")
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
VAR_REF = re.compile(r"\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})")
VARS_CAP = 256
CURL_SHORT = "ACbcdDeEFHKmoPQrtTuUwxXyYz"
CURL_LONG = frozenset(("--header", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--data-ascii", "--json", "--user", "--request", "--user-agent", "--referer", "--cookie", "--cookie-jar", "--max-time", "--connect-timeout", "--retry", "--retry-delay", "--retry-max-time", "--proxy", "--proxy-user", "--form", "--form-string", "--upload-file", "--write-out", "--url-query", "--cacert", "--capath", "--cert", "--key", "--resolve", "--connect-to", "--range", "--limit-rate", "--config", "--dump-header", "--continue-at", "--time-cond", "--interface", "--local-port", "--max-filesize", "--max-redirs", "--expect100-timeout", "--aws-sigv4", "--oauth2-bearer", "--tls-max", "--ciphers", "--stderr", "--trace", "--trace-ascii", "--noproxy", "--proto", "--proto-redir", "--speed-limit", "--speed-time", "--unix-socket", "--happy-eyeballs-timeout-ms"))
WGET_SHORT = "OoaPtTweiBUlQARDIX"
WGET_LONG = frozenset(("--output-file", "--append-output", "--tries", "--timeout", "--wait", "--waitretry", "--execute", "--input-file", "--base", "--user-agent", "--header", "--post-data", "--post-file", "--referer", "--user", "--password", "--http-user", "--http-password", "--accept", "--reject", "--include-directories", "--exclude-directories", "--domains", "--exclude-domains", "--level", "--quota", "--limit-rate", "--bind-address", "--certificate", "--ca-certificate", "--load-cookies", "--save-cookies", "--proxy-user", "--proxy-password", "--read-timeout", "--connect-timeout", "--dns-timeout", "--cut-dirs", "--prefer-family", "--restrict-file-names", "--default-page", "--method", "--body-data", "--body-file"))
RSYNC_SHORT = "efBTM@"
RSYNC_LONG = frozenset(("--rsh", "--exclude", "--include", "--exclude-from", "--include-from", "--filter", "--port", "--bwlimit", "--log-file", "--partial-dir", "--backup-dir", "--suffix", "--temp-dir", "--compare-dest", "--copy-dest", "--link-dest", "--max-size", "--min-size", "--timeout", "--contimeout", "--chmod", "--chown", "--usermap", "--groupmap", "--out-format", "--info", "--debug", "--iconv", "--protocol", "--remote-option", "--read-batch", "--write-batch", "--only-write-batch", "--block-size", "--modify-window", "--address", "--sockopts", "--password-file", "--max-delete", "--stop-after", "--stop-at", "--skip-compress", "--checksum-choice", "--compress-choice", "--compress-level", "--rsync-path", "--log-file-format"))
RSYNC_REMOTE = re.compile(r"^(?:rsync://|[^/:]+:)")
TAR_ARGS = "fCTXIbHVNgLF"
TAR_LONG = frozenset(("--exclude", "--exclude-from", "--files-from", "--label", "--newer", "--newer-mtime", "--owner", "--group", "--mode", "--format", "--use-compress-program", "--blocking-factor", "--index-file", "--volno-file", "--suffix", "--exclude-tag", "--exclude-tag-all", "--exclude-tag-under", "--exclude-vcs-ignores", "--listed-incremental", "--occurrence", "--checkpoint-action", "--rsh-command", "--warning", "--wildcards-match-slash", "--level", "--one-top-level"))
AWK_NAMES = ("awk", "gawk", "mawk", "nawk")
AWK_PRINT = re.compile(r"\bprint(?:f)?\b")
AWK_REDIR = re.compile(r">(>?)[ \t]*\"([^\"\\]+)\"[ \t]*$")
ARCH_FILE = 67108864
ARCH_BYTES = 67108864
ARCH_MEMBERS = 2000
ARCH_READ = 65536
ARCH_READS = 32
ARCH_TARGETS = 8
WALK_FILES = 64
CODE_EXT = (".py", ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".go", ".java", ".kt", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".rb", ".php", ".swift", ".sh", ".css", ".html", ".vue", ".svelte")
SHELLS = ("bash", "sh", "zsh", "dash")
INTERP = re.compile(r"^(python[0-9.]*|node|nodejs|bun|deno|ruby)$")
OPS3 = ("<<<", "<<-", "&>>")
OPS2 = (">>", ">|", ">&", "<&", "&>", "&&", "||", ";;", "<<")
OPS1 = "><|;&()"
PLAIN = re.compile(r"[^ \t\n\\'\"$`<>&|;()#]+")
ASSIGN_NUM = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=.*[0-9)]$")
FALLBACK_REDIR = re.compile(r"(?<![-=<>&|])(?:&?>>?|>\|)[ \t]*([\"']?)([^\s\"'<>|&;()$`*?{}\\]+)\1")
FALLBACK_TEE = re.compile(r"\btee[ \t]+(?:-a[ \t]+)?([\"']?)([^\s\"'<>|&;()$`*?{}\\-][^\s\"'<>|&;()$`*?{}\\]*)\1")
CMD_CAP = 65536
CMD_STEPS = 2000
FOUND_CAP = 512
CODE_CAP = 65536
WRITE_WINDOW = 4096
LEX_DEPTH = 40
GIT = ["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"]
SEPS = (";", "&&", "||", "|", "&", ";;", "(", ")")
ESC = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", "'": "'", '"': '"', "a": "\a", "0": "\0"}
DQ = r'"(?:[^"\\\n]|\\.)*"'
SQ = r"'(?:[^'\\\n]|\\.)*'"
TDQ = r'"""[\s\S]*?"""'
TSQ = "'" * 3 + r"[\s\S]*?" + "'" * 3
STR = "(?:[rRbBuUfF]{0,2})(?:" + "|".join((TDQ, TSQ, DQ, SQ)) + ")"


def formslot_bin():
    forced = os.environ.get("FORMSLOT_BIN")
    if forced and os.path.isfile(forced):
        return forced
    return shutil.which("formslot") or shutil.which("formslot-cli")


def swap(value, source, target):
    if isinstance(value, str) and source and target:
        norm = os.path.normpath(value)
        for base in (os.path.normpath(source), os.path.realpath(source)):
            if norm == base or norm.startswith(base + os.sep):
                return os.path.normpath(target + norm[len(base):])
    return value


def remap(event):
    source = os.environ.get("SUBFORM_WORKTREE", "")
    target = os.environ.get("SUBFORM_REPO", "")
    if not source or not target:
        return event
    moved = json.loads(json.dumps(event))
    moved["cwd"] = swap(moved.get("cwd"), source, target)
    tool_input = moved.get("tool_input")
    if isinstance(tool_input, dict) and "file_path" in tool_input:
        tool_input["file_path"] = swap(tool_input["file_path"], source, target)
    return moved


def engine_base():
    base = os.environ.get("SUBFORM_ENGINE", "")
    if base:
        return base
    data = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        with open(os.path.join(data, "engine.port"), encoding="utf-8") as handle:
            return "http://127.0.0.1:%d" % int(json.load(handle)["port"])
    except (OSError, ValueError, KeyError, TypeError):
        return ""


def call(method, url, body=None, timeout=10):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", "X-Subform-Session": os.environ.get("SUBFORM_GATE_TOKEN", "")})
    with OPENER.open(request, timeout=timeout) as reply:
        return json.loads(reply.read().decode("utf-8"))


def here():
    return os.path.dirname(os.path.abspath(__file__))


def trail(text):
    line = "%s %s %s" % (time.strftime("%Y-%m-%dT%H:%M:%S"), os.environ.get("SUBFORM_SESSION", "-"), " ".join(text.split())[:600])
    try:
        target = os.path.join(here(), "sf_gate.log")
        if os.path.exists(target) and os.path.getsize(target) > 1048576:
            os.replace(target, target + ".1")
        with open(target, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass
    try:
        sys.stderr.write("subform gate: " + line + "\n")
    except OSError:
        pass


def skipped(why, shown, tool_name):
    trail("gate skipped for %s %s: %s" % (tool_name, shown, why))
    base = engine_base()
    session = os.environ.get("SUBFORM_SESSION", "")
    if not base or not session or not shown:
        return
    root = os.path.normpath(os.environ.get("SUBFORM_WORKTREE", ""))
    rel = os.path.relpath(shown, root) if root != "." and os.path.normpath(shown).startswith(root + os.sep) else shown
    try:
        call("POST", base + "/api/gates/notes", {"session": session, "tool": tool_name, "path": rel, "slot": ("unchecked, gate skipped: " + why)[:190], "message": ("subform could not ask for this write: " + why)[:3000]}, timeout=2)
    except (OSError, ValueError, urllib.error.URLError):
        pass


def seen_path():
    session = re.sub(r"[^A-Za-z0-9_-]", "-", os.environ.get("SUBFORM_SESSION", ""))[:80]
    return os.path.join(here(), "gate-seen", session + ".json") if session else ""


def seen_has(key):
    target = seen_path()
    if not target:
        return False
    try:
        with open(target, encoding="utf-8") as handle:
            return key in json.load(handle)
    except (OSError, ValueError, TypeError):
        return False


def seen_add(key):
    target = seen_path()
    if not target:
        return
    try:
        with open(target, encoding="utf-8") as handle:
            kept = [k for k in json.load(handle) if isinstance(k, str)]
    except (OSError, ValueError, TypeError):
        kept = []
    if key in kept:
        return
    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as handle:
            json.dump((kept + [key])[-200:], handle)
    except OSError:
        pass


def estimate(binary, slots):
    if not slots:
        return 0
    first = slots[0]
    try:
        done = subprocess.run([binary, "slot", "get", first["id"], "--json"], capture_output=True, text=True, timeout=3)
        manifest = json.loads(done.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0
    files = [f for f in manifest.get("files", []) if isinstance(f, dict)]
    chosen = [f for f in files if f.get("path") == first["path"]] or files[:1]
    lines = sum(int(f.get("lines") or 0) for f in chosen)
    return int(math.ceil(lines * LINE_TOKENS))


def emit(payload):
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def context_only(text, name="PreToolUse"):
    emit({"hookSpecificOutput": {"hookEventName": name, "additionalContext": text}})


def denial(reason):
    emit({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}})


def reason_for(choice, slot):
    where = "%s:%s" % (slot["path"], slot["line"])
    if choice == "use":
        return "The owner chose to reuse the existing slot %s, which lives at %s. Do not write this file. Read that code and import or extend it where the work belongs." % (slot["id"], where)
    return "The owner chose to adapt the existing slot %s at %s. Do not write a parallel copy. Start from that code and change only what this task needs." % (slot["id"], where)


def run_check(binary, payload, limit=10, keep=False):
    sent = payload if keep else dict(payload, session_id="")
    done = subprocess.run([binary, "check", "--mode", "warn"], input=json.dumps(remap(sent)), capture_output=True, text=True, timeout=limit)
    if done.returncode != 0 and not done.stdout.strip():
        raise subprocess.CalledProcessError(done.returncode, "formslot check", stderr=(done.stderr or "")[:300])
    return done.stdout.strip()


def spec_of(text):
    answer = json.loads(text)
    spec = answer.get("hookSpecificOutput") if isinstance(answer, dict) else None
    return spec if isinstance(spec, dict) else {}


def from_raw(text):
    spec = spec_of(text)
    if spec.get("permissionDecision"):
        return ("deny", str(spec.get("permissionDecisionReason") or "formslot declined this write"))
    context = spec.get("additionalContext")
    if isinstance(context, str) and context:
        return ("context", context)
    return None


def judge(binary, payload, tool_name, shown, deadline):
    try:
        text = run_check(binary, payload)
    except subprocess.TimeoutExpired:
        skipped("formslot check did not finish in 10 s", shown, tool_name)
        return None
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        skipped("formslot check failed: %s %s" % (type(exc).__name__, str(getattr(exc, "stderr", "") or exc).strip()), shown, tool_name)
        return None
    if not text:
        return None
    spec = spec_of(text)
    context = spec.get("additionalContext")
    if spec.get("permissionDecision") or not isinstance(context, str) or not context:
        return ("raw", text)
    slots = [{"id": m.group(1), "path": m.group(2), "line": int(m.group(3))} for m in SLOT_RE.finditer(context)]
    slots += [{"id": m.group(1), "path": m.group(2), "line": int(m.group(3))} for m in UNIT_RE.finditer(context)]
    base = engine_base()
    session = os.environ.get("SUBFORM_SESSION", "")
    if not slots:
        return ("raw", text)
    if not base or not session:
        skipped("no engine address or session in the hook environment", shown, tool_name)
        return ("raw", text)
    key = "%s|%s" % (shown, slots[0]["id"])
    if seen_has(key):
        return None
    try:
        wait = max(1, min(WAIT_MAX, int(os.environ.get("SUBFORM_GATE_TIMEOUT", WAIT_DEFAULT))))
    except ValueError:
        wait = WAIT_DEFAULT
    wait = min(wait, int(deadline - time.monotonic()))
    if wait < 1:
        skipped("no time left to wait for the owner", shown, tool_name)
        return ("context", context)
    try:
        gate = call("POST", base + "/api/gates", {"session": session, "tool": tool_name, "path": shown, "message": context[:4000], "slots": slots[:10], "tokens": estimate(binary, slots)})
        result = call("GET", "%s/api/gates/%s/wait?timeout=%d" % (base, gate["id"], wait), timeout=wait + 15)
    except (OSError, ValueError, KeyError, urllib.error.URLError) as exc:
        skipped("the engine did not answer the gate: %s" % (exc,), shown, tool_name)
        return ("context", context)
    choice = result.get("choice")
    if choice in ("use", "adapt"):
        return ("deny", reason_for(choice, slots[0]))
    if choice != "write":
        skipped("the gate closed as %s with no answer from the owner" % (choice,), shown, tool_name)
        return ("context", context)
    seen_add(key)
    return None


def single(event, binary):
    tool_input = event.get("tool_input") if isinstance(event.get("tool_input"), dict) else {}
    outcome = judge(binary, event, event.get("tool_name") or "Write", tool_input.get("file_path") or "", time.monotonic() + WAIT_MAX + 5)
    if outcome is None:
        return
    if outcome[0] == "raw":
        sys.stdout.write(outcome[1])
    elif outcome[0] == "deny":
        denial(outcome[1])
    else:
        context_only(outcome[1])


def unesc(text):
    return re.sub(r"\\(.)", lambda m: ESC.get(m.group(1), m.group(0)), text, flags=re.S)


def heredoc_bodies(text, i, pend, out):
    n = len(text)
    closed = True
    for index, delim in pend:
        strip = out[index - 1][1] == "<<-"
        lines = []
        found = False
        while i < n:
            j = text.find("\n", i)
            end = n if j < 0 else j
            line = text[i:end]
            i = end + 1
            probe = line.lstrip("\t") if strip else line
            if probe == delim:
                found = True
                break
            lines.append(probe if strip else line)
        closed = closed and found
        out[index] = ("heredoc", "".join(item + "\n" for item in lines), False)
    return min(i, n) if closed else -1


def skip_dq(text, j, level, budget):
    n = len(text)
    if level > LEX_DEPTH:
        return -1
    while j < n:
        budget[0] -= 1
        if budget[0] < 0:
            return -1
        c = text[j]
        if c == "\\":
            j += 2
        elif c == '"':
            return j + 1
        elif c == "$" and text[j + 1 : j + 2] == "(":
            k = skip_paren(text, j + 1, level + 1, budget)
            if k < 0:
                return -1
            j = k + 1
        else:
            j += 1
    return -1


def skip_paren(text, j, level, budget):
    n = len(text)
    if level > LEX_DEPTH:
        return -1
    depth = 0
    while j < n:
        budget[0] -= 1
        if budget[0] < 0:
            return -1
        c = text[j]
        if c == "\\":
            j += 2
            continue
        if c == "'":
            k = text.find("'", j + 1)
            if k < 0:
                return -1
            budget[0] -= k - j
            j = k + 1
            continue
        if c == '"':
            j = skip_dq(text, j + 1, level + 1, budget)
            if j < 0:
                return -1
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return -1


def op_at(text, i):
    if text[i : i + 3] in OPS3:
        return text[i : i + 3]
    if text[i : i + 2] in OPS2:
        return text[i : i + 2]
    return text[i] if text[i] in OPS1 else None


def heredoc_ok(text, i, op, word):
    k = i + len(op)
    n = len(text)
    while k < n and text[k] in " \t":
        k += 1
    if k >= n:
        return False
    ch = text[k]
    if not (ch.isalpha() or ch in "_'\"\\"):
        return False
    return not (word and ASSIGN_NUM.match("".join(word)))


def lex(text):
    out = []
    pend = []
    state = {"word": None, "dyn": False, "delim": False}
    n = len(text)
    i = 0
    budget = [12 * n + 1000]

    def add(chunk):
        if state["word"] is None:
            state["word"] = []
        state["word"].append(chunk)

    def put():
        if state["word"] is None:
            return
        word = "".join(state["word"])
        if state["delim"]:
            state["delim"] = False
            pend.append((len(out), word))
        out.append(("word", word, state["dyn"]))
        state["word"] = None
        state["dyn"] = False

    while i < n:
        c = text[i]
        nxt = text[i + 1 : i + 2]
        plain = PLAIN.match(text, i)
        if plain:
            add(plain.group())
            i = plain.end()
        elif c in " \t":
            put()
            i += 1
        elif c == "\n":
            put()
            i += 1
            if pend:
                i = heredoc_bodies(text, i, pend, out)
                pend.clear()
                if i < 0:
                    return None
            out.append(("op", ";", None))
        elif c == "\\":
            if nxt == "\n":
                i += 2
            elif nxt:
                add(nxt)
                i += 2
            else:
                add(c)
                i += 1
        elif c == "'":
            j = text.find("'", i + 1)
            if j < 0:
                return None
            add(text[i + 1 : j])
            i = j + 1
        elif c == '"':
            j = i + 1
            buf = []
            while j < n and text[j] != '"':
                if text[j] == "\\" and j + 1 < n and text[j + 1] in '"\\$`\n':
                    if text[j + 1] != "\n":
                        buf.append(text[j + 1])
                    j += 2
                    continue
                if text[j] in "$`":
                    state["dyn"] = True
                buf.append(text[j])
                j += 1
            if j >= n:
                return None
            add("".join(buf))
            i = j + 1
        elif c == "$" and nxt == "'":
            j = i + 2
            buf = []
            while j < n and text[j] != "'":
                if text[j] == "\\" and j + 1 < n:
                    buf.append(ESC.get(text[j + 1], text[j + 1]))
                    j += 2
                else:
                    buf.append(text[j])
                    j += 1
            if j >= n:
                return None
            add("".join(buf))
            i = j + 1
        elif c == "$" and nxt == "(":
            j = skip_paren(text, i + 1, 0, budget)
            if j < 0:
                return None
            add(text[i : j + 1])
            state["dyn"] = True
            i = j + 1
        elif c == "$":
            state["dyn"] = True
            add(c)
            i += 1
        elif c == "`":
            j = text.find("`", i + 1)
            if j < 0:
                return None
            add(text[i : j + 1])
            state["dyn"] = True
            i = j + 1
        elif c == "#" and state["word"] is None:
            j = text.find("\n", i)
            i = n if j < 0 else j
        else:
            op = op_at(text, i)
            if op is None:
                add(c)
                i += 1
                continue
            if op == "(" and nxt == "(" and state["word"] is None and (not out or out[-1][0] == "op"):
                k = skip_paren(text, i, 0, budget)
                inner = text[i:k] if k > 0 else ""
                if k > i + 3 and text[k - 1] == ")" and not any(ch in inner for ch in ";|\n"):
                    out.append(("word", text[i : k + 1], True))
                    i = k + 1
                    continue
            if op in ("<<", "<<-") and not heredoc_ok(text, i, op, state["word"]):
                add(op)
                i += len(op)
                continue
            fd = None
            if op[0] in "<>" and state["word"] is not None and not state["dyn"] and "".join(state["word"]).isdigit():
                fd = "".join(state["word"])
                state["word"] = None
            put()
            out.append(("op", op, fd))
            i += len(op)
            if op in ("<<", "<<-"):
                state["delim"] = True
    put()
    if pend and heredoc_bodies(text, n, pend, out) < 0:
        return None
    return out


def commands(tokens):
    found = []
    cur = {"words": [], "redir": [], "docs": [], "here": [], "stdin": None, "sep": None}

    def used():
        return cur["words"] or cur["redir"] or cur["docs"] or cur["here"] or cur["stdin"]

    i = 0
    while i < len(tokens):
        kind, val, extra = tokens[i]
        if kind == "op" and val in SEPS:
            if used():
                cur["sep"] = val
                found.append(cur)
            cur = {"words": [], "redir": [], "docs": [], "here": [], "stdin": None, "sep": None}
        elif kind == "op":
            target = tokens[i + 1] if i + 1 < len(tokens) and tokens[i + 1][0] in ("word", "heredoc") else None
            if target is not None:
                i += 1
                if val in ("<<", "<<-"):
                    cur["docs"].append(target[1])
                elif val == "<<<":
                    cur["here"].append(target[1] + "\n")
                elif val in (">", ">>", ">|", "&>", "&>>"):
                    cur["redir"].append((val, extra, target))
                elif val == ">&" and not (target[1].isdigit() or target[1] == "-"):
                    cur["redir"].append((">", extra, target))
                elif val == "<":
                    cur["stdin"] = target
        else:
            cur["words"].append((val, extra))
        i += 1
    if used():
        found.append(cur)
    return found


def resolve(word, dyn, cwd):
    if dyn or not word or any(ch in word for ch in "*?[{"):
        return None
    path = os.path.expanduser(word) if word.startswith("~") else word
    if not os.path.isabs(path):
        if cwd is None:
            return None
        path = os.path.join(cwd, path)
    return os.path.normpath(path)


def read_text(path, limit=READ_MAX):
    try:
        if os.path.getsize(path) > limit:
            return None
        with open(path, "rb") as handle:
            raw = handle.read()
    except OSError:
        return None
    if b"\0" in raw[:4096]:
        return None
    return raw.decode("utf-8", "replace")


def out_text(name, words, stdin, ctx):
    rest = words[1:]
    if any(d for _, d in rest):
        return None
    vals = [w for w, _ in rest]
    if name == "echo":
        newline = True
        interpret = False
        while vals and re.fullmatch(r"-[neE]+", vals[0]):
            flag = vals.pop(0)
            newline = newline and "n" not in flag
            interpret = interpret or "e" in flag
        text = " ".join(vals)
        return (unesc(text) if interpret else text) + ("\n" if newline else "")
    if name == "printf":
        if not vals:
            return None
        fmt = vals[0]
        args = vals[1:]
        count = sum(1 for s in re.findall(r"%[%sdb]", fmt) if s != "%%")
        if count == 0 and not args:
            return unesc(fmt.replace("%%", "%"))
        if count and count == len(args):
            it = iter(args)
            return unesc(re.sub(r"%[%sdb]", lambda m: "%" if m.group(0) == "%%" else next(it), fmt))
        return None
    if name == "cat":
        files = [w for w in vals if w != "-" and not w.startswith("-")]
        if not files:
            return stdin
        parts = []
        for item in files:
            path = resolve(item, False, ctx["cwd"])
            text = ctx["known"].get(path) if path else None
            if text is None and path:
                text = read_text(path)
            if text is None:
                return None
            parts.append(text)
        return "".join(parts)
    return None


def add_write(ctx, path, append, text):
    if append:
        ctx["found"].append({"path": path, "tool": "Edit", "old": "", "new": text or ""})
        if text is not None:
            ctx["known"][path] = (ctx["known"].get(path) or "") + text
    else:
        ctx["found"].append({"path": path, "tool": "Write", "content": text})
        if text is not None:
            ctx["known"][path] = text


def lit(raw):
    try:
        value = ast.literal_eval(raw)
    except (ValueError, SyntaxError, MemoryError, RecursionError):
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value if isinstance(value, str) else None


def code_writes(code, ctx):
    cwd = ctx["cwd"]
    code = code[:CODE_CAP]
    for m in re.finditer(r"open\(\s*(" + STR + r")\s*,\s*(?:mode\s*=\s*)?(" + STR + r")", code):
        path = lit(m.group(1))
        mode = lit(m.group(2))
        if not path or not mode or not re.search(r"[wax]", mode):
            continue
        if len(ctx["found"]) > FOUND_CAP:
            return
        limit = m.end() + WRITE_WINDOW
        following = code.find("open(", m.end(), limit)
        if following >= 0:
            limit = following
        parts = [lit(x) for x in re.findall(r"\.write\(\s*(" + STR + r")", code[m.end() : limit])]
        text = "".join(parts) if parts and all(p is not None for p in parts) else None
        target = resolve(path, False, cwd)
        if target:
            add_write(ctx, target, "a" in mode, text)
    for m in re.finditer(r"Path\(\s*(" + STR + r")\s*\)\s*\.\s*write_(?:text|bytes)\(\s*(" + STR + r")?", code):
        path = lit(m.group(1))
        target = resolve(path, False, cwd) if path else None
        if target:
            add_write(ctx, target, False, lit(m.group(2)) if m.group(2) else None)
    for m in re.finditer(r"\b(writeFileSync|writeFile|appendFileSync|appendFile)\(\s*(" + STR + r")\s*(?:,\s*(" + STR + r"))?", code):
        path = lit(m.group(2))
        target = resolve(path, False, cwd) if path else None
        if target:
            add_write(ctx, target, m.group(1).startswith("append"), lit(m.group(3)) if m.group(3) else None)
    for m in re.finditer(r"File\.write\(\s*(" + STR + r")\s*,\s*(" + STR + r")", code):
        path = lit(m.group(1))
        target = resolve(path, False, cwd) if path else None
        if target:
            add_write(ctx, target, False, lit(m.group(2)))


def subst(script):
    m = re.search(r"(?:^|[;{\s])s([^\w\s\\])", script)
    if not m:
        return None
    delim = m.group(1)
    parts = []
    cur = []
    k = m.end()
    while k < len(script) and len(parts) < 2:
        ch = script[k]
        if ch == "\\" and k + 1 < len(script):
            cur.append(delim if script[k + 1] == delim else ch + script[k + 1])
            k += 2
            continue
        if ch == delim:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        k += 1
    return (parts[0], parts[1]) if len(parts) == 2 else None


def sed_targets(words, ctx):
    vals = [w for w, _ in words[1:]]
    inplace = False
    scripts = []
    files = []
    k = 0
    while k < len(vals):
        v = vals[k]
        if v == "--in-place" or v.startswith("--in-place="):
            inplace = True
        elif v in ("-e", "--expression") and k + 1 < len(vals):
            scripts.append(vals[k + 1])
            k += 1
        elif v.startswith("--expression="):
            scripts.append(v.split("=", 1)[1])
        elif v in ("-f", "--file"):
            k += 1
        elif v.startswith("--"):
            pass
        elif v.startswith("-") and len(v) > 1:
            cluster = v[1:]
            if "i" in cluster:
                inplace = True
            elif cluster.endswith("e") and k + 1 < len(vals):
                scripts.append(vals[k + 1])
                k += 1
        else:
            files.append(words[k + 1])
        k += 1
    if not inplace:
        return
    if not scripts and files:
        scripts.append(files.pop(0)[0])
    pair = None
    for script in scripts:
        pair = subst(script)
        if pair:
            break
    for v, d in files:
        path = resolve(v, d, ctx["cwd"])
        if path:
            ctx["found"].append({"path": path, "tool": "Edit", "old": pair[0] if pair else "", "new": pair[1] if pair else ""})


def header(raw):
    value = raw.split("\t")[0].strip()
    if len(value) > 1 and value[0] == '"' and value[-1] == '"':
        value = value[1:-1]
    return value


def cut(path, strip):
    if path == "/dev/null":
        return None
    parts = path.split("/")
    return "/".join(parts[strip:]) if len(parts) > strip else None


def diff_targets(text, strip):
    found = []
    lines = text.split("\n")
    cur = None
    k = 0
    while k < len(lines):
        line = lines[k]
        if line.startswith("--- ") and k + 1 < len(lines) and lines[k + 1].startswith("+++ "):
            cur = {"old": header(line[4:]), "new": header(lines[k + 1][4:]), "add": [], "del": []}
            found.append(cur)
            k += 2
            continue
        if cur is not None:
            if line.startswith("diff "):
                cur = None
            elif line.startswith("+"):
                cur["add"].append(line[1:])
            elif line.startswith("-"):
                cur["del"].append(line[1:])
        k += 1
    out = []
    for item in found:
        fresh = item["old"] == "/dev/null"
        name = cut(item["new"], strip) or None
        if name is None:
            continue
        out.append({"rel": name, "fresh": fresh, "add": "\n".join(item["add"]) + ("\n" if item["add"] else ""), "del": "\n".join(item["del"]) + ("\n" if item["del"] else "")})
    return out


def patch_writes(name, words, stdin, ctx):
    vals = [w for w, _ in words[1:]]
    if name == "patch" and any(v in ("--dry-run", "--check", "-C") for v in vals):
        return
    if name == "git" and (any(v in ("--check", "--stat", "--numstat", "--summary") for v in vals) or ("--cached" in vals and "--index" not in vals)):
        return
    strip = 1 if name == "git" else 0
    base = ctx["root"] if name == "git" else ctx["cwd"]
    files = []
    k = 0
    if name == "git":
        while k < len(vals) and vals[k] != "apply":
            k += 2 if vals[k] in ("-C", "-c") else 1
        k += 1
    pending_input = None
    while k < len(vals):
        v = vals[k]
        m = re.fullmatch(r"-p(\d*)", v)
        if m:
            if m.group(1):
                strip = int(m.group(1))
            elif k + 1 < len(vals) and vals[k + 1].isdigit():
                strip = int(vals[k + 1])
                k += 1
        elif v in ("-i", "--input") and k + 1 < len(vals):
            pending_input = vals[k + 1]
            k += 1
        elif v.startswith("--input="):
            pending_input = v.split("=", 1)[1]
        elif v in ("-d", "--directory", "-C") and k + 1 < len(vals):
            k += 1
        elif v.startswith("-") and v != "-":
            pass
        else:
            files.append(v)
        k += 1
    text = stdin
    explicit = None
    if name == "patch":
        if pending_input:
            path = resolve(pending_input, False, ctx["cwd"])
            text = read_text(path) if path else None
        if files:
            explicit = files[0]
    else:
        names = [f for f in files if f != "-"]
        if names and stdin is None:
            path = resolve(names[0], False, ctx["root"])
            text = read_text(path) if path else None
    if not text and name == "patch" and explicit and "$" not in explicit and base is not None:
        path = resolve(explicit, False, base)
        if path:
            ctx["found"].append({"path": path, "tool": "Edit", "old": "", "new": ""})
        return
    if not text or base is None:
        return
    for item in diff_targets(text, strip):
        rel = explicit or item["rel"]
        path = resolve(rel, False, base)
        if not path:
            continue
        if item["fresh"] and not explicit:
            ctx["found"].append({"path": path, "tool": "Write", "content": item["add"]})
        else:
            ctx["found"].append({"path": path, "tool": "Edit", "old": item["del"], "new": item["add"]})


def copy_writes(name, words, ctx):
    rest = words[1:]
    pos = []
    target_dir = None
    j = 0
    while j < len(rest):
        v, d = rest[j]
        if v in ("-t", "--target-directory") and j + 1 < len(rest):
            target_dir = rest[j + 1]
            j += 1
        elif v.startswith("--target-directory="):
            target_dir = (v.split("=", 1)[1], d)
        elif v in ("-S", "-m", "-o", "-g", "--suffix", "--mode") and j + 1 < len(rest):
            j += 1
        elif v == "-d":
            return
        elif v.startswith("-") and len(v) > 1:
            pass
        else:
            pos.append((v, d))
        j += 1
    if target_dir is not None:
        dst, srcs = target_dir, pos
    elif len(pos) >= 2:
        dst, srcs = pos[-1], pos[:-1]
    else:
        return
    dpath = resolve(dst[0], dst[1], ctx["cwd"])
    if not dpath:
        return
    as_dir = target_dir is not None or len(srcs) > 1 or dst[0].endswith("/") or os.path.isdir(dpath)
    for sv, sd in srcs:
        spath = resolve(sv, sd, ctx["cwd"])
        if spath is None or os.path.isdir(spath):
            continue
        final = os.path.join(dpath, os.path.basename(spath)) if as_dir else dpath
        text = ctx["known"].get(spath)
        if text is None:
            text = read_text(spath)
        add_write(ctx, final, False, text)
        if name == "mv":
            ctx["known"].pop(spath, None)


class Capped:
    def __init__(self, raw, until):
        self.raw = raw
        self.until = until
        self.count = 0

    def read(self, size=65536):
        if size is None or size < 0:
            size = 65536
        if self.count > ARCH_BYTES or time.monotonic() > self.until:
            raise OSError("archive budget")
        data = self.raw.read(size)
        self.count += len(data)
        return data


def expand(word, dyn, ctx):
    if not dyn or "$" not in word:
        return word, dyn
    if "`" in word or "$(" in word or "$" in VAR_REF.sub("", word):
        return word, True
    miss = []

    def fill(m):
        value = ctx["vars"].get(m.group(1) or m.group(2))
        if value is None or any(ch in value for ch in " \t\n*?[{"):
            miss.append(1)
            return m.group(0)
        return value

    new = VAR_REF.sub(fill, word)
    if miss:
        return word, True
    return new, False


def set_var(ctx, item):
    name, _, value = item[0].partition("=")
    plus = name.endswith("+")
    name = name.rstrip("+")
    if plus or item[1] or (name not in ctx["vars"] and len(ctx["vars"]) >= VARS_CAP):
        ctx["vars"].pop(name, None)
    else:
        ctx["vars"][name] = value


def opt_arg(rest, j, attached):
    if attached:
        return (attached, rest[j][1]), j
    if j + 1 < len(rest):
        return rest[j + 1], j + 1
    return None, j


def source_text(ctx, path):
    text = ctx["known"].get(path)
    return text if text is not None else read_text(path)


def walk_files(root, ctx):
    count = 0
    for folder, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x != ".git")
        for name in sorted(files):
            if count >= WALK_FILES or time.monotonic() > ctx["until"]:
                return
            count += 1
            yield os.path.join(folder, name)


def url_name(url, wget):
    rest = re.sub(r"^[A-Za-z][A-Za-z0-9+.-]*://", "", url)
    cut = rest.find("/")
    rest = rest[cut + 1 :] if cut >= 0 else ""
    path, _, query = rest.split("#")[0].partition("?")
    last = path.rsplit("/", 1)[-1]
    if last in (".", ".."):
        return None
    if wget:
        return (last or "index.html") + ("?" + query if query else "")
    return last or None


def touch_writes(words, ctx):
    rest = words[1:]
    nocreate = any(v in ("-c", "--no-create") for v, _ in rest)
    plain = False
    j = 0
    while j < len(rest):
        v, d = rest[j]
        j += 1
        if not plain and v == "--":
            plain = True
        elif not plain and v.startswith("-") and v != "-":
            if v in ("-d", "-t", "-r", "--date", "--reference", "--time"):
                j += 1
        elif v != "-" and not nocreate:
            path = resolve(v, d, ctx["cwd"])
            if path and not os.path.exists(path):
                add_write(ctx, path, False, "")


def dd_writes(words, stdin, ctx):
    opts = {}
    for v, d in words[1:]:
        key, eq, val = v.partition("=")
        if eq:
            opts[key] = (val, d)
    if "of" not in opts or opts["of"][0].startswith("/dev/"):
        return
    path = resolve(opts["of"][0], opts["of"][1], ctx["cwd"])
    if not path:
        return
    flags = (opts.get("conv", ("", False))[0] + "," + opts.get("oflag", ("", False))[0]).split(",")
    partial = "notrunc" in flags or "append" in flags or "seek" in opts or "oseek" in opts
    text = None
    if all(k in ("if", "of", "bs", "ibs", "obs", "status") for k in opts):
        if "if" in opts:
            source = resolve(opts["if"][0], opts["if"][1], ctx["cwd"])
            text = source_text(ctx, source) if source and not source.startswith("/dev/") else None
        else:
            text = stdin
    add_write(ctx, path, partial, text)


def curl_writes(words, ctx):
    rest = words[1:]
    outs = []
    urls = []
    outdir = None
    remote_all = False
    plain = False
    j = 0
    while j < len(rest):
        v, d = rest[j]
        if plain or not v.startswith("-") or v == "-":
            if v != "-":
                urls.append((v, d))
        elif v == "--":
            plain = True
        elif v.startswith("--"):
            key, eq, val = v.partition("=")
            if key in ("--output", "--output-dir", "--url"):
                got, j = opt_arg(rest, j, val if eq else None)
                if got is not None:
                    if key == "--output":
                        outs.append(got)
                    elif key == "--url":
                        urls.append(got)
                    else:
                        outdir = got
            elif key == "--remote-name":
                outs.append(None)
            elif key == "--remote-name-all":
                remote_all = True
            elif key in CURL_LONG and not eq:
                j += 1
        else:
            cluster = v[1:]
            for k, ch in enumerate(cluster):
                if ch == "O":
                    outs.append(None)
                elif ch in CURL_SHORT:
                    tail = cluster[k + 1 :]
                    if ch == "o" and tail.startswith("="):
                        tail = tail[1:]
                    got, j = opt_arg(rest, j, tail)
                    if ch == "o" and got is not None:
                        outs.append(got)
                    break
        j += 1
    base = resolve(outdir[0], outdir[1], ctx["cwd"]) if outdir else ctx["cwd"]
    for i in range(max(len(outs), len(urls) if remote_all else 0)):
        spec = outs[i] if i < len(outs) else None
        if spec is not None:
            if spec[0] == "-" or spec[0].startswith("/dev/"):
                continue
            path = resolve(spec[0], spec[1], base)
        else:
            if i >= len(urls) or urls[i][1] or base is None:
                continue
            name = url_name(urls[i][0], False)
            path = os.path.join(base, name) if name else None
        if path:
            add_write(ctx, path, False, None)


def wget_writes(words, ctx):
    rest = words[1:]
    doc = None
    prefix = None
    urls = []
    plain = False
    j = 0
    while j < len(rest):
        v, d = rest[j]
        if plain or not v.startswith("-") or v == "-":
            if v != "-":
                urls.append((v, d))
        elif v == "--":
            plain = True
        elif v == "--spider":
            return
        elif v.startswith("--"):
            key, eq, val = v.partition("=")
            if key in ("--output-document", "--directory-prefix"):
                got, j = opt_arg(rest, j, val if eq else None)
                if got is not None:
                    if key == "--output-document":
                        doc = got
                    else:
                        prefix = got
            elif key in WGET_LONG and not eq:
                j += 1
        else:
            cluster = v[1:]
            for k, ch in enumerate(cluster):
                if ch in WGET_SHORT:
                    got, j = opt_arg(rest, j, cluster[k + 1 :])
                    if got is not None and ch == "O":
                        doc = got
                    elif got is not None and ch == "P":
                        prefix = got
                    break
        j += 1
    if doc is not None:
        if doc[0] != "-":
            path = resolve(doc[0], doc[1], ctx["cwd"])
            if path:
                add_write(ctx, path, False, None)
        return
    base = resolve(prefix[0], prefix[1], ctx["cwd"]) if prefix else ctx["cwd"]
    if base is None:
        return
    for v, d in urls:
        name = None if d else url_name(v, True)
        if name:
            add_write(ctx, os.path.join(base, name), False, None)


def rsync_writes(words, ctx):
    rest = words[1:]
    pos = []
    recursive = False
    dry = False
    plain = False
    j = 0
    while j < len(rest):
        v, d = rest[j]
        if plain or not v.startswith("-") or v == "-":
            pos.append((v, d))
        elif v == "--":
            plain = True
        elif v.startswith("--"):
            key = v.split("=", 1)[0]
            if key in ("--recursive", "--archive"):
                recursive = True
            elif key == "--dry-run":
                dry = True
            elif key == "--files-from":
                return
            elif key in RSYNC_LONG and "=" not in v:
                j += 1
        else:
            cluster = v[1:]
            for k, ch in enumerate(cluster):
                if ch in "ra":
                    recursive = True
                elif ch == "n":
                    dry = True
                if ch in RSYNC_SHORT:
                    if k + 1 >= len(cluster):
                        j += 1
                    break
        j += 1
    if dry or len(pos) < 2 or RSYNC_REMOTE.match(pos[-1][0]):
        return
    dst = pos[-1]
    dpath = resolve(dst[0], dst[1], ctx["cwd"])
    if not dpath:
        return
    srcs = pos[:-1]
    as_dir = dst[0].endswith("/") or len(srcs) > 1 or os.path.isdir(dpath)
    for sv, sd in srcs:
        if RSYNC_REMOTE.match(sv):
            if not recursive and not sv.endswith("/"):
                leaf = sv.split(":", 1)[1].rstrip("/").rsplit("/", 1)[-1]
                if leaf:
                    add_write(ctx, os.path.join(dpath, leaf) if as_dir else dpath, False, None)
            continue
        spath = resolve(sv, sd, ctx["cwd"])
        if spath is None:
            continue
        if os.path.isdir(spath):
            if not recursive:
                continue
            base = dpath if sv.endswith("/") else os.path.join(dpath, os.path.basename(spath))
            for found in walk_files(spath, ctx):
                add_write(ctx, os.path.join(base, os.path.relpath(found, spath)), False, source_text(ctx, found))
        elif os.path.exists(spath) or spath in ctx["known"]:
            add_write(ctx, os.path.join(dpath, os.path.basename(spath)) if as_dir else dpath, False, source_text(ctx, spath))


def member_path(name, strip=0):
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if ".." in parts:
        return None
    parts = parts[strip:]
    return "/".join(parts) if parts else None


def member_text(raw):
    return None if b"\0" in raw[:4096] else raw.decode("utf-8", "replace")


def pick_members(found):
    found.sort(key=lambda item: not item[0].endswith(CODE_EXT))
    return found[:ARCH_TARGETS]


def zip_items(path, accept, ctx):
    import zipfile

    found = []
    try:
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist()[:ARCH_MEMBERS]:
                rel = None if info.is_dir() else accept(info.filename)
                if rel:
                    found.append((rel, info))
            chosen = pick_members(found)
            out = []
            for rel, info in chosen:
                text = None
                if info.file_size <= ARCH_READ and time.monotonic() < ctx["until"]:
                    text = member_text(archive.open(info).read(ARCH_READ + 1))
                out.append((rel, text))
            return out
    except Exception:
        return []


def tar_items(path, accept, ctx):
    import tarfile

    out = []
    reads = 0
    try:
        with open(path, "rb") as handle:
            head = handle.read(6)
            handle.seek(0)
            if head[:2] == b"\x1f\x8b":
                import gzip

                stream = gzip.GzipFile(fileobj=handle)
            elif head[:3] == b"BZh":
                import bz2

                stream = bz2.BZ2File(handle)
            elif head[:6] == b"\xfd7zXZ\x00":
                import lzma

                stream = lzma.LZMAFile(handle)
            else:
                stream = handle
            with tarfile.open(fileobj=Capped(stream, ctx["until"]), mode="r|") as archive:
                for seen, member in enumerate(archive):
                    if seen >= ARCH_MEMBERS:
                        break
                    rel = accept(member.name) if member.isreg() else None
                    if not rel:
                        continue
                    text = None
                    if member.size <= ARCH_READ and reads < ARCH_READS and rel.endswith(CODE_EXT):
                        reads += 1
                        text = member_text(archive.extractfile(member).read(ARCH_READ + 1))
                    out.append((rel, text))
    except Exception:
        pass
    return pick_members(out)


def unzip_writes(words, ctx):
    import fnmatch

    rest = words[1:]
    pos = []
    dest = None
    junk = False
    j = 0
    while j < len(rest):
        v, d = rest[j]
        if v == "-x":
            while j + 1 < len(rest) and not rest[j + 1][0].startswith("-"):
                j += 1
        elif v.startswith("-") and len(v) > 1:
            cluster = v[1:]
            for k, ch in enumerate(cluster):
                if ch in "plvtzcZ":
                    return
                if ch == "j":
                    junk = True
                elif ch in "dPX":
                    got, j = opt_arg(rest, j, cluster[k + 1 :])
                    if ch == "d" and got is not None:
                        dest = got
                    break
        else:
            pos.append((v, d))
        j += 1
    if not pos or pos[0][1]:
        return
    archive = resolve(pos[0][0], False, ctx["cwd"])
    if archive and not os.path.isfile(archive) and os.path.isfile(archive + ".zip"):
        archive += ".zip"
    base = resolve(dest[0], dest[1], ctx["cwd"]) if dest else ctx["cwd"]
    if not archive or base is None or not os.path.isfile(archive):
        return
    members = [v for v, _ in pos[1:]]

    def accept(name):
        if members and not any(fnmatch.fnmatchcase(name, m) for m in members):
            return None
        rel = member_path(name)
        return os.path.basename(rel) if rel and junk else rel

    if os.path.getsize(archive) > ARCH_FILE:
        return
    for rel, text in zip_items(archive, accept, ctx):
        add_write(ctx, os.path.join(base, rel), False, text)


def tar_writes(words, ctx):
    rest = words[1:]
    extract = False
    other = False
    skip = False
    archive = None
    dest = None
    strip = 0
    members = []
    plain = False
    j = 0

    def cluster_flags(cluster, dashed, j):
        nonlocal extract, other, skip, archive, dest
        for k, ch in enumerate(cluster):
            if ch == "x":
                extract = True
            elif ch in "ctrudA":
                other = True
            elif ch == "O":
                skip = True
            if ch in TAR_ARGS:
                attached = cluster[k + 1 :] if dashed else ""
                got, j = opt_arg(rest, j, attached)
                if ch == "f":
                    archive = got
                elif ch == "C":
                    dest = got
                if attached:
                    break
        return j

    while j < len(rest):
        v, d = rest[j]
        if plain or v == "-" or not (v.startswith("-") or (j == 0 and re.fullmatch(r"[A-Za-z]+", v))):
            members.append(v)
        elif v == "--":
            plain = True
        elif v.startswith("--"):
            key, eq, val = v.partition("=")
            if key in ("--extract", "--get"):
                extract = True
            elif key in ("--create", "--list", "--diff", "--compare", "--append", "--update", "--delete", "--catenate", "--concatenate"):
                other = True
            elif key in ("--to-stdout", "--transform", "--xform", "--to-command", "--absolute-names"):
                skip = True
            elif key in ("--file", "--directory", "--strip-components", "--strip"):
                got, j = opt_arg(rest, j, val if eq else None)
                if got is not None:
                    if key == "--file":
                        archive = got
                    elif key == "--directory":
                        dest = got
                    elif got[0].isdigit():
                        strip = int(got[0])
            elif key in TAR_LONG and not eq:
                j += 1
        else:
            j = cluster_flags(v[1:] if v.startswith("-") else v, v.startswith("-"), j)
        j += 1
    if not extract or other or skip or archive is None or archive[0] == "-" or archive[1]:
        return
    apath = resolve(archive[0], False, ctx["cwd"])
    base = resolve(dest[0], dest[1], ctx["cwd"]) if dest else ctx["cwd"]
    if not apath or base is None or not os.path.isfile(apath) or os.path.getsize(apath) > ARCH_FILE:
        return

    def accept(name):
        if members and not any(name == m or name.startswith(m.rstrip("/") + "/") for m in members):
            return None
        return member_path(name, strip)

    for rel, text in tar_items(apath, accept, ctx):
        add_write(ctx, os.path.join(base, rel), False, text)


def truncate_writes(words, ctx):
    rest = words[1:]
    size = None
    nocreate = False
    plain = False
    files = []
    j = 0
    while j < len(rest):
        v, d = rest[j]
        if plain or not v.startswith("-") or v == "-":
            files.append((v, d))
        elif v == "--":
            plain = True
        elif v in ("-s", "--size", "-r", "--reference"):
            if v in ("-s", "--size") and j + 1 < len(rest):
                size = rest[j + 1][0]
            j += 1
        elif v.startswith("--size="):
            size = v.split("=", 1)[1]
        elif v.startswith("-s") and not v.startswith("--"):
            size = v[2:]
        elif v in ("-c", "--no-create"):
            nocreate = True
        j += 1
    for v, d in files:
        path = resolve(v, d, ctx["cwd"])
        if path and not (nocreate and not os.path.exists(path)):
            add_write(ctx, path, False, "" if size in ("0", "=0") else None)


def awk_writes(words, ctx):
    rest = words[1:]
    programs = []
    have = False
    j = 0
    while j < len(rest):
        v, d = rest[j]
        if v == "-f" and j + 1 < len(rest):
            path = resolve(rest[j + 1][0], rest[j + 1][1], ctx["cwd"])
            text = read_text(path) if path else None
            if text:
                programs.append(text)
            have = True
            j += 1
        elif v in ("-e", "--source") and j + 1 < len(rest):
            if not rest[j + 1][1]:
                programs.append(rest[j + 1][0])
            have = True
            j += 1
        elif v in ("-F", "-v", "-W", "-i", "-E") and j + 1 < len(rest):
            j += 1
        elif v == "--":
            if not have and j + 1 < len(rest) and not rest[j + 1][1]:
                programs.append(rest[j + 1][0])
            break
        elif v.startswith("-") and len(v) > 1:
            pass
        else:
            if not have and not d:
                programs.append(v)
            break
        j += 1
    for program in programs:
        program = program[:CODE_CAP]
        for m in AWK_PRINT.finditer(program):
            if len(ctx["found"]) > FOUND_CAP:
                return
            segment = program[m.end() : m.end() + 512]
            end = len(segment)
            for stop in ";}\n":
                k = segment.find(stop)
                if 0 <= k < end:
                    end = k
            hit = AWK_REDIR.search(segment[:end])
            if hit:
                path = resolve(hit.group(2), False, ctx["cwd"])
                if path:
                    add_write(ctx, path, hit.group(1) == ">>", None)


def git_writes(words, ctx):
    rest = words[1:]
    cwd = ctx["cwd"]
    j = 0
    while j < len(rest):
        v = rest[j][0]
        if v == "-C" and j + 1 < len(rest):
            cwd = resolve(rest[j + 1][0], rest[j + 1][1], cwd)
            j += 2
        elif v in ("-c", "--git-dir", "--work-tree", "--namespace", "--exec-path") and j + 1 < len(rest):
            j += 2
        elif v.startswith("-"):
            j += 1
        else:
            break
    if j >= len(rest) or cwd is None:
        return
    sub = rest[j][0]
    args = rest[j + 1 :]
    specs = []
    if sub == "checkout":
        names = [a[0] for a in args]
        if "--" not in names or any(n in ("-p", "--patch", "-b", "-B", "--orphan") for n in names[: names.index("--")]):
            return
        specs = args[names.index("--") + 1 :]
    elif sub == "restore":
        staged = False
        worktree = False
        plain = False
        k = 0
        while k < len(args):
            v, d = args[k]
            k += 1
            if plain or not v.startswith("-"):
                specs.append((v, d))
            elif v == "--":
                plain = True
            elif v in ("--staged", "-S"):
                staged = True
            elif v in ("--worktree", "-W"):
                worktree = True
            elif v in ("-p", "--patch", "--pathspec-from-file"):
                return
            elif v in ("-s", "--source"):
                k += 1
        if staged and not worktree:
            return
    else:
        return
    for v, d in specs:
        path = None if v.startswith(":") else resolve(v, d, cwd)
        if path and not os.path.isdir(path):
            add_write(ctx, path, False, None)


def run_simple(cmd, ctx, pipe_in, depth):
    words = [expand(v, d, ctx) for v, d in cmd["words"]]
    redirs = [(op, fd, (tgt[0],) + expand(tgt[1], tgt[2], ctx)) for op, fd, tgt in cmd["redir"]]
    assigns = []
    while words:
        head = words[0][0]
        if ASSIGN.match(head):
            assigns.append(words.pop(0))
        elif head in WRAP_ARGS:
            words.pop(0)
            letters = WRAP_ARGS[head]
            while words and words[0][0].startswith("-"):
                flag = words.pop(0)[0]
                if len(flag) == 2 and flag[1] in letters and words:
                    words.pop(0)
        elif head in RESERVED:
            words.pop(0)
        else:
            break
    name = os.path.basename(words[0][0]) if words else ""
    vals = [w for w, _ in words[1:]]
    dyn = any(d for _, d in words[1:])
    if not words:
        for item in assigns:
            set_var(ctx, item)
    elif name in DECLARE:
        for item in words[1:]:
            if ASSIGN.match(item[0]):
                set_var(ctx, item)
    elif name in UNSET:
        for v in vals:
            if IDENT.match(v):
                ctx["vars"].pop(v, None)
    stdin = cmd["docs"][-1] if cmd["docs"] else cmd["here"][-1] if cmd["here"] else None
    if stdin is None and cmd["stdin"] is not None:
        source = (cmd["stdin"][0],) + expand(cmd["stdin"][1], cmd["stdin"][2], ctx)
        path = resolve(source[1], source[2], ctx["cwd"])
        stdin = read_text(path) if path else None
    if stdin is None:
        stdin = pipe_in
    if name in ("cd", "pushd"):
        if vals and not dyn and ctx["cwd"] is not None:
            ctx["cwd"] = resolve(vals[0], False, ctx["cwd"])
        else:
            ctx["cwd"] = None
        return None
    if name in SHELLS or name == "eval":
        code = None
        if name == "eval" and not dyn:
            code = " ".join(vals)
        else:
            for k, v in enumerate(vals[:-1]):
                if re.fullmatch(r"-[A-Za-z]*c[A-Za-z]*", v) and not words[k + 2][1]:
                    code = vals[k + 1]
                    break
            if code is None and name in SHELLS and stdin is not None and not [v for v in vals if not v.startswith("-")]:
                code = stdin
        if code is not None and depth < 3:
            walk(code, ctx, depth + 1)
        return None
    produced = out_text(name, words, stdin, ctx)
    stdout_taken = False
    for op, fd, tgt in redirs:
        to_out = fd in (None, "1")
        stdout_taken = stdout_taken or to_out
        path = resolve(tgt[1], tgt[2], ctx["cwd"])
        if path:
            add_write(ctx, path, op in (">>", "&>>"), produced if to_out else None)
    if name == "tee":
        append = any(v in ("-a", "--append") for v in vals)
        for v, d in words[1:]:
            if not v.startswith("-"):
                path = resolve(v, d, ctx["cwd"])
                if path:
                    add_write(ctx, path, append, stdin)
    elif name == "touch":
        touch_writes(words, ctx)
    elif name == "dd":
        dd_writes(words, stdin, ctx)
    elif name == "curl":
        curl_writes(words, ctx)
    elif name == "wget":
        wget_writes(words, ctx)
    elif name == "rsync":
        rsync_writes(words, ctx)
    elif name == "unzip":
        unzip_writes(words, ctx)
    elif name in ("tar", "gtar", "bsdtar"):
        tar_writes(words, ctx)
    elif name == "truncate":
        truncate_writes(words, ctx)
    elif name in AWK_NAMES:
        awk_writes(words, ctx)
    elif name == "git" and "apply" not in vals:
        git_writes(words, ctx)
    elif name in ("cp", "mv", "install"):
        copy_writes(name, words, ctx)
    elif name == "sed":
        sed_targets(words, ctx)
    elif INTERP.match(name):
        code = None
        for k, v in enumerate(vals[:-1]):
            if v in ("-c", "-e", "-p", "--eval", "--print") and not words[k + 2][1]:
                code = vals[k + 1]
                break
        if code is None:
            files = [v for v in vals if not v.startswith("-") or v == "-"]
            if stdin is not None and (not files or files == ["-"]):
                code = stdin
        if code:
            code_writes(code, ctx)
    elif name == "patch" or (name == "git" and "apply" in vals):
        patch_writes(name, words, stdin, ctx)
    return None if stdout_taken else produced


def fallback(text, ctx):
    for m in FALLBACK_REDIR.finditer(text):
        path = resolve(m.group(2), False, ctx["cwd"])
        if path:
            add_write(ctx, path, m.group(0).lstrip("&").startswith(">>"), None)
        if len(ctx["found"]) > FOUND_CAP:
            return
    for m in FALLBACK_TEE.finditer(text):
        path = resolve(m.group(2), False, ctx["cwd"])
        if path:
            add_write(ctx, path, "-a" in m.group(0).split(None, 2)[:2], None)


def walk(text, ctx, depth):
    if len(text) > CMD_CAP:
        return
    tokens = lex(text)
    if tokens is None:
        fallback(text, ctx)
        return
    carry = None
    for cmd in commands(tokens):
        ctx["steps"] += 1
        if ctx["steps"] > CMD_STEPS or len(ctx["found"]) > FOUND_CAP or time.monotonic() > ctx["until"]:
            return
        carry = run_simple(cmd, ctx, carry, depth)
        if cmd["sep"] != "|":
            carry = None


def work_root(event):
    root = os.environ.get("SUBFORM_WORKTREE", "")
    if root:
        return root
    cwd = event.get("cwd")
    return cwd if isinstance(cwd, str) else ""


def inside(path, root):
    for base in {os.path.normpath(root), os.path.realpath(root)}:
        if path == base or path.startswith(base + os.sep):
            rel = os.path.relpath(path, base)
            return rel.split(os.sep)[0] not in (".git", ".subform") and rel != "."
    return False


def bash_targets(command, event):
    root = work_root(event)
    if not root:
        return []
    cwd = event.get("cwd")
    ctx = {"root": os.path.normpath(root), "cwd": os.path.normpath(cwd) if isinstance(cwd, str) and cwd else os.path.normpath(root), "known": {}, "vars": {}, "found": [], "steps": 0, "until": time.monotonic() + 0.6}
    try:
        walk(command, ctx, 0)
    except (ValueError, IndexError, KeyError, TypeError, re.error, RecursionError):
        return []
    keep = []
    seen = set()
    for item in ctx["found"]:
        key = (item["path"], item["tool"])
        if key in seen or not inside(item["path"], root):
            continue
        seen.add(key)
        keep.append(item)
    return keep[:BASH_CAP]


def payload_for(event, item):
    if item["tool"] == "Edit":
        tool_input = {"file_path": item["path"], "old_string": item.get("old") or "", "new_string": item.get("new") or ""}
    else:
        tool_input = {"file_path": item["path"], "content": item.get("content") or ""}
    return {"hook_event_name": "PreToolUse", "tool_name": item["tool"], "tool_input": tool_input, "cwd": event.get("cwd"), "session_id": event.get("session_id")}


def worktree_state(root):
    try:
        done = subprocess.run(GIT + ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"], capture_output=True, text=True, encoding="utf-8", errors="surrogateescape", timeout=1.5)
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    entries = {}
    parts = done.stdout.split("\0")
    k = 0
    while k < len(parts):
        item = parts[k]
        k += 1
        if len(item) < 4:
            continue
        code, rel = item[:2], item[3:]
        if code[0] in "RC":
            k += 1
        if rel.split("/")[0] in (".git", ".subform"):
            continue
        try:
            info = os.lstat(os.path.join(root, rel))
        except OSError:
            continue
        if stat.S_ISREG(info.st_mode):
            entries[rel] = [info.st_mtime_ns, info.st_size, code]
    return entries


def snap_dir():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "bash-snap")


def snap_key(event):
    raw = str(event.get("tool_use_id") or "")
    if not raw:
        raw = "s-" + str(event.get("session_id") or "")
    key = re.sub(r"[^A-Za-z0-9_-]", "_", raw)[:120]
    return key if key and key != "s-" else None


def snapshot_save(event):
    key = snap_key(event)
    root = work_root(event)
    if not key or not root:
        return
    state = worktree_state(root)
    if state is None:
        return
    folder = snap_dir()
    os.makedirs(folder, mode=0o700, exist_ok=True)
    now = time.time()
    for name in os.listdir(folder):
        old = os.path.join(folder, name)
        try:
            if now - os.path.getmtime(old) > SNAP_KEEP:
                os.remove(old)
        except OSError:
            pass
    with open(os.path.join(folder, key + ".json"), "w", encoding="utf-8") as handle:
        json.dump({"files": state}, handle)


def pre_bash(event, binary):
    start = time.monotonic()
    try:
        snapshot_save(event)
    except (OSError, ValueError):
        pass
    tool_input = event.get("tool_input") if isinstance(event.get("tool_input"), dict) else {}
    command = tool_input.get("command")
    if not isinstance(command, str) or not command.strip():
        return
    items = bash_targets(command, event)
    root = work_root(event)
    contexts = []
    for item in items:
        rel = os.path.relpath(item["path"], os.path.normpath(root))
        outcome = judge(binary, payload_for(event, item), "Bash", item["path"], start + BASH_WAIT)
        if outcome is None:
            continue
        if outcome[0] == "raw":
            outcome = from_raw(outcome[1])
            if outcome is None:
                continue
        if outcome[0] == "deny":
            denial("This Bash command writes %s. %s" % (rel, outcome[1]))
            return
        contexts.append("Bash command writes %s. %s" % (rel, outcome[1]))
    if contexts:
        context_only("\n".join(contexts)[:4000])


def post_payload(root, rel, code, event):
    path = os.path.join(root, rel)
    tracked = code.strip() in ("M", "MM", "R", "RM") or code in (" M", "M ", "MM")
    if tracked:
        try:
            done = subprocess.run(GIT + ["-C", root, "diff", "--no-ext-diff", "--no-textconv", "HEAD", "-U0", "--no-color", "--", rel], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1)
        except (OSError, subprocess.SubprocessError):
            return None
        found = diff_targets(done.stdout, 1)
        if not found:
            return None
        tool_input = {"file_path": path, "old_string": found[0]["del"], "new_string": found[0]["add"]}
        tool = "Edit"
    else:
        text = read_text(path, POST_BYTES)
        if text is None:
            return None
        tool_input = {"file_path": path, "content": text}
        tool = "Write"
    return {"hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": tool_input, "cwd": event.get("cwd") or root, "session_id": event.get("session_id")}


def post_bash(event, binary):
    start = time.monotonic()
    key = snap_key(event)
    root = work_root(event)
    if not key or not root:
        return
    saved = os.path.join(snap_dir(), key + ".json")
    try:
        with open(saved, encoding="utf-8") as handle:
            before = json.load(handle)["files"]
        os.remove(saved)
    except (OSError, ValueError, KeyError, TypeError):
        return
    state = worktree_state(root)
    if state is None:
        return
    changed = sorted(rel for rel, value in state.items() if before.get(rel, [None, None])[:2] != value[:2])
    if not changed or len(changed) > POST_FILES:
        return
    lines = []
    found = []
    for rel in changed:
        left = POST_BUDGET + 0.3 - (time.monotonic() - start)
        if left < 0.3:
            break
        payload = post_payload(root, rel, state[rel][2], event)
        if payload is None:
            continue
        try:
            text = run_check(binary, payload, left, True)
            outcome = from_raw(text) if text else None
        except (subprocess.SubprocessError, ValueError):
            break
        if outcome is None:
            continue
        label = "declined feature: " if outcome[0] == "deny" else ""
        lines.append("- %s: %s%s" % (rel, label, outcome[1]))
        match = SLOT_RE.search(outcome[1])
        unit = UNIT_RE.search(outcome[1])
        found.append((rel, match.group(1) if match else unit.group(1) if unit else "", outcome[1]))
    if not lines:
        return
    base = engine_base()
    session = os.environ.get("SUBFORM_SESSION", "")
    for rel, slot, message in found:
        if not base or not session or time.monotonic() - start > POST_BUDGET + 0.3:
            break
        try:
            call("POST", base + "/api/gates/notes", {"session": session, "tool": "Bash", "path": rel, "slot": slot, "message": message[:4000]}, timeout=1)
        except (OSError, ValueError, urllib.error.URLError):
            break
    head = "formslot: files written by the Bash command overlap existing code or a declined feature. The write already happened and was not blocked; reuse or remove it, or say why a separate one is intended."
    context_only((head + "\n" + "\n".join(lines))[:4000], "PostToolUse")


def main():
    event = json.loads(sys.stdin.read())
    binary = formslot_bin()
    if not binary:
        trail("gate skipped: the formslot command was not found (FORMSLOT_BIN unset and not on PATH)")
        return
    name = event.get("hook_event_name")
    if event.get("tool_name") == "Bash":
        if name == "PostToolUse":
            post_bash(event, binary)
        else:
            pre_bash(event, binary)
        return
    if name == "PostToolUse":
        return
    single(event, binary)


try:
    main()
except Exception as exc:
    trail("gate skipped: hook error %s: %s" % (type(exc).__name__, exc))
sys.exit(0)
'''
