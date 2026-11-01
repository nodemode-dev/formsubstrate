import json
import time
from pathlib import Path

from app.core import workspace_root as ws
from app.services.library import activity, scoring
from app.services.library.paths import atomic_write, clean_name, workspace_dir

TEXT_MAX = 100_000
META_MAX = 8_000
DOCS_MAX = 5_000
HIT_TEXT = 800
DOC_TEXT = 400


def _folder() -> Path:
    return workspace_dir("collections")


def _file(collection: str) -> Path:
    return _folder() / f"{clean_name(collection, 'collection name')}.jsonl"


def _read(path: Path) -> list[dict]:
    out: list[dict] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return out
    for line in lines:
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if isinstance(rec, dict) and isinstance(rec.get("text"), str):
            out.append(rec)
    return out


def add_doc(collection: str, text: str, meta: dict | None = None) -> dict:
    if not isinstance(text, str) or not text.strip():
        raise ws.Refused(400, "a document needs some text")
    if len(text) > TEXT_MAX:
        raise ws.Refused(413, f"a document is at most {TEXT_MAX} characters")
    extra = meta if isinstance(meta, dict) else {}
    if len(json.dumps(extra, default=str)) > META_MAX:
        raise ws.Refused(413, "the metadata is too large")
    path = _file(collection)
    if sum(1 for _ in _read(path)) >= DOCS_MAX:
        raise ws.Refused(409, f"a collection holds at most {DOCS_MAX} documents")
    path.parent.mkdir(parents=True, exist_ok=True)
    rec = {"ts": time.time(), "text": text, "meta": extra}
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(rec, default=str) + "\n")
    activity.emit(f"add {path.stem}", "output", f"{len(text)} characters", "collections")
    return {"added": path.stem, "docs": sum(1 for _ in _read(path))}


def list_collections() -> list[dict]:
    folder = _folder()
    if not folder.is_dir():
        return []
    out = []
    for path in sorted(folder.glob("*.jsonl")):
        out.append({"name": path.stem, "docs": len(_read(path)), "updated": path.stat().st_mtime})
    return out


def search(collection: str, query: str, k: int = 4, mmr_lambda: float = 0.7) -> list[dict]:
    path = _file(collection)
    recs = _read(path)
    if not recs or not query.strip():
        return []
    k = max(1, min(int(k), 20))
    scores = scoring.score(query, [r["text"] for r in recs])
    cands = []
    for rec, value in zip(recs, scores):
        if value > 0:
            cands.append({"score": round(value, 3), "text": rec["text"], "terms": scoring.terms(rec["text"]), "meta": rec.get("meta") or {}, "ts": rec.get("ts", 0)})
    if not cands:
        return []
    cands.sort(key=lambda hit: -hit["score"])
    pool = cands[: max(k * 5, 20)]
    picked: list[dict] = []
    while pool and len(picked) < k:
        if not picked:
            picked.append(pool.pop(0))
            continue
        best_i, best_v = 0, -1e9
        for i, cand in enumerate(pool):
            spread = max(scoring.jaccard(cand["terms"], got["terms"]) for got in picked)
            value = mmr_lambda * cand["score"] - (1 - mmr_lambda) * spread
            if value > best_v:
                best_v, best_i = value, i
        picked.append(pool.pop(best_i))
    activity.emit(f"search {path.stem}", "tool", f"{len(picked)} hits for {query[:60]}", "collections")
    return [{"score": hit["score"], "text": hit["text"][:HIT_TEXT], "meta": hit["meta"], "ts": hit["ts"]} for hit in picked]


def list_docs(collection: str, limit: int = 50) -> list[dict]:
    path = _file(collection)
    if not path.is_file():
        raise ws.Refused(404, f"no collection {path.stem}")
    limit = max(1, min(int(limit), 200))
    recs = _read(path)[-limit:]
    return [{"ts": r.get("ts", 0), "text": r["text"][:DOC_TEXT], "meta": r.get("meta") or {}} for r in reversed(recs)]


def delete_collection(collection: str) -> dict:
    path = _file(collection)
    if not path.is_file():
        raise ws.Refused(404, f"no collection {path.stem}")
    path.unlink()
    activity.emit(f"delete {path.stem}", "exit", None, "collections")
    return {"removed": path.stem}


def clear_docs(collection: str) -> dict:
    path = _file(collection)
    if not path.is_file():
        raise ws.Refused(404, f"no collection {path.stem}")
    atomic_write(path, "")
    return {"cleared": path.stem}
