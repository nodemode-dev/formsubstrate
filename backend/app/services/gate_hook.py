SCRIPT = r'''import json
import math
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

WAIT_DEFAULT = 120
WAIT_MAX = 120
LINE_TOKENS = 10
SLOT_RE = re.compile(r"slot (\S+) \(\w+\) at (\S+?):(\d+)")
UNIT_RE = re.compile(r"unit (\S+) \((\S+?):(\d+)\)")


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
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as reply:
        return json.loads(reply.read().decode("utf-8"))


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


def context_only(text):
    emit({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": text}})


def denial(reason):
    emit({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}})


def reason_for(choice, slot):
    where = "%s:%s" % (slot["path"], slot["line"])
    if choice == "use":
        return "The owner chose to reuse the existing slot %s, which lives at %s. Do not write this file. Read that code and import or extend it where the work belongs." % (slot["id"], where)
    return "The owner chose to adapt the existing slot %s at %s. Do not write a parallel copy. Start from that code and change only what this task needs." % (slot["id"], where)


def main():
    event = json.loads(sys.stdin.read())
    binary = formslot_bin()
    if not binary:
        return
    done = subprocess.run([binary, "check", "--mode", "warn"], input=json.dumps(remap(event)), capture_output=True, text=True, timeout=10)
    text = done.stdout.strip()
    if not text:
        return
    answer = json.loads(text)
    spec = answer.get("hookSpecificOutput") if isinstance(answer, dict) else None
    spec = spec if isinstance(spec, dict) else {}
    context = spec.get("additionalContext")
    if spec.get("permissionDecision") or not isinstance(context, str) or not context:
        sys.stdout.write(text)
        return
    slots = [{"id": m.group(1), "path": m.group(2), "line": int(m.group(3))} for m in SLOT_RE.finditer(context)]
    slots += [{"id": m.group(1), "path": m.group(2), "line": int(m.group(3))} for m in UNIT_RE.finditer(context)]
    base = engine_base()
    session = os.environ.get("SUBFORM_SESSION", "")
    if not base or not session or not slots:
        sys.stdout.write(text)
        return
    tool_input = event.get("tool_input") if isinstance(event.get("tool_input"), dict) else {}
    try:
        wait = max(1, min(WAIT_MAX, int(os.environ.get("SUBFORM_GATE_TIMEOUT", WAIT_DEFAULT))))
    except ValueError:
        wait = WAIT_DEFAULT
    try:
        gate = call("POST", base + "/api/gates", {"session": session, "tool": event.get("tool_name") or "Write", "path": tool_input.get("file_path") or "", "message": context, "slots": slots, "tokens": estimate(binary, slots)})
        result = call("GET", "%s/api/gates/%s/wait?timeout=%d" % (base, gate["id"], wait), timeout=wait + 15)
    except (OSError, ValueError, KeyError, urllib.error.URLError):
        context_only(context)
        return
    choice = result.get("choice")
    if choice in ("use", "adapt"):
        denial(reason_for(choice, slots[0]))
    elif choice != "write":
        context_only(context)


try:
    main()
except Exception:
    pass
sys.exit(0)
'''
