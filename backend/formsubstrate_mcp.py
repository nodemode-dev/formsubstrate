import json
import os
import sys
import urllib.error
import urllib.request

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
DEFAULT_PORT = 5655
TIMEOUT = 60
NOT_RUNNING = "Substrate is not running: open Substrate, then try again"


def data_dir() -> str:
    raw = os.environ.get("FORMSUBSTRATE_DATA_DIR")
    if raw:
        return os.path.expanduser(raw)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from app.core import config

    return str(config.data_dir())


def engine_base() -> str:
    base = os.environ.get("FORMSUBSTRATE_ENGINE", "").strip().rstrip("/")
    if base:
        return base
    port = os.environ.get("FORMSUBSTRATE_PORT", "")
    if port.isdigit() and int(port) > 0:
        return f"http://127.0.0.1:{int(port)}"
    try:
        with open(os.path.join(data_dir(), "engine.port"), encoding="utf-8") as handle:
            found = int(json.load(handle).get("port") or 0)
    except (OSError, ValueError, AttributeError, TypeError):
        found = 0
    return f"http://127.0.0.1:{found or DEFAULT_PORT}"


def say(obj) -> None:
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def failure(ident, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": ident, "error": {"code": code, "message": message}}


def ids_of(parsed) -> list:
    items = parsed if isinstance(parsed, list) else [parsed]
    return [m.get("id") for m in items if isinstance(m, dict) and "method" in m and "id" in m]


def forward(base: str, token: str, line: str) -> None:
    try:
        parsed = json.loads(line)
    except ValueError:
        parsed = None
    wants = ids_of(parsed) if parsed is not None else [None]
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(base + "/mcp", data=line.encode("utf-8"), method="POST", headers=headers)
    try:
        with OPENER.open(request, timeout=TIMEOUT) as reply:
            body = reply.read().decode("utf-8")
            status = reply.status
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", "replace")
        try:
            say(json.loads(text))
            return
        except ValueError:
            for ident in wants:
                say(failure(ident, -32000, f"Substrate answered {err.code}"))
            return
    except (urllib.error.URLError, OSError):
        for ident in wants:
            say(failure(ident, -32000, NOT_RUNNING))
        return
    if status == 202 or not body.strip():
        return
    try:
        say(json.loads(body))
    except ValueError:
        for ident in wants:
            say(failure(ident, -32603, "Substrate sent an answer that is not JSON"))


def main() -> int:
    base = engine_base()
    token = os.environ.get("FORMSUBSTRATE_GATE_TOKEN", "").strip()
    print(f"formsubstrate mcp: forwarding to {base}", file=sys.stderr)
    for line in sys.stdin:
        line = line.strip()
        if line:
            forward(base, token, line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
