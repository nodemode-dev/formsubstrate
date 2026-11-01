import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.services.cogentics import catalog
from app.services.cogentics.paths import state_dir


def _dir(root: Path) -> Path:
    d = state_dir(root) / "usage"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _day(ts: Optional[float] = None) -> str:
    return datetime.fromtimestamp(ts or time.time(), tz=timezone.utc).strftime("%Y-%m-%d")


def _blank() -> dict:
    return {"prompt_tokens": 0, "completion_tokens": 0, "cost": 0.0, "calls": 0}


def _add(bucket: dict, r: dict) -> None:
    bucket["prompt_tokens"] += r.get("prompt_tokens", 0)
    bucket["completion_tokens"] += r.get("completion_tokens", 0)
    bucket["cost"] += r.get("cost") or 0.0
    bucket["calls"] += 1


class UsageMeter:
    def __init__(self, root: Path):
        self.root = root

    def record(self, *, model: str, usage: dict, scope: str) -> dict:
        pt = int(usage.get("prompt_tokens") or 0)
        ct = int(usage.get("completion_tokens") or 0)
        cost = catalog.estimate_cost(model, pt, ct)
        rec = {"ts": time.time(), "model": model, "scope": scope,
               "prompt_tokens": pt, "completion_tokens": ct, "cost": cost}
        try:
            with (_dir(self.root) / f"{_day()}.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec) + "\n")
        except OSError:
            return rec
        return rec

    def _read_day(self, day: str) -> list[dict]:
        p = _dir(self.root) / f"{day}.jsonl"
        if not p.exists():
            return []
        out = []
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return out

    def summary(self, days: int = 7) -> dict:
        now = time.time()
        by_day: dict[str, dict] = {}
        by_model: dict[str, dict] = {}
        by_scope: dict[str, dict] = {}
        total = _blank()
        for i in range(days):
            day = _day(now - i * 86400)
            for r in self._read_day(day):
                for bucket, key in ((by_day, day), (by_model, r.get("model", "?")),
                                    (by_scope, (r.get("scope") or "?").split(":")[0])):
                    _add(bucket.setdefault(key, _blank()), r)
                _add(total, r)
        return {"days": days, "total": total, "by_day": by_day,
                "by_model": by_model, "by_scope": by_scope}

    def for_scope(self, scope_prefix: str, days: int = 30) -> dict:
        now = time.time()
        agg = _blank()
        for i in range(days):
            for r in self._read_day(_day(now - i * 86400)):
                if (r.get("scope") or "").startswith(scope_prefix):
                    _add(agg, r)
        return agg


_meter: Optional[UsageMeter] = None


def meter(root: Path) -> UsageMeter:
    global _meter
    if _meter is None or _meter.root != root:
        _meter = UsageMeter(root)
    return _meter
