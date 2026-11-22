import json
from typing import Any, Awaitable, Callable, Optional

import httpx
import keyring
from keyring.errors import KeyringError

from app.core import config

PROVIDER_BASES = {
    "openrouter": "https://openrouter.ai/api/v1",
    "ollama": "http://localhost:11434/v1",
    "lmstudio": "http://localhost:1234/v1",
}
LOCAL_PROVIDERS = {"ollama", "lmstudio"}
KEY_SERVICE = "formsubstrate"
KEY_NAME = "cogentics-api-key"
OnDelta = Callable[[str], Awaitable[None]]


class LLMNotConfigured(Exception):
    pass


def _file():
    return config.data_dir() / "cogentics-provider.json"


class Client:
    def __init__(self) -> None:
        self.provider = "openrouter"
        self.base_url = PROVIDER_BASES["openrouter"]
        self.model = "openrouter/auto"
        self._key: Optional[str] = None
        self._loaded = False

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            d = json.loads(_file().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            d = {}
        if isinstance(d, dict):
            self.provider = d.get("provider") or self.provider
            self.base_url = (d.get("base_url") or self.base_url).rstrip("/")
            self.model = d.get("model") or self.model
        try:
            self._key = keyring.get_password(KEY_SERVICE, KEY_NAME)
        except KeyringError:
            self._key = None

    @property
    def api_key(self) -> Optional[str]:
        self._load()
        return self._key

    @property
    def configured(self) -> bool:
        self._load()
        if self.provider in LOCAL_PROVIDERS:
            return True
        if self.provider == "custom":
            return bool(self.base_url)
        return bool(self._key)

    def apply(self, *, provider: str = "", base_url: str = "", model: str = "", api_key: str = "") -> None:
        self._load()
        if provider:
            self.provider = provider
            self.base_url = PROVIDER_BASES.get(provider, self.base_url)
        if base_url:
            self.base_url = base_url.rstrip("/")
            if not provider:
                self.provider = "custom"
        if model:
            self.model = model
        if api_key:
            keyring.set_password(KEY_SERVICE, KEY_NAME, api_key)
            self._key = api_key
        _file().write_text(json.dumps({"provider": self.provider, "base_url": self.base_url, "model": self.model}), encoding="utf-8")

    def forget_key(self) -> None:
        self._load()
        try:
            keyring.delete_password(KEY_SERVICE, KEY_NAME)
        except KeyringError:
            return
        self._key = None

    def snapshot(self) -> dict:
        self._load()
        return {"provider": self.provider, "base_url": self.base_url, "model": self.model,
                "configured": self.configured, "has_key": bool(self._key)}

    def headers(self) -> dict:
        self._load()
        h = {"Content-Type": "application/json"}
        if self._key:
            h["Authorization"] = f"Bearer {self._key}"
        if self.provider == "openrouter":
            h["HTTP-Referer"] = "http://localhost:5650"
            h["X-Title"] = "Substrate"
        return h

    def _payload(self, messages: list[dict], tools: Optional[list[dict]], temperature: float,
                 stream: bool, model: Optional[str]) -> dict:
        payload: dict[str, Any] = {"model": model or self.model, "messages": messages, "temperature": temperature}
        if tools:
            payload["tools"] = tools
        if stream:
            payload["stream"] = True
            if self.provider == "openrouter":
                payload["stream_options"] = {"include_usage": True}
        return payload

    async def test_connection(self) -> dict:
        self._load()
        if not self.configured:
            return {"ok": False, "detail": "no key saved for this provider"}
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                res = await client.get(f"{self.base_url}/models", headers=self.headers())
            if res.status_code != 200:
                return {"ok": False, "detail": f"HTTP {res.status_code}"}
            models = [m.get("id", "") for m in res.json().get("data", [])][:50]
            return {"ok": True, "models": models}
        except (httpx.HTTPError, ValueError) as e:
            return {"ok": False, "detail": str(e)}

    async def chat(self, messages: list[dict], tools: Optional[list[dict]] = None,
                   temperature: float = 0.3, model: Optional[str] = None) -> dict[str, Any]:
        if not self.configured:
            raise LLMNotConfigured("configure a model provider")
        async with httpx.AsyncClient(timeout=120) as client:
            res = await client.post(f"{self.base_url}/chat/completions", headers=self.headers(),
                                    json=self._payload(messages, tools, temperature, False, model))
            res.raise_for_status()
            data = res.json()
        msg = data["choices"][0]["message"]
        if isinstance(msg, dict):
            msg["_usage"] = data.get("usage") or {}
            msg["_model"] = data.get("model") or (model or self.model)
        return msg

    async def stream_chat(self, messages: list[dict], tools: Optional[list[dict]] = None,
                          temperature: float = 0.3, on_delta: Optional[OnDelta] = None,
                          model: Optional[str] = None) -> dict[str, Any]:
        if not self.configured:
            raise LLMNotConfigured("configure a model provider")
        parts: list[str] = []
        calls: dict[int, dict] = {}
        usage: dict = {}
        served = model or self.model
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", f"{self.base_url}/chat/completions", headers=self.headers(),
                                     json=self._payload(messages, tools, temperature, True, model)) as res:
                res.raise_for_status()
                if "text/event-stream" not in res.headers.get("content-type", ""):
                    data = json.loads(await res.aread())
                    msg = data["choices"][0]["message"]
                    if msg.get("content") and on_delta:
                        await on_delta(msg["content"])
                    msg["_usage"] = data.get("usage") or {}
                    msg["_model"] = data.get("model") or served
                    return msg
                async for raw in res.aiter_lines():
                    line = raw.strip()
                    if not line.startswith("data:"):
                        continue
                    line = line[5:].strip()
                    if line == "[DONE]":
                        break
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("usage"):
                        usage = chunk["usage"]
                    if chunk.get("model"):
                        served = chunk["model"]
                    text = _delta(chunk, calls)
                    if text:
                        parts.append(text)
                        if on_delta:
                            await on_delta(text)
        msg: dict[str, Any] = {"role": "assistant", "content": "".join(parts) or None}
        if calls:
            msg["tool_calls"] = [calls[i] for i in sorted(calls)]
        msg["_usage"] = usage
        msg["_model"] = served
        return msg


def _delta(chunk: dict, calls: dict):
    choices = chunk.get("choices") or []
    if not choices:
        return None
    delta = choices[0].get("delta") or {}
    for tc in delta.get("tool_calls") or []:
        cur = calls.setdefault(tc.get("index", 0), {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
        if tc.get("id"):
            cur["id"] = tc["id"]
        fn = tc.get("function") or {}
        if fn.get("name"):
            cur["function"]["name"] = fn["name"]
        if fn.get("arguments"):
            cur["function"]["arguments"] += fn["arguments"]
    return delta.get("content")


client = Client()
