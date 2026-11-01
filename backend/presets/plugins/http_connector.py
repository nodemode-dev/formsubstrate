import asyncio
import json as _json
import urllib.error
import urllib.parse
import urllib.request

from app.services.library.registry import Tool

PLUGIN = {
    "name": "http-connector",
    "version": "1.0.0",
    "kind": "connector",
    "description": "Configurable HTTP client (base URL and auth) as agent tools: call any REST API from agents, recipes and triggers.",
    "settings": [
        {"name": "base_url", "label": "Base URL", "type": "text", "default": "", "placeholder": "https://api.example.com"},
        {"name": "bearer_token", "label": "Bearer token (optional)", "type": "text", "default": "", "secret": True},
        {"name": "extra_headers", "label": "Extra headers (JSON object)", "type": "text", "default": "{}"},
        {"name": "timeout", "label": "Timeout seconds", "type": "text", "default": "20"},
    ],
}


def register(host, settings):
    base = str(settings.get("base_url", "")).rstrip("/")
    token = str(settings.get("bearer_token", ""))
    try:
        extra = _json.loads(str(settings.get("extra_headers") or "{}"))
    except _json.JSONDecodeError:
        extra = {}
    if not isinstance(extra, dict):
        extra = {}
    try:
        timeout = max(1.0, min(120.0, float(settings.get("timeout") or 20)))
    except (TypeError, ValueError):
        timeout = 20.0

    def resolve(url):
        if url.startswith(("http://", "https://")):
            return url
        if not base:
            raise ValueError("relative url but no base_url configured; set it in the plugin settings")
        return f"{base}/{url.lstrip('/')}"

    def call(url, method="GET", body="", headers=None, params=None):
        try:
            full = resolve(url)
        except ValueError as err:
            return {"error": str(err)}
        if params:
            full += ("&" if "?" in full else "?") + urllib.parse.urlencode(params)
        head = {"User-Agent": "subform-http-connector/1.0", **extra, **(headers or {})}
        if token and "Authorization" not in head:
            head["Authorization"] = f"Bearer {token}"
        data = body.encode() if body else None
        if data and "Content-Type" not in head:
            head["Content-Type"] = "application/json"
        req = urllib.request.Request(full, data=data, headers=head, method=method.upper())
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                text = res.read().decode("utf-8", "replace")
                return {"status": res.status, "headers": dict(res.headers), "body": text[:20000]}
        except urllib.error.HTTPError as err:
            return {"status": err.code, "body": err.read().decode("utf-8", "replace")[:4000]}
        except Exception as err:
            return {"error": f"request failed: {err}"}

    async def http_request(url, method="GET", body="", headers=None, params=None):
        return await asyncio.to_thread(call, url, method, body, headers, params)

    async def http_get_json(url, params=None):
        res = await asyncio.to_thread(call, url, "GET", "", None, params)
        if "error" in res:
            return res
        try:
            return {"status": res["status"], "json": _json.loads(res["body"])}
        except _json.JSONDecodeError:
            return {"status": res.get("status"), "error": "response was not JSON", "body": str(res.get("body", ""))[:1000]}

    host.tools.register(Tool(
        name="http_request",
        description="Call any HTTP endpoint. Relative urls resolve against the configured base_url; bearer auth applies when configured.",
        parameters={"type": "object", "properties": {
            "url": {"type": "string"},
            "method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"]},
            "body": {"type": "string"},
            "headers": {"type": "object"},
            "params": {"type": "object"}}, "required": ["url"]},
        fn=http_request), replace=True)
    host.tools.register(Tool(
        name="http_get_json",
        description="GET a JSON API and return the parsed document, using the configured base_url and auth.",
        parameters={"type": "object", "properties": {"url": {"type": "string"}, "params": {"type": "object"}}, "required": ["url"]},
        fn=http_get_json), replace=True)
