import asyncio
import atexit
import json
import os
import shlex
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx
import keyring

from app.core import config
from app.core import workspace_root as ws
from app.services.library import activity
from app.services.library.paths import atomic_write, clean_name, library_dir
from app.services.library.registry import Tool, tools

PROTOCOL = "2024-11-05"
SERVICE = "subform"
FILE = "mcp-servers.json"
RESULT_MAX = 20000
DETAIL_MAX = 300


def _secret_name(server: str) -> str:
    return f"mcp.{server}.headers"


def _secret_headers(server: str) -> dict:
    try:
        raw = keyring.get_password(SERVICE, _secret_name(server))
        data = json.loads(raw) if raw else {}
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


@dataclass
class McpServerConfig:
    name: str
    transport: str = "http"
    url: str = ""
    command: str = ""
    header_names: list = field(default_factory=list)
    enabled: bool = True
    sessions: bool = False

    def to_dict(self) -> dict:
        return {"name": self.name, "transport": self.transport, "url": self.url, "command": self.command, "header_names": self.header_names, "enabled": self.enabled, "sessions": self.sessions}


class _StdioSession:
    def __init__(self, command: str) -> None:
        self.command = command
        self.proc: Optional[asyncio.subprocess.Process] = None
        self._id = 0
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        argv = shlex.split(self.command)
        env = {k: v for k, v in os.environ.items() if not k.startswith("SUBFORM_")}
        cwd = ws.current() or os.path.expanduser("~")
        self.proc = await asyncio.create_subprocess_exec(*argv, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, env=env, cwd=cwd)

    async def stop(self) -> None:
        if self.proc and self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), timeout=3)
            except asyncio.TimeoutError:
                self.proc.kill()
        self.proc = None

    @property
    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def rpc(self, method: str, params: Optional[dict] = None, notification: bool = False, timeout: float = 30) -> Any:
        if not self.alive:
            raise RuntimeError("stdio server not running")
        assert self.proc and self.proc.stdin and self.proc.stdout
        msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        if not notification:
            self._id += 1
            msg["id"] = self._id
        async with self._lock:
            self.proc.stdin.write((json.dumps(msg) + "\n").encode())
            await self.proc.stdin.drain()
            if notification:
                return None
            want = msg["id"]
            while True:
                raw = await asyncio.wait_for(self.proc.stdout.readline(), timeout)
                if not raw:
                    raise RuntimeError("stdio server closed the pipe")
                try:
                    data = json.loads(raw)
                except ValueError:
                    continue
                if data.get("id") != want:
                    continue
                if "error" in data:
                    raise RuntimeError(str(data["error"]))
                return data.get("result")


async def _http_rpc(url: str, headers: dict, method: str, params: Optional[dict] = None, notification: bool = False, timeout: float = 30) -> Any:
    msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    if not notification:
        msg["id"] = 1
    sent = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", **headers}
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        res = await client.post(url, headers=sent, json=msg)
        if notification:
            return None
        res.raise_for_status()
        if "text/event-stream" in res.headers.get("content-type", ""):
            for line in res.text.splitlines():
                line = line.strip()
                if line.startswith("data:"):
                    data = json.loads(line[5:].strip())
                    break
            else:
                raise RuntimeError("empty SSE response")
        else:
            data = res.json()
    if "error" in data:
        raise RuntimeError(str(data["error"]))
    return data.get("result")


@dataclass
class ConnectedServer:
    config: McpServerConfig
    tools: list = field(default_factory=list)
    status: str = "disconnected"
    detail: str = ""
    stdio: Optional[_StdioSession] = None


class McpClientManager:
    def __init__(self) -> None:
        self.servers: dict[str, ConnectedServer] = {}
        self.loaded = False

    def _file(self):
        return library_dir() / FILE

    def save(self) -> None:
        atomic_write(self._file(), json.dumps([s.config.to_dict() for s in self.servers.values()], indent=1))

    async def ensure_loaded(self) -> None:
        if self.loaded:
            return
        self.loaded = True
        try:
            raw = json.loads(self._file().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        for item in raw if isinstance(raw, list) else []:
            if not isinstance(item, dict) or not item.get("name"):
                continue
            cfg = McpServerConfig(name=str(item["name"]), transport=str(item.get("transport", "http")), url=str(item.get("url", "")), command=str(item.get("command", "")), header_names=list(item.get("header_names", [])), enabled=bool(item.get("enabled", True)), sessions=bool(item.get("sessions", False)))
            self.servers[cfg.name] = ConnectedServer(config=cfg)
            if cfg.enabled:
                await self.connect(cfg.name)

    async def add(self, cfg: McpServerConfig, headers: dict) -> ConnectedServer:
        await self.remove(cfg.name, keep_saved=True)
        cfg.header_names = sorted(headers)
        if headers:
            keyring.set_password(SERVICE, _secret_name(cfg.name), json.dumps(headers))
        else:
            try:
                keyring.delete_password(SERVICE, _secret_name(cfg.name))
            except Exception:
                pass
        self.servers[cfg.name] = ConnectedServer(config=cfg)
        self.save()
        if cfg.enabled:
            await self.connect(cfg.name)
        return self.servers[cfg.name]

    async def remove(self, name: str, keep_saved: bool = False) -> bool:
        srv = self.servers.pop(name, None)
        if srv is None:
            return False
        tools.unregister_source(f"mcp:{name}")
        if srv.stdio:
            await srv.stdio.stop()
        if not keep_saved:
            try:
                keyring.delete_password(SERVICE, _secret_name(name))
            except Exception:
                pass
            self.save()
            activity.emit(f"mcp {name}", "exit", "removed", "mcp")
        return True

    async def set_enabled(self, name: str, on: bool) -> ConnectedServer:
        srv = self.servers[name]
        srv.config.enabled = on
        self.save()
        if on:
            return await self.connect(name)
        tools.unregister_source(f"mcp:{name}")
        if srv.stdio:
            await srv.stdio.stop()
            srv.stdio = None
        srv.tools = []
        srv.status = "disconnected"
        srv.detail = "disabled"
        activity.emit(f"mcp {name}", "exit", "disabled", "mcp")
        return srv

    async def connect(self, name: str) -> ConnectedServer:
        srv = self.servers[name]
        cfg = srv.config
        tools.unregister_source(f"mcp:{name}")
        headers = _secret_headers(name)
        info = {"name": "subform", "version": config.VERSION}
        try:
            if cfg.transport == "stdio":
                if srv.stdio:
                    await srv.stdio.stop()
                srv.stdio = _StdioSession(cfg.command)
                await srv.stdio.start()
                await srv.stdio.rpc("initialize", {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": info})
                await srv.stdio.rpc("notifications/initialized", {}, notification=True)
                listed = await srv.stdio.rpc("tools/list", {})
            else:
                await _http_rpc(cfg.url, headers, "initialize", {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": info})
                await _http_rpc(cfg.url, headers, "notifications/initialized", {}, notification=True)
                listed = await _http_rpc(cfg.url, headers, "tools/list", {})
            srv.tools = (listed or {}).get("tools", [])
            self._mount(srv)
            srv.status = "connected"
            srv.detail = f"{len(srv.tools)} tools"
            activity.emit(f"mcp {name}", "enter", srv.detail, "mcp")
        except Exception as error:
            srv.status = "error"
            srv.detail = str(error)[:DETAIL_MAX]
            srv.tools = []
            if srv.stdio:
                await srv.stdio.stop()
                srv.stdio = None
            activity.emit(f"mcp {name}", "error", srv.detail, "mcp")
        return srv

    def _mount(self, srv: ConnectedServer) -> None:
        name = srv.config.name
        for item in srv.tools:
            tool_name = item.get("name", "")
            if not tool_name:
                continue
            schema = item.get("inputSchema") or {"type": "object", "properties": {}}
            tools.register(Tool(name=f"mcp_{name}__{tool_name}", description=f"[mcp:{name}] {item.get('description', '')}"[:800], parameters=schema, fn=self._caller(name, tool_name), source=f"mcp:{name}"), replace=True)

    def _caller(self, server: str, tool: str):
        async def call(**kwargs: Any) -> Any:
            srv = self.servers.get(server)
            if srv is None or srv.status != "connected":
                return {"error": f"mcp server {server} is not connected"}
            cfg = srv.config
            try:
                if cfg.transport == "stdio":
                    assert srv.stdio
                    result = await srv.stdio.rpc("tools/call", {"name": tool, "arguments": kwargs}, timeout=120)
                else:
                    result = await _http_rpc(cfg.url, _secret_headers(server), "tools/call", {"name": tool, "arguments": kwargs}, timeout=120)
            except Exception as error:
                return {"error": f"mcp call failed: {error}"}
            content = (result or {}).get("content") or []
            texts = [c.get("text", "") for c in content if c.get("type") == "text"]
            out = "\n".join(t for t in texts if t) or json.dumps(result, default=str)
            if (result or {}).get("isError"):
                return {"error": out[:4000]}
            return out[:RESULT_MAX]

        return call

    def summary(self) -> list[dict]:
        return [{"name": s.config.name, "transport": s.config.transport, "url": s.config.url, "command": s.config.command, "header_names": s.config.header_names, "enabled": s.config.enabled, "sessions": s.config.sessions, "status": s.status, "detail": s.detail, "tools": len(s.tools), "origin": "user"} for s in self.servers.values()]

    def session_entries(self) -> tuple[dict, list[str]]:
        entries: dict[str, dict] = {}
        notes: list[str] = []
        for srv in self.servers.values():
            cfg = srv.config
            if not (cfg.enabled and cfg.sessions):
                continue
            key = f"user-{cfg.name}"
            if cfg.transport == "stdio":
                argv = shlex.split(cfg.command)
                if argv:
                    entries[key] = {"command": argv[0], "args": argv[1:]}
            elif cfg.header_names:
                notes.append(f"the MCP server {cfg.name} needs secret headers and is not written into a session file")
            else:
                entries[key] = {"type": "http", "url": cfg.url}
        return entries, notes

    def stop_now(self) -> None:
        for srv in self.servers.values():
            proc = srv.stdio.proc if srv.stdio else None
            if proc is not None and proc.returncode is None:
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass


mcp_clients = McpClientManager()
atexit.register(mcp_clients.stop_now)


def valid_name(value: str) -> str:
    return clean_name(value, "server name")
