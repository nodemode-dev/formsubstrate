from datetime import datetime, timedelta, timezone

from app.services.library.registry import Tool

PLUGIN = {
    "name": "clock",
    "version": "1.0.0",
    "description": "Current date and time tools, with an optional fixed UTC offset in hours.",
    "kind": "connector",
    "settings": [
        {"name": "utc_offset", "label": "UTC offset in hours", "type": "text", "default": "0", "placeholder": "0"},
        {"name": "label", "label": "Label added to every answer", "type": "text", "default": ""},
    ],
}


def register(host, settings):
    try:
        offset = float(settings.get("utc_offset") or 0)
    except ValueError:
        offset = 0.0
    zone = timezone(timedelta(hours=max(-14.0, min(14.0, offset))))
    label = settings.get("label", "")

    def now(fmt: str = "%Y-%m-%d %H:%M:%S") -> dict:
        stamp = datetime.now(zone)
        return {"now": stamp.strftime(fmt), "iso": stamp.isoformat(), "label": label}

    def days_between(start: str, end: str) -> dict:
        a = datetime.fromisoformat(start)
        b = datetime.fromisoformat(end)
        return {"days": (b - a).days}

    host.tools.register(Tool(
        name="clock_now",
        description="The current date and time in the configured UTC offset.",
        parameters={"type": "object", "properties": {"fmt": {"type": "string", "description": "strftime format"}}},
        fn=now,
    ))
    host.tools.register(Tool(
        name="clock_days_between",
        description="Whole days between two ISO dates.",
        parameters={"type": "object", "properties": {"start": {"type": "string"}, "end": {"type": "string"}}, "required": ["start", "end"]},
        fn=days_between,
    ))
