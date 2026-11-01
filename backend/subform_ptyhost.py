import asyncio
import base64
import json
import os
import re
import secrets
import signal
import struct
import sys
import time
from pathlib import Path

RING_BYTES = 2 * 1024 * 1024
HIGH_WATER = 256 * 1024
LOW_WATER = 64 * 1024
READ_CHUNK = 65536
REPLAY_CHUNK = 65536
MAX_FRAME = 16 * 1024 * 1024
MIN_COLS, MIN_ROWS = 10, 4
MAX_COLS, MAX_ROWS = 1000, 500
IDLE_SECONDS = float(os.environ.get("SUBFORM_PTYHOST_IDLE", "600"))
REAP_SECONDS = float(os.environ.get("SUBFORM_PTYHOST_REAP", "300"))
ID_RE = re.compile(r"^[a-z0-9]{16}$")
TAIL_LINES = 2000
TAIL_BYTES = 256 * 1024
TAIL_RAW = 1024 * 1024
ANSI_RE = re.compile(
    r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?"
    r"|\x1b[PX^_][^\x1b]*(?:\x1b\\)?"
    r"|\x1b\[[0-?]*[ -/]*[@-~]?"
    r"|\x1b[()*+][0-2AB]"
    r"|\x1b[ -/]*[0-~]?"
)
CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
WINDOWS = sys.platform == "win32"


def plain_text(raw):
    text = raw.decode("utf-8", "replace").replace("\r\n", "\n")
    text = ANSI_RE.sub("", text)
    lines = []
    for line in text.split("\n"):
        if "\r" in line:
            parts = [p for p in line.split("\r") if p]
            line = parts[-1] if parts else ""
        lines.append(CTRL_RE.sub("", line))
    return lines

if not WINDOWS:
    import fcntl
    from ptyprocess import PtyProcess
else:
    import msvcrt


def data_dir() -> Path:
    args = sys.argv[1:]
    if "--data-dir" in args and args.index("--data-dir") + 1 < len(args):
        return Path(args[args.index("--data-dir") + 1])
    raw = os.environ.get("SUBFORM_DATA_DIR")
    if not raw:
        sys.stderr.write("subform-ptyhost: no data folder (pass --data-dir)\n")
        sys.exit(2)
    return Path(raw)


class PosixPty:
    def __init__(self, argv, cwd, env, cols, rows):
        self.proc = PtyProcess.spawn(argv, cwd=cwd, env=env, dimensions=(rows, cols))
        self.fd = self.proc.fd
        os.set_blocking(self.fd, False)
        self.pid = self.proc.pid
        self.loop = None
        self.reading = False
        self.writing = False
        self.wbuf = bytearray()
        self.on_data = None
        self.on_eof = None
        self.closed = False

    def start(self, loop, on_data, on_eof):
        self.loop = loop
        self.on_data = on_data
        self.on_eof = on_eof
        self.resume()

    def _ready(self):
        try:
            data = os.read(self.fd, READ_CHUNK)
        except BlockingIOError:
            return
        except OSError:
            data = b""
        if data:
            self.on_data(data)
        else:
            self.pause()
            self.on_eof()

    def pause(self):
        if self.reading and not self.closed:
            self.loop.remove_reader(self.fd)
            self.reading = False

    def resume(self):
        if not self.reading and not self.closed:
            self.loop.add_reader(self.fd, self._ready)
            self.reading = True

    def drain(self, limit=1024 * 1024):
        out = bytearray()
        while len(out) < limit and not self.closed:
            try:
                data = os.read(self.fd, READ_CHUNK)
            except (BlockingIOError, OSError):
                break
            if not data:
                break
            out += data
        return bytes(out)

    def write(self, data):
        if self.closed:
            return
        self.wbuf += data
        self._flush()

    def _flush(self):
        while self.wbuf and not self.closed:
            try:
                n = os.write(self.fd, self.wbuf)
            except BlockingIOError:
                if not self.writing:
                    self.loop.add_writer(self.fd, self._flush)
                    self.writing = True
                return
            except OSError:
                self.wbuf.clear()
                break
            del self.wbuf[:n]
        if self.writing and not self.closed:
            self.loop.remove_writer(self.fd)
            self.writing = False

    def resize(self, cols, rows):
        try:
            self.proc.setwinsize(rows, cols)
        except OSError:
            pass

    def alive(self):
        return self.proc.isalive()

    def exit_code(self):
        if self.proc.exitstatus is not None:
            return self.proc.exitstatus
        if self.proc.signalstatus is not None:
            return 128 + self.proc.signalstatus
        return None

    def signal_group(self, sig):
        try:
            os.killpg(self.pid, sig)
        except (ProcessLookupError, PermissionError):
            try:
                os.kill(self.pid, sig)
            except (ProcessLookupError, PermissionError):
                pass

    def terminate(self):
        self.signal_group(signal.SIGHUP)

    def force(self):
        self.signal_group(signal.SIGKILL)

    def sweep(self):
        try:
            os.killpg(self.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass

    def close(self):
        if self.closed:
            return
        self.pause()
        if self.writing:
            self.loop.remove_writer(self.fd)
            self.writing = False
        self.closed = True
        try:
            self.proc.fileobj.close()
        except OSError:
            pass


class WinPty:
    def __init__(self, argv, cwd, env, cols, rows):
        import threading
        from winpty import PtyProcess as WinProcess

        self.proc = WinProcess.spawn(argv, cwd=cwd, env=env, dimensions=(rows, cols))
        self.pid = self.proc.pid
        self.go = threading.Event()
        self.go.set()
        self.closed = False
        self.loop = None
        self.thread = None
        self.on_data = None
        self.on_eof = None
        self.threading = threading

    def start(self, loop, on_data, on_eof):
        self.loop = loop
        self.on_data = on_data
        self.on_eof = on_eof
        self.thread = self.threading.Thread(target=self._pump, daemon=True)
        self.thread.start()

    def _pump(self):
        while not self.closed:
            self.go.wait()
            if self.closed:
                return
            try:
                text = self.proc.read(READ_CHUNK)
            except (EOFError, OSError):
                break
            if text:
                self.loop.call_soon_threadsafe(self.on_data, text.encode("utf-8", "replace"))
        self.loop.call_soon_threadsafe(self.on_eof)

    def pause(self):
        self.go.clear()

    def resume(self):
        self.go.set()

    def drain(self, limit=0):
        return b""

    def write(self, data):
        if not self.closed:
            try:
                self.proc.write(data.decode("utf-8", "replace"))
            except OSError:
                pass

    def resize(self, cols, rows):
        try:
            self.proc.setwinsize(rows, cols)
        except OSError:
            pass

    def alive(self):
        return self.proc.isalive()

    def exit_code(self):
        status = self.proc.exitstatus
        return status if status is not None else None

    def terminate(self):
        try:
            self.proc.terminate(force=False)
        except Exception:
            pass

    def force(self):
        try:
            self.proc.terminate(force=True)
        except Exception:
            pass

    def close(self):
        self.closed = True
        self.go.set()
        try:
            self.proc.close()
        except Exception:
            pass


Pty = WinPty if WINDOWS else PosixPty


class Conn:
    def __init__(self, writer, authed):
        self.writer = writer
        self.authed = authed
        self.attached = set()
        self.closed = False

    def send(self, obj):
        if self.closed:
            return
        raw = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        try:
            self.writer.write(struct.pack(">I", len(raw)) + raw)
        except (OSError, RuntimeError):
            self.closed = True


class Term:
    def __init__(self, tid, cwd, argv, cols, rows, meta):
        self.id = tid
        self.cwd = cwd
        self.argv = argv
        self.cols = cols
        self.rows = rows
        self.meta = meta
        self.created = time.time()
        self.pty = None
        self.alive = True
        self.exit_code = None
        self.finalizing = False
        self.buf = bytearray()
        self.base = 0
        self.unacked = 0
        self.paused = False
        self.subs = set()
        self.ended = None

    @property
    def total(self):
        return self.base + len(self.buf)

    def describe(self):
        return {
            "id": self.id,
            "pid": self.pty.pid if self.pty else 0,
            "cwd": self.cwd,
            "argv": self.argv,
            "alive": self.alive,
            "exitCode": self.exit_code,
            "bytes": self.total,
            "cols": self.cols,
            "rows": self.rows,
            "created": self.created,
            "meta": self.meta,
            "unacked": self.unacked,
            "paused": self.paused,
            "attached": len(self.subs),
        }


class Host:
    def __init__(self, data):
        self.data = data
        self.terms = {}
        self.conns = set()
        self.token = None
        self.loop = None
        self.idle_since = time.time()
        self.stop = asyncio.Event()
        self.server = None
        self.lock_fd = None

    def broadcast(self, term, obj):
        for conn in list(term.subs):
            conn.send(obj)

    def feed(self, term, data):
        seq = term.total
        term.buf += data
        if len(term.buf) > RING_BYTES:
            cut = len(term.buf) - RING_BYTES
            del term.buf[:cut]
            term.base += cut
        if term.subs:
            term.unacked += len(data)
            frame = {"op": "output", "id": term.id, "seq": seq, "data": base64.b64encode(data).decode("ascii")}
            self.broadcast(term, frame)
            if term.unacked >= HIGH_WATER and not term.paused and term.pty and not term.finalizing:
                term.paused = True
                term.pty.pause()

    def settle(self, term):
        if term.paused and (term.unacked < LOW_WATER or not term.subs):
            term.paused = False
            if term.pty and term.alive and not term.finalizing:
                term.pty.resume()

    def on_eof(self, term):
        self.loop.create_task(self.finalize(term))

    async def finalize(self, term):
        if term.finalizing or not term.alive:
            return
        term.finalizing = True
        pty = term.pty
        pty.pause()
        rest = pty.drain()
        if rest:
            self.feed(term, rest)
        for _ in range(50):
            if not pty.alive():
                break
            await asyncio.sleep(0.1)
        if pty.alive():
            pty.force()
            for _ in range(20):
                if not pty.alive():
                    break
                await asyncio.sleep(0.1)
        term.exit_code = pty.exit_code()
        term.alive = False
        term.paused = False
        term.ended = time.time()
        pty.close()
        frame = {"op": "exit", "id": term.id, "code": term.exit_code}
        for conn in list(self.conns):
            conn.send(frame)

    async def reaper(self):
        while not self.stop.is_set():
            await asyncio.sleep(0.5)
            for term in list(self.terms.values()):
                if term.alive and not term.finalizing and not term.pty.alive():
                    self.loop.create_task(self.finalize(term))
            now = time.time()
            for tid, term in list(self.terms.items()):
                if not term.alive and not term.subs and term.ended is not None and now - term.ended >= REAP_SECONDS:
                    self.terms.pop(tid, None)

    async def kill(self, term):
        if term.alive and not term.finalizing:
            term.pty.terminate()
            for _ in range(10):
                if not term.pty.alive():
                    break
                await asyncio.sleep(0.1)
            if term.pty.alive():
                term.pty.force()
            await self.finalize(term)
            sweep = getattr(term.pty, "sweep", None)
            if sweep:
                sweep()
        else:
            for _ in range(80):
                if not term.alive:
                    break
                await asyncio.sleep(0.1)

    async def idle_watch(self):
        while not self.stop.is_set():
            await asyncio.sleep(2)
            busy = bool(self.conns) or any(t.alive for t in self.terms.values())
            if busy:
                self.idle_since = time.time()
            elif time.time() - self.idle_since >= IDLE_SECONDS:
                self.stop.set()

    def spawn(self, conn, msg):
        tid = msg.get("id")
        if not isinstance(tid, str) or not ID_RE.match(tid):
            return conn.send({"op": "error", "id": tid, "message": "bad terminal id"})
        if tid in self.terms:
            return conn.send({"op": "error", "id": tid, "message": "terminal id already in use"})
        argv = msg.get("argv")
        cwd = msg.get("cwd")
        env = msg.get("env")
        if not (isinstance(argv, list) and argv and all(isinstance(a, str) for a in argv)):
            return conn.send({"op": "error", "id": tid, "message": "argv must be a non-empty list of strings"})
        if not isinstance(cwd, str) or not os.path.isdir(cwd):
            return conn.send({"op": "error", "id": tid, "message": f"no folder {cwd}"})
        if not (isinstance(env, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in env.items())):
            env = dict(os.environ)
        cols = max(MIN_COLS, int(msg.get("cols") or 100))
        rows = max(MIN_ROWS, int(msg.get("rows") or 30))
        meta = msg.get("meta") if isinstance(msg.get("meta"), dict) else {}
        term = Term(tid, cwd, argv, cols, rows, meta)
        try:
            term.pty = Pty(argv, cwd, env, cols, rows)
        except Exception as exc:
            return conn.send({"op": "error", "id": tid, "message": f"could not start {argv[0]}: {exc}"})
        self.terms[tid] = term
        term.pty.start(self.loop, lambda data, t=term: self.feed(t, data), lambda t=term: self.on_eof(t))
        conn.send({"op": "spawned", "id": tid, "pid": term.pty.pid})

    async def attach(self, conn, term, start):
        term.subs.discard(conn)
        pos = term.base if start is None else max(term.base, min(int(start), term.total))
        first = pos
        term.unacked = 0
        if term.paused:
            term.paused = False
            if term.alive and not term.finalizing:
                term.pty.resume()
        conn.send({"op": "attached", "id": term.id, "from": first, "base": term.base, "bytes": term.total})
        while True:
            pos = max(pos, term.base)
            if pos >= term.total:
                break
            lo = pos - term.base
            chunk = bytes(term.buf[lo:lo + REPLAY_CHUNK])
            conn.send({"op": "output", "id": term.id, "seq": pos, "data": base64.b64encode(chunk).decode("ascii")})
            pos += len(chunk)
            term.unacked += len(chunk)
            try:
                await conn.writer.drain()
            except (OSError, RuntimeError):
                conn.closed = True
                return
        if conn.closed:
            return
        term.subs.add(conn)
        conn.attached.add(term.id)
        if not term.alive:
            conn.send({"op": "exit", "id": term.id, "code": term.exit_code})
        elif term.unacked >= HIGH_WATER and not term.paused and not term.finalizing:
            term.paused = True
            term.pty.pause()

    def tail(self, conn, term, msg):
        lines = msg.get("lines")
        lines = lines if isinstance(lines, int) and not isinstance(lines, bool) and lines > 0 else 200
        lines = min(lines, TAIL_LINES)
        since = msg.get("since")
        since = since if isinstance(since, int) and not isinstance(since, bool) and since >= 0 else None
        total = term.total
        start = term.base if since is None else max(term.base, min(since, total))
        start = max(start, total - TAIL_RAW)
        missed = 0
        if since is not None:
            missed = max(0, start - since)
        raw = bytes(term.buf[start - term.base:])
        rows = plain_text(raw)
        if since is None and rows and rows[-1] == "":
            rows.pop()
        dropped = max(0, len(rows) - lines)
        rows = rows[-lines:]
        text = "\n".join(rows)
        encoded = text.encode("utf-8")
        clipped = False
        if len(encoded) > TAIL_BYTES:
            encoded = encoded[-TAIL_BYTES:]
            text = encoded.decode("utf-8", "ignore")
            clipped = True
        conn.send({
            "op": "tailed",
            "id": term.id,
            "text": text,
            "next": total,
            "base": term.base,
            "from": start,
            "missed": missed,
            "cut": bool(dropped or clipped),
            "alive": term.alive,
            "exitCode": term.exit_code,
        })

    def detach(self, conn, term):
        term.subs.discard(conn)
        conn.attached.discard(term.id)
        if not term.subs:
            term.unacked = 0
        self.settle(term)

    async def handle(self, conn, msg):
        op = msg.get("op")
        tid = msg.get("id")
        if op == "spawn":
            return self.spawn(conn, msg)
        if op == "list":
            return conn.send({"op": "list", "terminals": [t.describe() for t in self.terms.values()]})
        term = self.terms.get(tid) if isinstance(tid, str) else None
        if term is None:
            return conn.send({"op": "error", "id": tid, "message": "no such terminal"})
        if op == "write":
            if term.alive and not term.finalizing:
                try:
                    term.pty.write(base64.b64decode(msg.get("data") or ""))
                except ValueError:
                    conn.send({"op": "error", "id": tid, "message": "bad data"})
        elif op == "resize":
            cols = min(MAX_COLS, max(MIN_COLS, int(msg.get("cols") or term.cols)))
            rows = min(MAX_ROWS, max(MIN_ROWS, int(msg.get("rows") or term.rows)))
            if term.alive and not term.finalizing:
                term.pty.resize(cols, rows)
            term.cols, term.rows = cols, rows
        elif op == "kill":
            await self.kill(term)
            self.terms.pop(tid, None)
            conn.send({"op": "killed", "id": tid})
        elif op == "attach":
            start = msg.get("from")
            await self.attach(conn, term, start if isinstance(start, int) and not isinstance(start, bool) else None)
        elif op == "detach":
            self.detach(conn, term)
        elif op == "tail":
            self.tail(conn, term, msg)
        elif op == "ack":
            count = msg.get("bytes")
            if isinstance(count, int) and count > 0:
                term.unacked = max(0, term.unacked - count)
                self.settle(term)
        else:
            conn.send({"op": "error", "id": tid, "message": f"unknown op {op}"})

    async def client(self, reader, writer):
        conn = Conn(writer, self.token is None)
        self.conns.add(conn)
        try:
            while True:
                head = await reader.readexactly(4)
                (size,) = struct.unpack(">I", head)
                if size > MAX_FRAME:
                    break
                try:
                    msg = json.loads(await reader.readexactly(size))
                except ValueError:
                    continue
                if not isinstance(msg, dict):
                    continue
                if not conn.authed:
                    if msg.get("op") == "hello" and secrets.compare_digest(str(msg.get("token", "")), self.token):
                        conn.authed = True
                        conn.send({"op": "hello", "pid": os.getpid()})
                        continue
                    break
                try:
                    await self.handle(conn, msg)
                except Exception as exc:
                    conn.send({"op": "error", "id": msg.get("id"), "message": str(exc)})
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass
        finally:
            conn.closed = True
            self.conns.discard(conn)
            for tid in list(conn.attached):
                term = self.terms.get(tid)
                if term is not None:
                    self.detach(conn, term)
            self.idle_since = time.time()
            try:
                writer.close()
            except OSError:
                pass

    def lock(self):
        path = self.data / "ptyhost.lock"
        self.lock_fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            if WINDOWS:
                msvcrt.locking(self.lock_fd, msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return False
        return True

    async def listen(self):
        if WINDOWS:
            self.token = secrets.token_hex(24)
            self.server = await asyncio.start_server(self.client, "127.0.0.1", 0)
            port = self.server.sockets[0].getsockname()[1]
            (self.data / "ptyhost.token").write_text(self.token)
            (self.data / "ptyhost.port").write_text(str(port))
        else:
            sock = self.data / "ptyhost.sock"
            try:
                sock.unlink()
            except FileNotFoundError:
                pass
            old = os.umask(0o177)
            try:
                self.server = await asyncio.start_unix_server(self.client, path=str(sock))
            finally:
                os.umask(old)
            os.chmod(sock, 0o600)

    def cleanup(self):
        for name in ("ptyhost.sock", "ptyhost.port", "ptyhost.token"):
            try:
                (self.data / name).unlink()
            except OSError:
                pass
        try:
            if int((self.data / "ptyhost.pid").read_text().strip()) == os.getpid():
                (self.data / "ptyhost.pid").unlink()
        except (OSError, ValueError):
            pass

    async def run(self):
        self.loop = asyncio.get_running_loop()
        await self.listen()
        pid_file = self.data / "ptyhost.pid"
        pid_file.write_text(str(os.getpid()))
        os.chmod(pid_file, 0o600)
        if not WINDOWS:
            for sig in (signal.SIGTERM, signal.SIGINT):
                self.loop.add_signal_handler(sig, self.stop.set)
            signal.signal(signal.SIGHUP, signal.SIG_IGN)
        tasks = [self.loop.create_task(self.reaper()), self.loop.create_task(self.idle_watch())]
        await self.stop.wait()
        for task in tasks:
            task.cancel()
        self.server.close()
        for term in list(self.terms.values()):
            if term.alive:
                term.pty.terminate()
        await asyncio.sleep(0.2)
        for term in list(self.terms.values()):
            if term.alive and term.pty.alive():
                term.pty.force()
        self.cleanup()


def main():
    data = data_dir()
    data.mkdir(parents=True, exist_ok=True)
    host = Host(data)
    if not host.lock():
        return 0
    asyncio.run(host.run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
