import os
import sys

if sys.stdin is None:
    sys.stdin = open(os.devnull, encoding="utf-8")
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

import glob
import json
import logging
import threading
import time

PORT_NAME = "engine.port"


def resource_dir() -> str:
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def selfcheck() -> int:
    info = {"python": sys.version.split()[0]}
    for name in ("fastapi", "uvicorn", "httpx", "keyring"):
        try:
            module = __import__(name)
            info[name] = getattr(module, "__version__", "ok")
        except Exception as exc:
            info[name] = f"missing: {exc}"
    from app import __version__

    info["formsubstrate"] = __version__
    info["dist_bundled"] = os.path.isdir(os.path.join(resource_dir(), "frontend_dist"))
    templates = os.path.join(resource_dir(), "app", "templates")
    for part in ("common", "python", "rust"):
        if not os.path.isdir(os.path.join(templates, part)):
            info["templates"] = f"missing: {part}"
            print(json.dumps(info))
            return 1
    info["templates"] = "ok"
    base = resource_dir()
    groups = {
        "graph_presets": (os.path.join("presets", "graphs"), "*.json"),
        "graph_templates": (os.path.join("app", "templates", "graphs"), "*.json"),
        "recipe_presets": (os.path.join("app", "services", "recipes", "presets"), "*.json"),
        "bundled_plugins": (os.path.join("app", "services", "library", "bundled"), "*.py"),
        "skills": ("skills", os.path.join("*", "SKILL.md")),
    }
    for key, (folder, pattern) in groups.items():
        found = len(glob.glob(os.path.join(base, folder, pattern)))
        info[key] = found if found else f"missing: {folder}"
    try:
        import app.main
        import app.services.gate_hook
        import formsubstrate_mcp
        import formsubstrate_ptyhost

        info["app"] = "ok"
    except Exception as exc:
        info["app"] = f"failed: {exc!r}"
        print(json.dumps(info))
        return 1
    print(json.dumps(info))
    return 0 if all(not str(value).startswith("missing") for value in info.values()) else 1


def watch_parent(data) -> None:
    from app.core import runtime, startup

    shell = startup.shell_pid()
    if not shell and os.name == "posix":
        shell = os.getppid()
    if shell <= 1:
        return
    import shutil

    def leave() -> None:
        logging.getLogger("formsubstrate").info("the app that started this engine is gone (process %s), stopping", shell)
        runtime.release(data)
        unpacked = getattr(sys, "_MEIPASS", "")
        if os.name == "posix" and os.path.basename(unpacked).startswith("_MEI"):
            shutil.rmtree(unpacked, ignore_errors=True)
        os._exit(0)

    startup.watch(shell, leave)


def sweep_stale_unpacks() -> None:
    unpacked = getattr(sys, "_MEIPASS", "")
    if os.name != "posix" or not os.path.basename(unpacked).startswith("_MEI"):
        return
    import re
    import shutil

    def alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    def run() -> None:
        root, own = os.path.dirname(unpacked), os.path.basename(unpacked)
        try:
            names = os.listdir(root)
        except OSError:
            return
        for name in names:
            m = re.fullmatch(r"_MEI([0-9a-f]{8})[A-Za-z0-9]{6}", name)
            if not m or name == own or alive(int(m.group(1), 16)):
                continue
            shutil.rmtree(os.path.join(root, name), ignore_errors=True)

    threading.Thread(target=run, name="formsubstrate-unpack-sweep", daemon=True).start()


def announce_port(server, data) -> None:
    def run() -> None:
        for _ in range(600):
            if server.started and server.servers:
                break
            time.sleep(0.1)
        else:
            return
        try:
            port = server.servers[0].sockets[0].getsockname()[1]
            (data / PORT_NAME).write_text(json.dumps({"pid": os.getpid(), "port": port}), encoding="utf-8")
        except (OSError, IndexError):
            return

    threading.Thread(target=run, name="formsubstrate-port-file", daemon=True).start()


def main() -> int:
    if (len(sys.argv) > 1 and sys.argv[1] == "selfcheck") or "--selfcheck" in sys.argv:
        return selfcheck()
    if "--ptyhost" in sys.argv:
        import formsubstrate_ptyhost

        return formsubstrate_ptyhost.main() or 0
    if "--mcp" in sys.argv:
        from app.core import runtime

        runtime.apply_switches([arg for arg in sys.argv[1:] if arg != "--mcp"])
        import formsubstrate_mcp

        return formsubstrate_mcp.main() or 0
    from app.core import runtime

    runtime.apply_switches(sys.argv[1:])
    from app.core import config

    try:
        runtime.claim(config.data_dir())
    except runtime.AlreadyRunning as err:
        print(err, file=sys.stderr)
        return 2
    watch_parent(config.data_dir())
    sweep_stale_unpacks()
    bundled = os.path.join(resource_dir(), "frontend_dist")
    if os.path.isdir(bundled):
        os.environ.setdefault("FORMSUBSTRATE_DIST", bundled)
    os.environ.setdefault("FORMSUBSTRATE_DESKTOP", "1")
    import uvicorn

    from app.main import app as fastapi_app

    port = int(os.environ.get("FORMSUBSTRATE_PORT", "0") or 0)
    server = uvicorn.Server(uvicorn.Config(fastapi_app, host="127.0.0.1", port=port, log_level="info"))
    data = config.data_dir()
    announce_port(server, data)
    try:
        server.run()
    finally:
        try:
            if json.loads((data / PORT_NAME).read_text(encoding="utf-8")).get("pid") == os.getpid():
                (data / PORT_NAME).unlink()
        except (OSError, ValueError, AttributeError):
            pass
    return 0 if server.started else 3


if __name__ == "__main__":
    import multiprocessing

    multiprocessing.freeze_support()
    sys.exit(main())
