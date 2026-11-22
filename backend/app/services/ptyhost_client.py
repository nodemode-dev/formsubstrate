import asyncio
import json
import os
import struct
import subprocess
import sys
from pathlib import Path
from typing import AsyncIterator

from app.core import config

HOST_SCRIPT = config.BACKEND_DIR / "formsubstrate_ptyhost.py"
START_WAIT = 10.0
REQUEST_WAIT = 15.0
MAX_FRAME = 16 * 1024 * 1024
WINDOWS = sys.platform == "win32"


class PtyHostError(Exception):
    pass


class PtyHostMissing(PtyHostError):
    pass


def host_command(data: Path) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--ptyhost", "--data-dir", str(data)]
    return [sys.executable, str(HOST_SCRIPT), "--data-dir", str(data)]


class PtyHostClient:
    def __init__(self) -> None:
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._read_task: asyncio.Task | None = None
        self._connect_lock = asyncio.Lock()
        self._send_lock = asyncio.Lock()
        self._waiters: dict[str, list[tuple[asyncio.Future, tuple[str, ...]]]] = {}
        self._events: asyncio.Queue = asyncio.Queue()
        self._closed = False

    @property
    def connected(self) -> bool:
        return self._writer is not None and not self._writer.is_closing()

    async def _open(self):
        data = config.data_dir()
        if WINDOWS:
            port = int((data / "ptyhost.port").read_text().strip())
            token = (data / "ptyhost.token").read_text().strip()
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            await self._raw_send(writer, {"op": "hello", "token": token})
            reply = await self._raw_read(reader)
            if reply.get("op") != "hello":
                writer.close()
                raise ConnectionError("pty-host refused the token")
            return reader, writer
        return await asyncio.open_unix_connection(str(data / "ptyhost.sock"))

    @staticmethod
    async def _raw_send(writer, obj) -> None:
        raw = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        writer.write(struct.pack(">I", len(raw)) + raw)
        await writer.drain()

    @staticmethod
    async def _raw_read(reader) -> dict:
        (size,) = struct.unpack(">I", await reader.readexactly(4))
        if size > MAX_FRAME:
            raise ConnectionError("pty-host frame too large")
        return json.loads(await reader.readexactly(size))

    def _start_host(self) -> None:
        data = config.data_dir()
        log = open(data / "ptyhost.log", "ab")
        env = dict(os.environ)
        env["FORMSUBSTRATE_DATA_DIR"] = str(data)
        kwargs: dict = {"stdin": subprocess.DEVNULL, "stdout": log, "stderr": log, "env": env, "close_fds": True}
        if WINDOWS:
            kwargs["creationflags"] = 0x00000008 | 0x00000200 | 0x08000000
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen(host_command(data), **kwargs)
        log.close()

    async def ensure(self, start: bool = True) -> bool:
        if self.connected:
            return True
        async with self._connect_lock:
            if self.connected:
                return True
            self._closed = False
            try:
                reader, writer = await self._open()
            except (OSError, ValueError):
                if not start:
                    return False
                self._start_host()
                reader = writer = None
                loop = asyncio.get_running_loop()
                deadline = loop.time() + START_WAIT
                while loop.time() < deadline:
                    await asyncio.sleep(0.1)
                    try:
                        reader, writer = await self._open()
                        break
                    except (OSError, ValueError):
                        continue
                if writer is None:
                    raise PtyHostMissing("the pty-host did not start")
            self._reader, self._writer = reader, writer
            self._read_task = asyncio.create_task(self._read_loop(reader, writer))
            return True

    async def _read_loop(self, reader, writer) -> None:
        try:
            while True:
                msg = await self._raw_read(reader)
                if not self._deliver(msg):
                    self._events.put_nowait(msg)
        except (asyncio.IncompleteReadError, ConnectionError, OSError, ValueError):
            pass
        finally:
            if self._writer is writer:
                self._writer = None
                self._reader = None
            try:
                writer.close()
            except OSError:
                pass
            for items in self._waiters.values():
                for fut, _ in items:
                    if not fut.done():
                        fut.set_exception(PtyHostError("pty-host connection lost"))
            self._waiters.clear()
            if not self._closed:
                self._events.put_nowait({"op": "disconnected"})

    def _deliver(self, msg: dict) -> bool:
        key = msg.get("id") or ""
        items = self._waiters.get(key)
        if not items:
            return False
        op = msg.get("op")
        for index, (fut, ops) in enumerate(items):
            if op in ops or op == "error":
                items.pop(index)
                if not items:
                    self._waiters.pop(key, None)
                if not fut.done():
                    fut.set_result(msg)
                return True
        return False

    async def send(self, msg: dict) -> None:
        if not await self.ensure(start=False):
            raise PtyHostMissing("the pty-host is not running")
        async with self._send_lock:
            writer = self._writer
            if writer is None:
                raise PtyHostError("pty-host connection lost")
            try:
                await self._raw_send(writer, msg)
            except (OSError, ConnectionError) as exc:
                raise PtyHostError("pty-host connection lost") from exc

    async def request(self, msg: dict, reply: tuple[str, ...], timeout: float = REQUEST_WAIT, start: bool = True) -> dict:
        if not await self.ensure(start):
            raise PtyHostMissing("the pty-host is not running")
        fut = asyncio.get_running_loop().create_future()
        key = msg.get("id") or ""
        self._waiters.setdefault(key, []).append((fut, reply))
        try:
            async with self._send_lock:
                writer = self._writer
                if writer is None:
                    raise PtyHostError("pty-host connection lost")
                await self._raw_send(writer, msg)
            result = await asyncio.wait_for(fut, timeout)
        except (OSError, asyncio.TimeoutError) as exc:
            raise PtyHostError(f"pty-host did not answer {msg.get('op')}") from exc
        finally:
            items = self._waiters.get(key)
            if items:
                items[:] = [item for item in items if item[0] is not fut]
                if not items:
                    self._waiters.pop(key, None)
        if result.get("op") == "error":
            raise PtyHostError(result.get("message") or "pty-host error")
        return result

    async def list(self, start: bool = False) -> list[dict]:
        try:
            reply = await self.request({"op": "list"}, ("list",), start=start)
        except PtyHostMissing:
            return []
        return reply.get("terminals", [])

    async def tail(self, tid: str, lines: int, since: int | None = None) -> dict:
        msg: dict = {"op": "tail", "id": tid, "lines": lines}
        if since is not None:
            msg["since"] = since
        return await self.request(msg, ("tailed",), start=False)

    async def events(self) -> AsyncIterator[dict]:
        delay = 0.25
        while True:
            msg = await self._events.get()
            if msg is None:
                return
            yield msg
            if msg.get("op") != "disconnected":
                continue
            while not self.connected:
                if self._closed:
                    return
                try:
                    if await self.ensure(start=False):
                        break
                except PtyHostError:
                    pass
                await asyncio.sleep(delay)
                delay = min(delay * 2, 2.0)
            delay = 0.25
            yield {"op": "connected"}

    async def close(self) -> None:
        self._closed = True
        writer, task = self._writer, self._read_task
        self._writer = None
        self._reader = None
        if writer is not None:
            try:
                writer.close()
                await writer.wait_closed()
            except OSError:
                pass
        if task is not None:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._events.put_nowait(None)


_client: PtyHostClient | None = None


def get_client() -> PtyHostClient:
    global _client
    if _client is None:
        _client = PtyHostClient()
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        client, _client = _client, None
        await client.close()
