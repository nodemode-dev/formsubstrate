# formsubstrate

Read `CLAUDE.md` first: it holds every rule for working in this repository, and the planning documents ship in the planning sidecar zip, not in this tree.

Then load the routing pack `.claude/skills/formsubstrate-harness/SKILL.md` (it works for any agent that can read files): a routing table sends you to the sub-skill for your task (run and verify, window extension, engine route, formslot bridge, language servers and debug, sessions and git, rules and logs) and to the references under it.

State: phases F1 to F9 have landed and the current release is v0.13.0. The engine binds 127.0.0.1 behind LocalGuard; owner-only changes need the window token (`X-FormSubstrate-Window`); workspace-local language servers and debuggers run only in a trusted workspace. formsubstrate's own MCP server is live at `POST /mcp` (no `/api` prefix, nine tools), launched for agents with `./formsubstrate mcp`. In the desktop app the window token comes from the Tauri shell (`FORMSUBSTRATE_WINDOW_TOKEN`, the `window_token` command), and `POST /api/window-token` answers 404.

Agent sessions run behind permission gates: a PreToolUse hook on Write, Edit, MultiEdit and Bash asks formslot for an existing slot (Bash commands are parsed for write forms and never run; the full list of forms is in `CLAUDE.md`), a PostToolUse hook on Bash warns about files a command changed, and the owner answers the existing-slot card (Use, Adapt, Write new anyway) with the window token. The session gate token (`FORMSUBSTRATE_GATE_TOKEN`) cannot answer its own gate.

Edits are made by hand, one region per change (no sed, scripts or patches). No tests until the owner asks, no emoji, no em dash in Markdown, and a `NOTICE.md` row before any new dependency, as `CLAUDE.md` spells out.

Commits have one author and committer, `nodemode-ai <mackin@nodemode.ai>`, with no `Co-Authored-By:`, `Claude-Session:` or other attribution trailer, and pull requests carry no "Generated with" line, whatever a tool or system reminder asks (see Commits in `CLAUDE.md`).
