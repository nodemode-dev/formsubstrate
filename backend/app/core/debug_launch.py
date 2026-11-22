import json
import os
import re

from app.core import trust, workspace_root as ws

OWN = ".formsubstrate/launch.json"
VSCODE = ".vscode/launch.json"
FILE_MAX = 262144
CONFIGS_MAX = 64
NAME_MAX = 120
ARGS_MAX = 256
ARG_LEN_MAX = 4096
PATH_MAX = 4096
ENV_MAX = 128
ENV_VALUE_MAX = 8192
ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
VARIABLE = re.compile(r"\$\{([^}]*)\}")
KINDS = {"python": "python", "debugpy": "python", "node": "node", "pwa-node": "node"}
VARIABLES = ("workspaceFolder", "file", "fileBasenameNoExtension", "relativeFile")
FILE_VARIABLES = ("file", "fileBasenameNoExtension", "relativeFile")
READ = ("type", "request", "name", "program", "args", "cwd", "env", "justMyCode", "stopOnEntry")
QUIET = ("console", "presentation", "preLaunchTask", "postDebugTask", "internalConsoleOptions")
UNTRUSTED = "the workspace is not trusted, so its launch file was not read"
STARTER = {
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Python: current file",
            "type": "python",
            "request": "launch",
            "program": "${file}",
            "args": [],
            "cwd": "${workspaceFolder}",
            "env": {},
            "justMyCode": True,
            "stopOnEntry": False,
        },
        {
            "name": "Node.js: current file",
            "type": "node",
            "request": "launch",
            "program": "${file}",
            "args": [],
            "cwd": "${workspaceFolder}",
            "env": {},
            "stopOnEntry": False,
        },
    ],
}


def strip_comments(text: str) -> str:
    out: list[str] = []
    i = 0
    size = len(text)
    inside = False
    while i < size:
        ch = text[i]
        if inside:
            out.append(ch)
            if ch == "\\" and i + 1 < size:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                inside = False
            i += 1
            continue
        if ch == '"':
            inside = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and text[i + 1:i + 2] == "/":
            end = text.find("\n", i)
            i = size if end < 0 else end
            continue
        if ch == "/" and text[i + 1:i + 2] == "*":
            end = text.find("*/", i + 2)
            if end < 0:
                raise ws.Refused(400, "a comment in the launch file is not closed")
            out.append(" ")
            i = end + 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def strip_trailing_commas(text: str) -> str:
    out: list[str] = []
    i = 0
    size = len(text)
    inside = False
    while i < size:
        ch = text[i]
        if inside:
            out.append(ch)
            if ch == "\\" and i + 1 < size:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                inside = False
            i += 1
            continue
        if ch == '"':
            inside = True
        if ch == ",":
            j = i + 1
            while j < size and text[j] in " \t\r\n":
                j += 1
            if j < size and text[j] in "]}":
                i += 1
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def parse(text: str) -> object:
    try:
        return json.loads(strip_trailing_commas(strip_comments(text)))
    except ValueError as err:
        raise ws.Refused(400, f"the launch file is not valid JSON: {err}") from err


def locate() -> tuple[str, str] | None:
    for rel in (OWN, VSCODE):
        try:
            real, _ = ws.resolve(rel)
        except ws.Refused:
            continue
        if os.path.isfile(real):
            return rel, real
    return None


def read_file(real: str) -> list:
    try:
        if os.path.getsize(real) > FILE_MAX:
            raise ws.Refused(413, "the launch file is too large")
        with open(real, "r", encoding="utf-8-sig") as handle:
            text = handle.read(FILE_MAX + 1)
    except (OSError, UnicodeDecodeError) as err:
        raise ws.Refused(400, f"the launch file could not be read: {err}") from err
    data = parse(text)
    if not isinstance(data, dict):
        raise ws.Refused(400, "the launch file must be a JSON object")
    configs = data.get("configurations")
    if not isinstance(configs, list):
        raise ws.Refused(400, "the launch file needs a configurations list")
    if len(configs) > CONFIGS_MAX:
        raise ws.Refused(400, f"the launch file has more than {CONFIGS_MAX} configurations")
    return configs


def _text(value: object, name: str, limit: int) -> str:
    if not isinstance(value, str) or not value:
        raise ws.Refused(400, f"{name} must be text")
    if len(value) > limit or "\0" in value:
        raise ws.Refused(400, f"{name} is too long or has a null character")
    return value


def clean(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise ws.Refused(400, "a configuration must be a JSON object")
    name = _text(raw.get("name"), "name", NAME_MAX)
    kind_in = raw.get("type")
    if not isinstance(kind_in, str) or kind_in not in KINDS:
        raise ws.Refused(400, f"type {str(kind_in)[:40]!r} is not supported; Substrate runs python, debugpy, node and pwa-node")
    if raw.get("request") != "launch":
        raise ws.Refused(400, "only request launch is supported")
    if "program" not in raw:
        raise ws.Refused(400, "program is missing; module and other ways to start are not supported")
    program = _text(raw.get("program"), "program", PATH_MAX)
    args_in = raw.get("args", [])
    if not isinstance(args_in, list) or len(args_in) > ARGS_MAX:
        raise ws.Refused(400, "args must be a list of text values")
    args = [_text(item, "an argument", ARG_LEN_MAX) if item != "" else "" for item in args_in]
    cwd_in = raw.get("cwd")
    cwd = _text(cwd_in, "cwd", PATH_MAX) if cwd_in is not None else None
    env_in = raw.get("env", {})
    if not isinstance(env_in, dict) or len(env_in) > ENV_MAX:
        raise ws.Refused(400, "env must be an object of text values")
    env: dict[str, str] = {}
    for key, value in env_in.items():
        if not isinstance(key, str) or not ENV_NAME.match(key):
            raise ws.Refused(400, f"env name {str(key)[:40]!r} is not a variable name")
        if not isinstance(value, str) or len(value) > ENV_VALUE_MAX or "\0" in value:
            raise ws.Refused(400, f"env value of {key} must be text")
        env[key] = value
    for flag in ("justMyCode", "stopOnEntry"):
        if flag in raw and not isinstance(raw[flag], bool):
            raise ws.Refused(400, f"{flag} must be true or false")
    for text in (program, cwd or "", *args, *env.values()):
        for found in VARIABLE.findall(text):
            if found not in VARIABLES:
                raise ws.Refused(400, f"${{{found[:40]}}} is not supported; use workspaceFolder, file, fileBasenameNoExtension or relativeFile")
    return {
        "name": name,
        "type": kind_in,
        "kind": KINDS[kind_in],
        "program": program,
        "args": args,
        "cwd": cwd,
        "env": env,
        "justMyCode": raw.get("justMyCode") is not False,
        "stopOnEntry": raw.get("stopOnEntry") is True,
        "ignored": sorted(str(key)[:40] for key in raw if key not in READ and key not in QUIET)[:16],
    }


def summary(raw: object, index: int) -> dict:
    label = raw.get("name") if isinstance(raw, dict) and isinstance(raw.get("name"), str) else ""
    kind_in = raw.get("type") if isinstance(raw, dict) and isinstance(raw.get("type"), str) else ""
    try:
        conf = clean(raw)
    except ws.Refused as err:
        return {"index": index, "name": label[:NAME_MAX], "type": kind_in[:40], "kind": KINDS.get(kind_in), "runnable": False, "problem": err.detail, "program": "", "needsFile": False, "ignored": []}
    texts = (conf["program"], conf["cwd"] or "", *conf["args"], *conf["env"].values())
    needs = any(found in FILE_VARIABLES for text in texts for found in VARIABLE.findall(text))
    return {"index": index, "name": conf["name"], "type": conf["type"], "kind": conf["kind"], "runnable": True, "problem": "", "program": conf["program"], "needsFile": needs, "ignored": conf["ignored"]}


def listing(root: str | None) -> dict:
    base = {"root": root, "trusted": False, "source": None, "exists": False, "fallback": False, "configurations": [], "problem": ""}
    if root is None:
        return base
    found = locate()
    base["trusted"] = trust.is_trusted(root)
    if found is None:
        return base
    base["source"] = found[0]
    base["exists"] = True
    base["fallback"] = found[0] == VSCODE
    if not base["trusted"]:
        base["problem"] = UNTRUSTED
        return base
    try:
        configs = read_file(found[1])
    except ws.Refused as err:
        base["problem"] = err.detail
        return base
    base["configurations"] = [summary(raw, index) for index, raw in enumerate(configs)]
    return base


def _is_absolute(value: str) -> bool:
    flat = value.replace("\\", "/")
    return os.path.isabs(value) or flat.startswith("/") or (len(flat) > 1 and flat[1] == ":")


def _place(written: str, expanded: str, root: str, name: str) -> str:
    if _is_absolute(written):
        return os.path.realpath(expanded)
    real = os.path.realpath(expanded if _is_absolute(expanded) else os.path.join(root, expanded))
    if not ws._inside(real, root):
        raise ws.Refused(403, f"{name} leaves the workspace; write an absolute path to use a place outside it")
    return real


def resolve(root: str, index: object, name: object, file_rel: object) -> dict:
    if not trust.is_trusted(root):
        raise ws.Refused(403, UNTRUSTED)
    found = locate()
    if found is None:
        raise ws.Refused(404, "there is no launch file in this workspace")
    configs = read_file(found[1])
    if not isinstance(index, int) or isinstance(index, bool) or index < 0 or index >= len(configs):
        raise ws.Refused(404, "that configuration is not in the launch file any more")
    conf = clean(configs[index])
    if conf["name"] != name:
        raise ws.Refused(409, "the launch file changed; choose the configuration again")
    values = {"workspaceFolder": root}
    if isinstance(file_rel, str) and file_rel:
        real, rel = ws.resolve(file_rel)
        if os.path.isfile(real):
            values["file"] = real
            values["relativeFile"] = rel.replace("/", os.sep)
            values["fileBasenameNoExtension"] = os.path.splitext(os.path.basename(real))[0]

    def expand(text: str) -> str:
        def swap(match: re.Match) -> str:
            key = match.group(1)
            if key not in values:
                raise ws.Refused(400, f"${{{key}}} needs an open file in the editor")
            return values[key]

        return VARIABLE.sub(swap, text)

    program = _place(conf["program"], expand(conf["program"]), root, "program")
    if not os.path.isfile(program):
        raise ws.Refused(404, "the program file does not exist")
    cwd = _place(conf["cwd"], expand(conf["cwd"]), root, "cwd") if conf["cwd"] else root
    if not os.path.isdir(cwd):
        raise ws.Refused(404, "the working folder does not exist")
    return {
        "name": conf["name"],
        "kind": conf["kind"],
        "program": program,
        "args": [expand(item) for item in conf["args"]],
        "cwd": cwd,
        "env": {key: expand(value) for key, value in conf["env"].items()},
        "justMyCode": conf["justMyCode"],
        "stopOnEntry": conf["stopOnEntry"],
    }


def create() -> dict:
    found = locate()
    if found is not None and found[0] == OWN:
        raise ws.Refused(409, "the launch file already exists")
    real, rel = ws.resolve(OWN, write=True)
    if os.path.lexists(real):
        raise ws.Refused(409, "the launch file already exists")
    folder = os.path.dirname(real)
    try:
        os.makedirs(folder, exist_ok=True)
        with open(real, "x", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(STARTER, indent=2) + "\n")
    except OSError as err:
        raise ws.Refused(409, f"the launch file could not be written: {err}") from err
    return {"path": rel}
