import re
import urllib.parse
import urllib.request

from app.services.library.registry import Tool

PLUGIN = {
    "name": "web-search",
    "version": "1.0.0",
    "kind": "plugin",
    "description": "Web search through the DuckDuckGo HTML endpoint, standard library only.",
}

RESULT = re.compile(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?(?:class="result__snippet"[^>]*>(.*?)</a>)?', re.S)


def strip(text):
    return re.sub(r"<[^>]+>", "", text).strip()


def search(query, max_results=5):
    url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={"User-Agent": "formsubstrate/0.17"})
    try:
        with urllib.request.urlopen(req, timeout=12) as res:
            html = res.read().decode("utf-8", "ignore")
    except Exception as err:
        return [{"error": f"search failed: {err}"}]
    out = []
    for m in RESULT.finditer(html):
        href, title, snippet = m.group(1), m.group(2), m.group(3) or ""
        if "duckduckgo.com/y.js" in href:
            continue
        if href.startswith("//duckduckgo.com/l/?uddg="):
            href = urllib.parse.unquote(href.split("uddg=")[1].split("&")[0])
        out.append({"title": strip(title), "url": href, "snippet": strip(snippet)[:220]})
        if len(out) >= max(1, min(20, max_results)):
            break
    return out or [{"error": "no results parsed; the endpoint may have changed"}]


def register(host):
    host.tools.register(Tool(
        name="web_search",
        description="Search the web. Returns a list of title, url and snippet.",
        parameters={"type": "object", "properties": {"query": {"type": "string"}, "max_results": {"type": "integer"}}, "required": ["query"]},
        fn=lambda query, max_results=5: search(query, int(max_results)),
    ), replace=True)
