import json
import os
import socket
import ssl
import threading
from pathlib import Path

from app.core import config

SETTINGS_NAME = "formnet.json"
FOLDER = "formnet"
BUNDLE_NAME = "ca-bundle.pem"
NODE_NAME = "node-extra.pem"
HOST = "127.0.0.1"
PORT = 8761
PROXY = f"http://{HOST}:{PORT}"
PROBE_SECONDS = 0.4
DATA_ENV = "FORMNET_DATA"
HOME_FOLDER = "formnet"
PROXY_VARS = ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")
NO_PROXY_VARS = ("NO_PROXY", "no_proxy")
LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")
BUNDLE_VARS = ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "GIT_SSL_CAINFO")
NODE_VAR = "NODE_EXTRA_CA_CERTS"
CERT_ENDINGS = (".pem", ".crt", ".cer")
CERT_SUBFOLDERS = ("", "ca", "certs", "cert", "pki")
CERT_MAX = 256 * 1024
PATH_MAX = 4096
BEGIN = "-----BEGIN CERTIFICATE-----"
END = "-----END CERTIFICATE-----"
SYSTEM_FILES = (
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    "/etc/ssl/cert.pem",
)


class Refused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


_lock = threading.Lock()
_settings: dict | None = None
_built: dict = {}


def _settings_file() -> Path:
    return config.data_dir() / SETTINGS_NAME


def _load() -> dict:
    global _settings
    with _lock:
        if _settings is None:
            try:
                data = json.loads(_settings_file().read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = None
            data = data if isinstance(data, dict) else {}
            path = data.get("certPath")
            _settings = {"enabled": data.get("enabled") is True, "certPath": path.strip() if isinstance(path, str) else ""}
        return dict(_settings)


def _certs_in(text: str) -> list[str]:
    found: list[str] = []
    rest = text
    while True:
        start = rest.find(BEGIN)
        if start < 0:
            break
        stop = rest.find(END, start)
        if stop < 0:
            break
        block = rest[start: stop + len(END)]
        rest = rest[stop + len(END):]
        try:
            ssl.PEM_cert_to_DER_cert(block)
        except (ValueError, TypeError):
            continue
        found.append(block)
    return found


def _read_cert(path: str | os.PathLike) -> list[str]:
    try:
        target = Path(path)
        if not target.is_file() or target.stat().st_size > CERT_MAX:
            return []
        text = target.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    if "PRIVATE KEY-----" in text:
        return []
    return _certs_in(text)


def _rank(path: Path) -> tuple:
    name = path.name.lower()
    return (0 if "root" in name else 1, 0 if "ca" in name else 1, name)


def data_folder() -> tuple[Path, str]:
    given = os.environ.get(DATA_ENV, "").strip()
    if given:
        return Path(given).expanduser(), DATA_ENV
    return Path.home() / HOME_FOLDER, "home"


def find_root() -> tuple[str | None, str]:
    chosen = _load()["certPath"]
    if chosen:
        return (chosen, "setting") if _read_cert(chosen) else (None, "setting")
    base, source = data_folder()
    for sub in CERT_SUBFOLDERS:
        folder = base / sub if sub else base
        try:
            names = sorted((child for child in folder.iterdir() if child.name.lower().endswith(CERT_ENDINGS)), key=_rank)
        except OSError:
            continue
        for child in names:
            if _read_cert(child):
                return str(child), source
    return None, source


def port_open() -> bool:
    try:
        with socket.create_connection((HOST, PORT), timeout=PROBE_SECONDS):
            return True
    except OSError:
        return False


def _system_certs() -> list[str]:
    try:
        default = ssl.get_default_verify_paths().cafile
    except (ssl.SSLError, OSError, ValueError):
        default = None
    for name in (os.environ.get("SSL_CERT_FILE", "").strip(), default or "", *SYSTEM_FILES):
        found = _read_cert_bundle(name) if name else []
        if found:
            return found
    try:
        context = ssl.create_default_context()
        return [ssl.DER_cert_to_PEM_cert(der).strip() for der in context.get_ca_certs(binary_form=True)]
    except (ssl.SSLError, OSError, ValueError):
        return []


def _read_cert_bundle(path: str) -> list[str]:
    try:
        return _certs_in(Path(path).read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return []


def _stamp(path: str) -> tuple:
    try:
        st = os.stat(path)
        return (path, st.st_mtime_ns, st.st_size)
    except OSError:
        return (path, 0, 0)


def _write(name: str, blocks: list[str]) -> str:
    folder = config.data_dir() / FOLDER
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name
    temp = target.with_name(target.name + ".tmp")
    temp.write_text("\n".join(blocks) + "\n", encoding="utf-8")
    os.replace(temp, target)
    return str(target)


def build(root: str) -> dict:
    extra = os.environ.get(NODE_VAR, "").strip()
    key = (_stamp(root), _stamp(extra) if extra else None, os.environ.get("SSL_CERT_FILE", ""))
    with _lock:
        if _built.get("key") == key and all(os.path.isfile(p) for p in (_built.get("bundle"), _built.get("node")) if p):
            return dict(_built)
    mine = _read_cert(root)
    out: dict = {"key": key, "bundle": None, "node": root, "problem": ""}
    system = _system_certs()
    try:
        if system and mine:
            out["bundle"] = _write(BUNDLE_NAME, list(dict.fromkeys(system + mine)))
        else:
            out["problem"] = "the system's certificates could not be read, so no combined bundle was written"
        before = _read_cert_bundle(extra) if extra else []
        if before and mine:
            out["node"] = _write(NODE_NAME, list(dict.fromkeys(before + mine)))
    except OSError as err:
        out["bundle"] = None
        out["problem"] = "the combined bundle could not be written: " + (err.strerror or str(err))
    with _lock:
        _built.clear()
        _built.update(out)
    return dict(out)


def status() -> dict:
    current = _load()
    root, source = find_root()
    base, _ = data_folder()
    made = build(root) if root else {"bundle": None, "node": None, "problem": ""}
    answering = port_open()
    return {
        "enabled": current["enabled"],
        "proxy": PROXY,
        "portOpen": answering,
        "certPath": current["certPath"],
        "certFound": root,
        "certSource": source,
        "certFolder": str(base),
        "bundle": made["bundle"],
        "bundleProblem": made["problem"],
        "active": current["enabled"] and answering,
    }


def save(enabled: bool | None, cert_path: str | None) -> dict:
    global _settings
    current = _load()
    if enabled is not None:
        current["enabled"] = enabled is True
    if cert_path is not None:
        path = cert_path.strip()
        if path:
            if len(path) > PATH_MAX or any(ord(ch) < 32 or ord(ch) == 127 for ch in path):
                raise Refused(400, "bad path")
            if not os.path.isabs(path):
                raise Refused(400, "the path must be absolute")
            if not os.path.isfile(path):
                raise Refused(400, "no file exists at that path")
            if not _read_cert(path):
                raise Refused(400, "that file is not a PEM certificate")
        current["certPath"] = path
    target = _settings_file()
    temp = target.with_name(target.name + ".tmp")
    with _lock:
        temp.write_text(json.dumps(current, indent=2), encoding="utf-8")
        os.replace(temp, target)
        _settings = dict(current)
    return status()


def terminal_env(base: dict[str, str]) -> dict[str, str]:
    if not _load()["enabled"] or not port_open():
        return {}
    env = {name: PROXY for name in PROXY_VARS}
    for name in NO_PROXY_VARS:
        have = [part.strip() for part in (base.get(name) or "").split(",") if part.strip()]
        env[name] = ",".join(dict.fromkeys([*LOCAL_HOSTS, *have]))
    root, _ = find_root()
    if root:
        made = build(root)
        env[NODE_VAR] = made["node"]
        if made["bundle"]:
            for name in BUNDLE_VARS:
                env[name] = made["bundle"]
    return env
