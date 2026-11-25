# Feature parity: substrata to formsubstrate

Reference: substrata (MIT, the owner's). Target: formsubstrate (this repository). Written for build turn 11 (v0.14.0). Status words:

- **present**: already in formsubstrate, with the formsubstrate file.
- **ported (parity)**: ported this turn by the named agent into the named place.
- **ported (turn 11, parity agent)**: ported by the parity agent, files listed.
- **not ported**: decided against, with the reason.

Ports owned by other agents this turn: port-studio (Studio canvas), port-runs (runs, runner, inspector), port-recipes (recipes, automation, triggers, approvals), port-insight (cogentics, console, insight), port-library (collections, tools, plugins, manager, blocks, activity). Rows marked with an agent name were that agent's to land.

Re-checked against the tree at v0.25.1 (22 November 2026): every row that said "being ported" or "(planned)" was compared with the files that exist, and is now marked **present** with those files, or **not ported** where nothing landed. Files added since v0.20.0 are named in the row they belong to. Editor work that has no substrata counterpart and so no row here (folding in `ui/editor/folding.ts`, bracket colours in `brackets.ts`, extra cursors in `cursors.ts`, auto save and format on save in `ui/editor/editor.ts`) is described in `docs/GUIDE.md`.

## Frontend extensions (`frontend/src/extensions/*` in substrata)

| substrata extension | Status | formsubstrate file or owner |
| --- | --- | --- |
| activity | present | extensions/activity/index.ts, panel.ts; services/library/activity.py |
| approvals | present | extensions/approvals/index.ts, client.ts |
| automation | present | extensions/automation/index.ts |
| blocks | present | extensions/blocks/index.ts, panel.ts, registry.ts, snippets.ts |
| chat (navigator agent drawer) | not ported | see decision D1 |
| claude-code (CLI card, open session) | present | extensions/sessions/index.ts, ui/new-session.ts, ui/terminal-dock.ts, Home tile "Claude terminal", Preferences > Agents. Since v0.25.0 also the other agent programs (Codex, Cursor, Antigravity: io/agents.ts, routers/agents.py, services/agent_programs.py, services/agent_lookup.py) and the Claude Code editor connection, off by default (ui/ide-link.ts, routers/ide.py, services/ide_link.py) |
| cogentics | present | extensions/cogentics/index.ts, panel.ts, ledger.ts, members.ts, rich.ts, insight.ts; io/cogentics.ts |
| collections | present | extensions/collections/index.ts, panel.ts |
| command-palette | present | ui/command-palette.ts, ui/palette/fuzzy.ts, ui/palette/symbols.ts, ui/palette/files.ts (Go to File) |
| console | present | extensions/console/index.ts, pane.ts |
| debug | present | extensions/debug/index.ts, extensions/debug/launch.ts (the launch file and its picker), io/debug.ts, ui/editor/breakpoints.ts (with conditional breakpoints, hit counts and logpoints) |
| files | present | extensions/files/index.ts, ui/home-files.ts, ui/path-picker.ts |
| git | present | extensions/git/index.ts, ui/review/* (a larger review and commit wrapper than substrata's), extensions/git/refs.ts (branches, stashes, tags), extensions/git/history.ts (file history), ui/editor/conflicts.ts (merge conflicts) |
| graphs (graph list and open) | present | extensions/studio/index.ts (saved graphs), io/studio.ts, routers/graphs.py; the file graph lives in ui/graph/* |
| inspector | present, not as its own extension | ui/inspector/index.ts, fields.ts (the Node tab, mounted by extensions/runs/index.ts) |
| lsp | present | extensions/lsp/index.ts, ui/editor/lsp.ts, io/lsp.ts, ui/editor/code-actions.ts (quick fixes and source actions), ui/editor/lsp-edits.ts, ui/editor/lsp-workspace.ts |
| manager (extension manager) | present | extensions/manager/index.ts, extensions-view.ts, plugins-view.ts, mcp-view.ts, parts.ts; enable and disable in registry.ts |
| markdown-preview | present | ui/preview/md-preview.ts, ui/preview/markdown.ts, ui/preview/sanitize.ts |
| palette (+ node menu) | present, inside the Studio | ui/studio/studio-view.ts, canvas.ts, context-menu.ts |
| plugins | present | extensions/plugins/index.ts, extensions/manager/plugins-view.ts |
| preview (images, media, html) | present | ui/preview/index.ts, media-tab.ts, media.ts, external.ts; routers/media.py |
| recipes | present | extensions/recipes/index.ts, client.ts, dialogs.ts |
| runner | present, folded into runs | extensions/runs/index.ts (the Runs tab starts a run), io/runs.ts |
| runs | present | extensions/runs/index.ts, io/runs.ts |
| search | present | extensions/search/index.ts (also a palette search provider), extensions/search/preview-diff.ts (replace across files, previewed per file); services/textsearch.py is the search used when ripgrep is not installed |
| settings (workspace, wrap, theme kit) | present, partly | ui/settings.ts (Preferences: theme, accent, intensity, word wrap, trust, keys, Claude Code model, API key, commits; since then also auto save, format on save, agent programs, Route through FormNET, MCP clients, and the Keys page in ui/keys-page.ts with io/keybindings.ts and routers/keybindings.py). Model provider, embeddings and MCP servers: see D3 |
| skills (skills index in the sidebar) | present | routers/skills.py and io/sessions.ts list Claude Code skills (`.claude/skills`, `~/.claude/skills`) for sessions; the shipped skill is D4 |
| system (platform status, harness export and import) | ported (turn 11, parity agent) | extensions/system/index.ts, routers/harness.py; command `system-status`, Help menu |
| terminal | present | ui/terminal-dock.ts, io/terminals.ts, routers/terminal.py; tasks run in a tab of the same dock (ui/tasks.ts, io/tasks.ts) |
| tools | present | extensions/tools/index.ts, panel.ts |
| triggers | present | extensions/triggers/index.ts, client.ts, dialogs.ts |
| welcome (first-run wizard) | ported (turn 11, parity agent) | extensions/welcome/index.ts; command `welcome`, Help menu; see D2 |
| workspace | present | ui/workspace-store.ts, io/workspace.ts, routers/workspace.py, core/workspace_root.py, ui/open-folder.ts |
| ndjson.ts (stream helper) | not needed here | formsubstrate streams sessions over its own SSE client (io/sessions.ts); port-runs brings its own if it needs one |

## Backend routers (`backend/app/routers/*` in substrata)

| substrata router | Status | formsubstrate file or owner |
| --- | --- | --- |
| chat.py | not ported | D1 |
| cogentics.py | present | routers/cogentics.py, services/cogentics/* |
| collections.py | present | routers/collections.py, services/library/collections.py |
| dap.py | present | routers/debug.py, core/debug.py, core/debug_launch.py (the launch file, read only in a trusted workspace) |
| extensions.py (install, git install of UI extensions) | not ported | formsubstrate extensions are compiled in and the manager only enables and disables them; no install route exists |
| git.py | present | routers/git.py, services/gitops.py (added after v0.20.0: branches, fetch, pull, stashes, tags, conflicts and file history) |
| harness.py | ported (turn 11, parity agent) | routers/harness.py (`.formsubstrate/` tree; import needs the window token) |
| insight.py | present | routers/insight.py |
| lsp.py | present | routers/lsp.py, core/lsp.py, core/lsp_custom.py (custom servers), core/trust.py (the engine's record of workspace trust) |
| mcp.py (substrata as MCP server) | present, different server | routers/mcp.py, services/mcp_tools.py, docs/MCP.md (formsubstrate's own MCP server, behind LocalGuard and a bearer token) |
| mcp_servers.py (client connections) | present | routers/mcp_servers.py, services/library/mcp_client.py; see D3 |
| plugins.py | present | routers/plugins.py, services/library/plugins.py |
| presets.py (graph and skill presets, plugin catalog) | ported: sf-presets | routers/presets.py over services/presets: one service with four groups (graphs, recipes, plugins, skills) at `/api/presets/{group}`; plugin presets install into .formsubstrate/plugins only by an owner action with the workspace trusted, skill presets into .claude/skills by an owner action; `/api/graphs/presets` stays as an alias. Dropped: the navi_notify catalog plugin (a Navi overlay on a fixed port, not a Form family tool), install-from-URL (runs fetched code), and plugin disable, enable and uninstall (already served by `/api/plugins`) |
| preview.py | present | routers/media.py |
| recipes.py | present | routers/recipes.py, services/recipes/* |
| run.py, runs.py | present | routers/runs.py, services/runs/* |
| terminal.py | present | routers/terminal.py, services/ptyhost_client.py; tasks (routers/tasks.py, services/tasks.py) run in terminals, and services/formnet.py sets the proxy variables of new terminals when Route through FormNET is on |
| tools.py | present | routers/tools.py, services/library/registry.py |
| trigger_routes.py | present | routers/triggers.py, services/triggers/* |
| workspace.py | present | routers/workspace.py, services/textsearch.py (search without ripgrep; replace across files is `/workspace/replace/preview` and `/workspace/replace`) |

## Skills under `backend/skills`

| substrata skill | Status | formsubstrate file |
| --- | --- | --- |
| substrata-graphs | ported (turn 11, parity agent) | backend/skills/formsubstrate-graphs/SKILL.md (see D4) |

## Product surfaces named in the brief

| Surface | Status | formsubstrate file or note |
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
| Studio canvas, runs, recipes, triggers, approvals, insight, library | present | ui/studio/*, extensions/runs, recipes, triggers, approvals, cogentics/insight.ts, and the library panels (collections, tools, plugins, manager, blocks, activity) |
| Tasks, changeable shortcuts (no substrata counterpart) | present since v0.25.0 | ui/tasks.ts, services/tasks.py; ui/keys-page.ts, routers/keybindings.py |

## Summary count

Of 33 substrata frontend extensions: 30 present (13 at turn 11, and the 17 the five other agents have since landed, of which graphs and palette are folded into the Studio, runner into runs, and inspector into `ui/inspector`), 2 ported by the parity agent (system, welcome), 1 not ported (chat). Of 21 backend routers: 17 present (7 at turn 11, 10 landed since), 1 ported by the parity agent (harness), 1 ported by sf-presets (presets, now unified), 2 not ported (chat, extensions). The one shipped skill is ported. The count of "present" rows is by extension or router name, not a measure of depth: formsubstrate's git review, terminal and gates are larger than substrata's, while Studio, runs, recipes and triggers did not exist until this turn.

## Decisions on items nobody else owns

- **D1 chat, not ported.** Substrata's chat drawer talks to a built-in navigator agent that needs a model client in the engine. formsubstrate is a workbench for Claude Code: the conversation with an agent happens in a Claude Code session (terminal dock for interactive ones, `ui/chat-pane.ts` transcript for headless ones), which already has file, shell and review access in its own worktree. A second built-in agent loop would duplicate that and add a key and a model client to the engine. If a model-backed assistant is wanted later it should be a session type, not a drawer.
- **D2 welcome, ported as a readiness check.** Substrata's wizard picked a model provider because its agents needed one. formsubstrate has no provider of its own; what a new user needs is to know the engine, git and the `claude` command are found, whether an API key is in the keychain, and that a workspace is open. The dialog shows exactly that, opens once on first run when no workspace is open (flag `formsubstrate.welcomed.v1`), and is always available as `Help > Welcome`. It sits beside Home, not inside it, because the onboarding agent is editing Home this turn.
- **D3 settings: model provider, embeddings, MCP client servers, not ported by the parity agent.** Provider and embedding settings belong to the model layer that port-library's tools router and the runner (port-runs) bring; they are exposed in Preferences only when those land, since Preferences is the one place for settings and the owner of that page is the shell. MCP client connections (`mcp_servers.py`) are with port-library. Claude Code sessions take their MCP servers from the session `mcp.json` that formsubstrate writes, so the Preferences page needs no server list for them.
- **D4 skill shipped as a skill.** `formsubstrate-graphs` is the substrata-graphs text with the folder renamed to `.formsubstrate/`. It is a standard `SKILL.md`, so a Claude Code session can use it by copying it into `.claude/skills`. `GET /api/skills` (`routers/skills.py` `list_all`) lists it: after the workspace `.claude/skills` and the user's `~/.claude/skills` (`services/sessions.py` `list_skills`) it scans `backend/skills` and, in a frozen engine, `_MEIPASS/skills` (`builtin_folders`), marks those skills `built-in` and skips a name already listed with that source, so the window's skills list in the sessions panel (`io/sessions.ts`) shows `formsubstrate-graphs`. Listing is all it does: nothing copies the file into a session's worktree or `.claude/skills`, so a session uses it only once someone copies it there.
- **D5 harness.** Export and import of the `.formsubstrate/` tree as one JSON file fits formsubstrate (share a whole setup between workspaces). Import is an owner-only state change and so requires the window token, and it is previewed first: a manifest dialog lists every file as write, overwrite, skip or refuse before anything is written; the `runs` and `cogentics` groups are never imported and `plugins` is refused unless the workspace is trusted. Export is read only. Paths are confined to `.formsubstrate/` and checked against the workspace root; symlinks are skipped on export; limits are 400,000 bytes per file, 500 files and 4,000,000 bytes on import.
