from app.core import workspace_root as ws
from app.services.library import activity, scoring
from app.services.library import collections as store
from app.services.library.registry import Tool, tools


def _guard(call):
    try:
        return call()
    except ws.Refused as err:
        return {"error": err.detail}


def _add_knowledge(collection: str, text: str, source: str | None = None, meta: dict | None = None, **extra) -> dict:
    merged = {**(meta or {}), **({"source": source} if source else {}), **extra}
    return _guard(lambda: store.add_doc(collection, text, merged))


def _search_knowledge(collection: str, query: str, k: int = 4) -> dict:
    return _guard(lambda: {"hits": store.search(collection, query, k)})


def _list_collections() -> dict:
    return _guard(lambda: {"collections": store.list_collections()})


def _search_capabilities(query: str, k: int = 6) -> dict:
    cands: list[dict] = []
    texts: list[str] = []
    for tool in tools._tools.values():
        cands.append({"type": "tool", "name": tool.name, "source": tool.source, "description": tool.description[:160]})
        texts.append(tool.name + " " + tool.description)
    try:
        for item in store.list_collections():
            cands.append({"type": "collection", "name": item["name"], "description": f"{item['docs']} documents; search with search_knowledge"})
            texts.append(item["name"] + " knowledge collection documents")
    except ws.Refused:
        pass
    for cand, value in zip(cands, scoring.score(query, texts)):
        cand["score"] = round(value, 3)
    cands.sort(key=lambda c: -c["score"])
    hits = [c for c in cands if c["score"] > 0]
    return {"results": (hits or cands)[: max(1, min(int(k), 20))]}


def install() -> None:
    tools.unregister_source("builtin")
    tools.register(Tool(
        name="add_knowledge",
        description="Store a text document in a named knowledge collection for later retrieval. Extra fields (source, tags) are kept as metadata.",
        parameters={"type": "object", "properties": {"collection": {"type": "string", "description": "lowercase name"}, "text": {"type": "string"}, "source": {"type": "string"}, "meta": {"type": "object"}}, "required": ["collection", "text"]},
        fn=_add_knowledge,
    ))
    tools.register(Tool(
        name="search_knowledge",
        description="Retrieve the most relevant documents from a knowledge collection.",
        parameters={"type": "object", "properties": {"collection": {"type": "string"}, "query": {"type": "string"}, "k": {"type": "integer"}}, "required": ["collection", "query"]},
        fn=_search_knowledge,
    ))
    tools.register(Tool(
        name="list_collections",
        description="List the knowledge collections of the open workspace with their document counts.",
        parameters={"type": "object", "properties": {}},
        fn=_list_collections,
    ))
    tools.register(Tool(
        name="search_capabilities",
        description="Find tools and knowledge collections by need.",
        parameters={"type": "object", "properties": {"query": {"type": "string"}, "k": {"type": "integer"}}, "required": ["query"]},
        fn=_search_capabilities,
    ))
    activity.emit("builtin tools", "enter", "4 tools registered", "tools")
