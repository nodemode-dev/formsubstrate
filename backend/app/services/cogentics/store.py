import dataclasses
import json
import os
import time
from pathlib import Path
from typing import Optional

from app.services.cogentics import paths
from app.services.cogentics.model import NAME_RE, Channel, Member


class StoreMixin:
    def _dir(self) -> Path:
        base = paths.root()
        if self._root != base:
            self._root = base
            self._channels = {}
            self._inbox = {}
            self._busy = {}
        d = paths.state_dir(base) / "cogentics"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _write_atomic(self, path: Path, text: str) -> None:
        temp = path.with_name(path.name + ".tmp")
        temp.write_text(text, encoding="utf-8")
        os.replace(temp, path)

    def _save(self, ch: Channel) -> None:
        meta = ch.to_dict()
        meta.pop("messages", None)
        self._write_atomic(self._dir() / f"{ch.name}.json", json.dumps(meta, indent=1))
        self._rewrite_log(ch)

    def _save_meta(self, ch: Channel) -> None:
        meta = ch.to_dict()
        meta.pop("messages", None)
        self._write_atomic(self._dir() / f"{ch.name}.json", json.dumps(meta, indent=1))

    def _log_path(self, name: str) -> Path:
        return self._dir() / f"{name}.messages.jsonl"

    def _rewrite_log(self, ch: Channel) -> None:
        lines = "".join(json.dumps(m) + "\n" for m in ch.messages)
        self._write_atomic(self._log_path(ch.name), lines)

    def _append_log(self, ch: Channel, msg: dict) -> None:
        with self._log_path(ch.name).open("a", encoding="utf-8") as f:
            f.write(json.dumps(msg) + "\n")

    def _load(self, name: str) -> Optional[Channel]:
        p = self._dir() / f"{name}.json"
        if not p.exists():
            return None
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        messages: list[dict] = []
        lp = self._log_path(name)
        if lp.exists():
            for line in lp.read_text(encoding="utf-8").splitlines():
                try:
                    messages.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        ch = Channel(name=raw["name"], created=raw.get("created", time.time()),
                     seq=raw.get("seq", 0), messages=messages,
                     config=raw.get("config", {}))
        ch.groups = raw.get("groups", [])
        if messages:
            ch.seq = max(ch.seq, max(m.get("seq", 0) for m in messages))
        known = {f.name for f in dataclasses.fields(Member)}
        ch.members = [Member(**{k: v for k, v in m.items() if k in known})
                      for m in raw.get("members", [])]
        return ch

    def list_channels(self) -> list[dict]:
        out = []
        for p in sorted(self._dir().glob("*.json")):
            ch = self.channel(p.stem)
            if not ch:
                continue
            last = ch.messages[-1]["ts"] if ch.messages else ch.created
            out.append({"name": ch.name, "seq": ch.seq, "last_ts": last,
                        "members": len(ch.members)})
        return out

    def channel(self, name: str) -> Optional[Channel]:
        if not NAME_RE.match(name):
            return None
        self._dir()
        if name not in self._channels:
            loaded = self._load(name)
            if loaded is None:
                return None
            self._channels[name] = loaded
        return self._channels[name]

    def create(self, name: str) -> Channel:
        if not NAME_RE.match(name):
            raise ValueError("channel name: lowercase letters, digits, - _")
        if self.channel(name):
            raise ValueError(f"channel exists: {name}")
        ch = Channel(name=name, created=time.time(),
                     members=[Member(handle="operator", kind="human")])
        self._channels[name] = ch
        self._save(ch)
        return ch

    def delete(self, name: str) -> bool:
        if not NAME_RE.match(name):
            return False
        self._dir()
        self._channels.pop(name, None)
        d = self._dir()
        p = d / f"{name}.json"
        if not p.exists():
            return False
        p.unlink()
        for extra in (self._log_path(name),):
            if extra.exists():
                extra.unlink()
        return True
