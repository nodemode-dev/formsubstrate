import json
import sys
from pathlib import Path

USAGE = "usage: agents.py sync [--check] [--root DIR]"
REFERENCE = Path(".claude") / "skills" / "formsubstrate-harness" / "references" / "tools.md"


def tools(root: Path) -> list[dict]:
    sys.path.insert(0, str(root / "backend"))
    from app.services.mcp_tools import TOOLS

    return TOOLS


def hints(annotations: dict) -> str:
    return ", ".join(f"`{key}` {json.dumps(value)}" for key, value in annotations.items() if key != "title") or "none"


def reference(items: list[dict]) -> str:
    out = [
        "# Substrate MCP tools",
        "",
        "Generated from `TOOLS` in `backend/app/services/mcp_tools.py` by `./formsubstrate agents sync`; do not edit by hand. `./formsubstrate agents sync --check` fails when this file and `TOOLS` differ.",
        "",
        "## Contents",
        "",
    ]
    out += [f"- `{tool['name']}`: {tool['title']}" for tool in items]
    out.append("")
    for tool in items:
        out += [
            f"## {tool['name']}",
            "",
            f"Title: {tool['title']}",
            "",
            tool["description"],
            "",
            f"Annotations: {hints(tool.get('annotations', {}))}",
            "",
            "Input schema:",
            "",
            "```json",
            json.dumps(tool["inputSchema"], indent=2, ensure_ascii=False),
            "```",
            "",
        ]
    return "\n".join(out)


def sync(root: Path, check: bool) -> int:
    target = root / REFERENCE
    want = reference(tools(root))
    have = target.read_text(encoding="utf-8") if target.is_file() else None
    shown = REFERENCE.as_posix()
    if check:
        if have == want:
            print(f"[formsubstrate] agents: {shown} matches TOOLS")
            return 0
        print(f"[formsubstrate] agents: {shown} differs from TOOLS in backend/app/services/mcp_tools.py; run ./formsubstrate agents sync and commit the result", file=sys.stderr)
        return 1
    if have == want:
        print(f"[formsubstrate] agents: {shown} already matches TOOLS")
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(want, encoding="utf-8", newline="\n")
    print(f"[formsubstrate] agents: wrote {shown}")
    return 0


def main(argv: list[str]) -> int:
    if not argv or argv[0] != "sync":
        print(USAGE, file=sys.stderr)
        return 2
    rest = argv[1:]
    root = Path(__file__).resolve().parent.parent
    check = False
    while rest:
        arg = rest.pop(0)
        if arg == "--check":
            check = True
        elif arg == "--root" and rest:
            root = Path(rest.pop(0)).resolve()
        else:
            print(f"[formsubstrate] agents: unknown argument {arg}\n{USAGE}", file=sys.stderr)
            return 2
    return sync(root, check)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
