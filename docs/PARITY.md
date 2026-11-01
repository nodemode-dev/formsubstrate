# Feature parity: substrata to subform

Reference: substrata (MIT, the owner's, `/home/claude/ref2`). Target: subform (this repository). Written for build turn 11 (v0.14.0). Status words:

- **present**: already in subform, with the subform file.
- **ported (parity)**: ported this turn by the named agent into the named place.
- **ported (turn 11, parity agent)**: ported by the parity agent, files listed.
- **not ported**: decided against, with the reason.

Ports owned by other agents this turn: port-studio (Studio canvas), port-runs (runs, runner, inspector), port-recipes (recipes, automation, triggers, approvals), port-insight (cogentics, console, insight), port-library (collections, tools, plugins, manager, blocks, activity). Rows marked with an agent name are that agent's to land; this file records the intent and is not proof it has landed. Re-check the tree before relying on a row.

## Frontend extensions (`frontend/src/extensions/*` in substrata)

| substrata extension | Status | subform file or owner |
| --- | --- | --- |
| activity | being ported: port-library | extensions/activity (planned) |
| approvals | being ported: port-recipes | extensions/approvals (planned) |
| automation | being ported: port-recipes | extensions/automation (planned) |
| blocks | being ported: port-library | extensions/blocks (planned) |
| chat (navigator agent drawer) | not ported | see decision D1 |
| claude-code (CLI card, open session) | present | extensions/sessions/index.ts, ui/new-session.ts, ui/terminal-dock.ts, Home tile "Claude terminal", Preferences "Claude Code" |
| cogentics | being ported: port-insight | extensions/cogentics |
| collections | being ported: port-library | extensions/collections (planned) |
| command-palette | present | ui/command-palette.ts, ui/palette/fuzzy.ts, ui/palette/symbols.ts |
| console | being ported: port-insight | extensions/console |
| debug | present | extensions/debug/index.ts, io/debug.ts, ui/editor/breakpoints.ts |
| files | present | extensions/files/index.ts, ui/home-files.ts, ui/path-picker.ts |
| git | present | extensions/git/index.ts, ui/review/* (a larger review and commit wrapper than substrata's) |
| graphs (graph list and open) | being ported: port-studio | graph routes and Studio; the file graph already lives in ui/graph/* |
| inspector | being ported: port-runs | extensions/inspector (planned) |
| lsp | present | extensions/lsp/index.ts, ui/editor/lsp.ts, io/lsp.ts |
| manager (extension manager) | being ported: port-library | extensions/manager (planned); registry.ts already has enable and disable |
| markdown-preview | present | ui/preview/md-preview.ts, ui/preview/markdown.ts, ui/preview/sanitize.ts |
| palette (+ node menu) | being ported: port-studio | part of the Studio canvas |
| plugins | being ported: port-library | extensions/plugins (planned) |
| preview (images, media, html) | present | ui/preview/index.ts, media-tab.ts, media.ts, external.ts; routers/media.py |
| recipes | being ported: port-recipes | extensions/recipes (planned) |
| runner | being ported: port-runs | extensions/runner (planned) |
| runs | being ported: port-runs | extensions/runs (planned) |
| search | present | extensions/search/index.ts (also a palette search provider) |
| settings (workspace, wrap, theme kit) | present, partly | ui/settings.ts (Preferences: theme, accent, intensity, word wrap, trust, keys, Claude Code model, API key, commits). Model provider, embeddings and MCP servers: see D3 |
| skills (skills index in the sidebar) | present | routers/skills.py and io/sessions.ts list Claude Code skills (`.claude/skills`, `~/.claude/skills`) for sessions; the shipped skill is D4 |
| system (platform status, harness export and import) | ported (turn 11, parity agent) | extensions/system/index.ts, routers/harness.py; command `system-status`, Help menu |
| terminal | present | ui/terminal-dock.ts, io/terminals.ts, routers/terminal.py |
| tools | being ported: port-library | extensions/tools (planned) |
| triggers | being ported: port-recipes | extensions/triggers (planned) |
| welcome (first-run wizard) | ported (turn 11, parity agent) | extensions/welcome/index.ts; command `welcome`, Help menu; see D2 |
| workspace | present | ui/workspace-store.ts, io/workspace.ts, routers/workspace.py, core/workspace_root.py, ui/open-folder.ts |
| ndjson.ts (stream helper) | not needed here | subform streams sessions over its own SSE client (io/sessions.ts); port-runs brings its own if it needs one |

## Backend routers (`backend/app/routers/*` in substrata)

| substrata router | Status | subform file or owner |
| --- | --- | --- |
| chat.py | not ported | D1 |
| cogentics.py | being ported: port-insight | routers/cogentics (planned) |
| collections.py | being ported: port-library | routers/collections.py |
| dap.py | present | routers/debug.py, core/debug.py |
| extensions.py (install, git install of UI extensions) | being ported: port-library (manager) | with the manager; subform extensions are compiled in, so an install route needs a decision there |
| git.py | present | routers/git.py, services/gitops.py |
| harness.py | ported (turn 11, parity agent) | routers/harness.py (`.subform/` tree; import needs the window token) |
| insight.py | being ported: port-insight | routers/insight (planned) |
| lsp.py | present | routers/lsp.py, core/lsp.py |
| mcp.py (substrata as MCP server) | present, different server | routers/mcp.py, services/mcp_tools.py, docs/MCP.md (subform's own MCP server, behind LocalGuard and a bearer token) |
| mcp_servers.py (client connections) | being ported: port-library (mounted in main.py) | routers/mcp_servers.py; see D3 |
| plugins.py | being ported: port-library | routers/plugins.py |
| presets.py (graph and skill presets, plugin catalog) | split | plugin catalog and skill presets follow port-library; graph presets follow port-studio. Not claimed by the parity agent |
| preview.py | present | routers/media.py |
| recipes.py | being ported: port-recipes | routers/recipes.py |
| run.py, runs.py | being ported: port-runs | routers/runs (planned) |
| terminal.py | present | routers/terminal.py, services/ptyhost_client.py |
| tools.py | being ported: port-library | routers/tools.py |
| trigger_routes.py | being ported: port-recipes | routers/triggers (planned) |
| workspace.py | present | routers/workspace.py |

## Skills under `backend/skills`

| substrata skill | Status | subform file |
| --- | --- | --- |
| substrata-graphs | ported (turn 11, parity agent) | backend/skills/subform-graphs/SKILL.md (see D4) |

## Product surfaces named in the brief

| Surface | Status | subform file or note |
| --- | --- | --- |
| Welcome screen | ported, as a readiness check (D2) | extensions/welcome/index.ts; Home (ui/home.ts) stays the start page |
| Chat | not ported as a navigator; a transcript pane exists | ui/chat-pane.ts follows Claude Code session transcripts; see D1 |
| Claude Code lane | present | see claude-code above |
| System and settings | system ported; settings partly present | see system and settings above |
| Command palette | present | ui/command-palette.ts |
| Search | present | extensions/search/index.ts |
| Files, workspace | present | extensions/files, ui/workspace-store.ts |
| Git | present | extensions/git, ui/review |
| Debug | present | extensions/debug |
| LSP | present | extensions/lsp |
| Preview, Markdown preview | present | ui/preview/* |
| Terminal | present | ui/terminal-dock.ts |
| Studio canvas, runs, recipes, triggers, approvals, insight, library | being ported (agents above) | |

## Summary count

Of 33 substrata frontend extensions: 13 present, 2 ported by the parity agent (system, welcome), 17 being ported by the five other agents (of which graphs and palette are folded into the Studio), 1 not ported (chat). Of 21 backend routers: 7 present, 1 ported by the parity agent (harness), 11 being ported by the other agents, 1 not ported (chat), 1 split and unclaimed (presets). The one shipped skill is ported. The count of "present" rows is by extension or router name, not a measure of depth: subform's git review, terminal and gates are larger than substrata's, while Studio, runs, recipes and triggers did not exist until this turn.

## Decisions on items nobody else owns

- **D1 chat, not ported.** Substrata's chat drawer talks to a built-in navigator agent that needs a model client in the engine. subform is a workbench for Claude Code: the conversation with an agent happens in a Claude Code session (terminal dock for interactive ones, `ui/chat-pane.ts` transcript for headless ones), which already has file, shell and review access in its own worktree. A second built-in agent loop would duplicate that and add a key and a model client to the engine. If a model-backed assistant is wanted later it should be a session type, not a drawer.
- **D2 welcome, ported as a readiness check.** Substrata's wizard picked a model provider because its agents needed one. subform has no provider of its own; what a new user needs is to know the engine, git and the `claude` command are found, whether an API key is in the keychain, and that a workspace is open. The dialog shows exactly that, opens once on first run when no workspace is open (flag `subform.welcomed.v1`), and is always available as `Help > Welcome`. It sits beside Home, not inside it, because the onboarding agent is editing Home this turn.
- **D3 settings: model provider, embeddings, MCP client servers, not ported by the parity agent.** Provider and embedding settings belong to the model layer that port-library's tools router and the runner (port-runs) bring; they are exposed in Preferences only when those land, since Preferences is the one place for settings and the owner of that page is the shell. MCP client connections (`mcp_servers.py`) are with port-library. Claude Code sessions take their MCP servers from the session `mcp.json` that subform writes, so the Preferences page needs no server list for them.
- **D4 skill shipped as a skill.** `subform-graphs` is the substrata-graphs text with the folder renamed to `.subform/`. It is a standard `SKILL.md`, so a Claude Code session can use it by copying it into `.claude/skills`. The current skills scan (`services/sessions.py` `list_skills`) only looks in the workspace `.claude/skills` and the user's `~/.claude/skills`, so the file under `backend/skills` is not discovered by itself. port-library's tools and skills loader (or the Studio's graph agent runs) should read `backend/skills`; until then it is shipped data, not active.
- **D5 harness.** Export and import of the `.subform/` tree as one JSON file fits subform (share a whole setup between workspaces). Import is an owner-only state change and so requires the window token, and it is previewed first: a manifest dialog lists every file as write, overwrite, skip or refuse before anything is written; the `runs` and `cogentics` groups are never imported and `plugins` is refused unless the workspace is trusted. Export is read only. Paths are confined to `.subform/` and checked against the workspace root; symlinks are skipped on export; limits are 400,000 bytes per file, 500 files and 4,000,000 bytes on import.
