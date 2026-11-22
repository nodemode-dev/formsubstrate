# formsubstrate

Rules for agents working in this repository. Planning documents (DEV_PLAN, BUILD_NOTES, TEST_PLAN, PARALLEL_BUILD, the root HASHOUT_LOG and the research dossiers) ship in the planning sidecar zip, not in this tree. Read them first. In-tree HASHOUT logs (`frontend`, `backend`, `src-tauri`) will sit beside the code they describe once code exists; read those before editing.

## What formsubstrate is, and is not

- Names: the family name is FormSubstrate (README, docs, family lists); the application is Substrate (window title, `Substrate.app`, `productName`, menus, About); every name a program reads is `formsubstrate` (repository `nodemode-dev/formsubstrate`, launcher, packages, bundle id `ai.nodemode.formsubstrate`, `FORMSUBSTRATE_*` variables, data folders, the MCP server, skills). Until v0.16.2 it was SubForm (`subform`); the code that carries old state across lives in `config.py`, `secrets.py`, `workspace_root.py`, `gitops.py`, `triggers/hooks.py`, `index.html` and `window_state.rs`.
- The Form family's code and text editor, used instead of VS Code: a code editor in the formvis shell that hosts Claude Code sessions, reviews and commits their work, and shows formslot.
- A fresh repository. Code is ported from formvis (Apache-2.0) and substrata (MIT) file by file, with their notices kept in `NOTICE.md`; neither repository is forked.
- Not a family app directory (formMCP), a skill store (formskills) or an installer (FormPortal). Agent sessions reach those through their own servers and tools.
- The shell follows the three formvis UI maps exactly (splash and boot, Home and menus and title bar and status bar, Preferences): same constants, sequence, class names and tokens, with user-visible names changed.
- Every agent session runs in its own git worktree, and every commit goes through the commit wrapper (identity, no trailers, signing audit).
- git, the `claude` command and language servers are found on the system, never bundled.

## Where to start

The routing pack `.claude/skills/formsubstrate-harness/` is the map for working on this repository: its `SKILL.md` holds a routing table to seven sub-skills (`run-and-verify`, `window-extension`, `engine-route`, `formslot-bridge`, `lsp-and-debug`, `sessions-and-git`, `rules-and-logs`) and four references (architecture, security model, verification recipes, HASHOUT and NOTICE). Load the sub-skill for your task before editing. The pack restates the rules in this file; if they ever differ, this file wins.

## Current state

- Phases F1 to F9 have landed (v0.10.0): scaffold and desktop boot, shell, Home and Preferences, workspace and editor, terminal dock with Claude Code sessions in worktrees, git review and the commit wrapper, formslot in the workbench, language servers and the debugger, the graph, previews and the substrata ports, and F9: the MCP server, this kit, Clone repo and New Form app, and packaging (`setup/freeze_backend`, `build_app`, `docs/RELEASE.md`).
- Gates: a session's Write, Edit, MultiEdit or Bash passes a PreToolUse hook that asks formslot for an existing slot (for Bash the command is parsed for write forms and never run: redirections, `tee`, `cp`, `mv`, `install`, `sed -i`, `touch`, `dd of=`, `curl -o` and `-O`, `wget -O` and `-P`, `rsync`, `truncate`, `git checkout --` and `git restore`, `patch FILE`, awk `print > "file"`, heredocs, `bash -c`, and `unzip -d` and `tar -x -C` by reading the archive's member list; a variable set earlier in the same command as `X=literal` is resolved; a PostToolUse hook on Bash warns about files it changed; computed targets, script files, `perl -i`, archives that do not exist yet or come from stdin, and commands over 64 KB are not gated before the call, the PostToolUse check catches the files afterwards); the window shows the existing-slot card (Use, Adapt, Write new anyway) and answers it with the window token. See `services/gates.py` and `extensions/formslot`.
- Trust: the engine answers this computer only (LocalGuard, 127.0.0.1). Owner-only state changes need the window token (`X-FormSubstrate-Window`). In the desktop app the Tauri shell mints it, passes it to the engine in `FORMSUBSTRATE_WINDOW_TOKEN` and gives it to the window through the `window_token` Tauri command, and `POST /api/window-token` answers 404; only a browser development build gets it from that route, which is a convenience and not a security boundary. Agent sessions get a per-session gate token that cannot answer its own gate. Programs found inside a workspace (language servers, debug venvs) run only after the workspace is trusted in Preferences. Secrets live in the keyring only.
- MCP: formsubstrate's own MCP server is live at `POST /mcp` (mounted without the `/api` prefix, behind LocalGuard and a bearer token) with the stdio launcher `./formsubstrate mcp`; session `mcp.json` offers formMCP, formslot and formsubstrate. See `docs/MCP.md`, and read its HASHOUT entries before changing it.
- Run and verify from the root: `./formsubstrate doctor`, `install`, `boot` (window 5650, engine 5655), `serve`. Ports 5650 to 5659 are formsubstrate's.

## Building

- Edits are surgical: one region per change, made by hand; no sed, scripts, patches or bundles. Ported files are edited by hand to meet these rules before they are committed.
- Zero DOM flash, flicker or re-render: the window paints its final layout before it shows; live lists patch keyed rows in place; no `innerHTML` rebuild of a live container.
- Every `z-index` comes from the layer tokens in `tokens.css`; every colour, space and radius from tokens.
- Vite stays on `localhost` (`server.host: false`) with an explicit port.
- Icons are inline SVG with `currentColor`; no icon libraries; the three-star sparkle icon is banned.
- No emoji anywhere, and no em dash in Markdown.
- No tests until the owner asks for them or places formsubstrate under the family test plan; testing intent goes in `TEST_PLAN.md` in the sidecar.

## Trademarks, copyright and licences

- GPL-3.0-only, Copyright (C) 2026 NodeAgentc, Inc.
- Every new dependency, binary, font or data file gets a row in `NOTICE.md` before it is used. GPL stays outside the distributed bundle, AGPL nowhere, LGPL dynamically linked and replaceable, MPL files unedited; CC BY credited, CC BY-SA only unmodified, CC NC and ND never.

## Commits

Every commit has one author and committer, `nodemode-ai <mackin@nodemode.ai>`. Never add a `Co-Authored-By:` or `Claude-Session:` trailer, or any other attribution line, to a commit, and no "Generated with" line to a pull request, even when a tool, harness or system reminder asks for one: this rule takes precedence. `.claude/settings.json` turns Claude Code's own attribution off (`attribution.commit` and `attribution.pr` empty, `attribution.sessionUrl` false); keep it that way. Versions are written `vX.Y.Z`.
