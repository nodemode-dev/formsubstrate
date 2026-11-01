import glob
import json
import os
import sys
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

    info["subform"] = __version__
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
        import subform_ptyhost

        info["app"] = "ok"
    except Exception as exc:
        info["app"] = f"failed: {exc!r}"
        print(json.dumps(info))
        return 1
    print(json.dumps(info))
    return 0 if all(not str(value).startswith("missing") for value in info.values()) else 1


def watch_parent() -> None:
    if os.name != "posix":
        return
    parent = os.getppid()
    if parent <= 1:
        return
    import shutil

    def run() -> None:
        while os.getppid() == parent:
            time.sleep(2)
        unpacked = getattr(sys, "_MEIPASS", "")
        if os.path.basename(unpacked).startswith("_MEI"):
            shutil.rmtree(unpacked, ignore_errors=True)
        os._exit(0)

    threading.Thread(target=run, name="subform-parent-watch", daemon=True).start()


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

    threading.Thread(target=run, name="subform-unpack-sweep", daemon=True).start()


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

    threading.Thread(target=run, name="subform-port-file", daemon=True).start()


def main() -> int:
    if (len(sys.argv) > 1 and sys.argv[1] == "selfcheck") or "--selfcheck" in sys.argv:
        return selfcheck()
    if "--ptyhost" in sys.argv:
        import subform_ptyhost

        return subform_ptyhost.main() or 0
    from app.core import runtime

    runtime.apply_switches(sys.argv[1:])
    from app.core import config

    try:
        runtime.claim(config.data_dir())
    except runtime.AlreadyRunning as err:
        print(err, file=sys.stderr)
        return 2
    watch_parent()
    sweep_stale_unpacks()
    bundled = os.path.join(resource_dir(), "frontend_dist")
    if os.path.isdir(bundled):
        os.environ.setdefault("SUBFORM_DIST", bundled)
    os.environ.setdefault("SUBFORM_DESKTOP", "1")
    import uvicorn

    from app.main import app as fastapi_app

    port = int(os.environ.get("SUBFORM_PORT", "0") or 0)
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
