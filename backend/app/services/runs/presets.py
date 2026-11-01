import json
import os
from pathlib import Path

from app.core import workspace_root as ws
from app.services.runs import rt

PRESETS = Path(__file__).resolve().parents[3] / "presets" / "graphs"


def _frozen_dir() -> Path:
    import sys
    bundled = getattr(sys, "_MEIPASS", "")
    return Path(bundled) / "presets" / "graphs" if bundled else PRESETS


def list_presets() -> list[dict]:
    out = []
    folder = _frozen_dir()
    if not folder.is_dir():
        return out
    for f in sorted(folder.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            out.append({"name": f.stem, "description": data.get("description", ""),
                        "nodes": len(data["doc"]["nodes"]), "edges": len(data["doc"]["edges"])})
        except (OSError, ValueError, KeyError):
            continue
    return out


def read_preset(name: str) -> dict | None:
    safe = rt.safe_name(name)
    f = _frozen_dir() / f"{safe}.json"
    if not safe or not f.is_file():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def install(name: str) -> str | None:
    data = read_preset(name)
    if data is None:
        return None
    real, rel = ws.resolve(f"{rt.GRAPHS_DIR}/{rt.safe_name(name)}.json", write=True)
    os.makedirs(os.path.dirname(real), exist_ok=True)
    with open(real, "w", encoding="utf-8") as fh:
        json.dump(data["doc"], fh, indent=1)
    return rel
