import asyncio
import inspect
import json
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    fn: Callable[..., Any]
    source: str = "builtin"
    extra: dict = field(default_factory=dict)

    def definition(self) -> dict:
        return {
            "type": "function",
            "source": self.source,
            "function": {"name": self.name, "description": self.description, "parameters": self.parameters},
        }


class Registry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool, replace: bool = False) -> None:
        if tool.name in self._tools and not replace:
            raise ValueError(f"duplicate tool: {tool.name}")
        self._tools[tool.name] = tool

    def unregister_source(self, source: str) -> int:
        victims = [name for name, tool in self._tools.items() if tool.source == source]
        for name in victims:
            del self._tools[name]
        return len(victims)

    def unregister_source_prefix(self, prefix: str) -> int:
        victims = [name for name, tool in self._tools.items() if tool.source.startswith(prefix)]
        for name in victims:
            del self._tools[name]
        return len(victims)

    def names(self) -> list[str]:
        return list(self._tools)

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def definitions(self) -> list[dict]:
        return [tool.definition() for tool in self._tools.values()]

    async def call(self, name: str, args: dict) -> Any:
        tool = self._tools.get(name)
        if tool is None:
            return {"error": f"unknown tool: {name}"}
        required = (tool.parameters or {}).get("required") or []
        missing = [key for key in required if key not in args]
        if missing:
            return {"error": f"missing required argument: {', '.join(missing)}"}
        try:
            if inspect.iscoroutinefunction(tool.fn):
                return await tool.fn(**args)
            result = await asyncio.to_thread(tool.fn, **args)
            if inspect.isawaitable(result):
                result = await result
            return result
        except Exception as error:
            return {"error": f"{error.__class__.__name__}: {error}"}


def jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


tools = Registry()


class Host:
    def __init__(self, registry: Registry, source: str) -> None:
        self._registry = registry
        self._source = source
        self.tools = self

    def register(self, tool: Tool, replace: bool = False) -> None:
        tool.source = self._source
        self._registry.register(tool, replace)
