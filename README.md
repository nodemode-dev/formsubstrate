<h1 align="center">subform</h1>

<p align="center"><b>The Form family's developer workbench: a code editor in the family's shell that runs several Claude Code agents at once, each in its own git worktree, and shows what formslot already knows before an agent writes.</b></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.14.0-f97316" alt="version v0.14.0" />
  <img src="https://img.shields.io/badge/status-release-8b5cf6" alt="status release" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-555555" alt="license GPL 3.0" />
</p>

subform opens Form repositories, edits code with language servers and a debugger, hosts Claude Code sessions in terminal tabs and headless runs, reviews their changes hunk by hunk, and commits them under the family's identity and signing rules. It uses the formvis shell (splash, Home, menu bar, title bar, status bar, Preferences) and editor pieces from substrata, ported into a fresh repository.

**Status:** v0.14.0. v0.14.0 brings over substrata's Studio (a node canvas where agent graphs are built and run, View > Studio) with graph runs, a runs list and node inspector, recipes, triggers and approvals, cogentics, insight and a Console tab, and the library (collections, tools, plugins, MCP servers, an extension manager, blocks, an activity feed); a formslot card on Home; and a one-time carry-over of settings and secrets from the old substrataform name. See docs/PARITY.md. v0.13.0 showed an open permission gate as a banner in its terminal tab, gates a retried write again after Use or Adapt, keeps waivers in the engine, and logs any gate it had to skip. v0.12.0 added symbol search in the command palette (`@` for the file, `#` for the workspace), Bash gates for dd, curl, wget, rsync, archives and more, a readable `terminal_tail` of Claude Code, a quit guard for unsaved files, and the fix for the Vite parse error in the external link check. Phases F1 to F9 have landed, and v0.11.0 added Bash write gates (a PreToolUse lexer for common write forms and a PostToolUse check of what changed), a read-only `terminal_tail` MCP tool, New Form app templates whose desktop shells compile, external links that open in the system browser, and a faster slot card; signing and notarization on the owner's Mac and the formcompiler registry rows are the owner's steps (see `docs/RELEASE.md`). F1 to F4 gave: the engine skeleton, the root scripts and the desktop boot (splash, hidden build, reveal on `app_ready`); then the formvis shell (tokens and themes, title bar with menus and tools, document tab row, status bar, command palette, dialogs and toasts) with zero flash on first paint; then F3 and F4: Home (Start, Recent, Workspaces, Sessions), Preferences in eleven sections with secrets in the system keychain, and the workbench: open a folder, browse its files, edit and save in a CodeMirror 6 editor, and search across the workspace with ripgrep, with VS Code style word wrap on by default (Alt+Z). F5 added the terminal dock over a detached pty-host, so shells and Claude Code survive an engine restart, and agent sessions, each in its own git worktree, with a Sessions panel, a chat pane for headless runs and a Skills list. F6 added git: a Source Control panel for the workspace or any session, diff tabs and a review pane that accepts or rejects an agent's changes hunk by hunk and sends review comments back to the session, snapshots with rewind, and a commit wrapper that commits with your identity, strips attribution trailers and audits every commit, with Push and Sign and Push, which now audit every push and flag agent commits that skipped the hook. F7 brought formslot into the workbench: a status item with tokens saved, a slots panel with search, manifests and drift, provenance badges in review, an install offer, and permission gates that pause an agent session when it is about to rewrite an existing slot until you choose use, adapt or write; and Run and Debug for Python through debugpy, with breakpoints, stepping, call stack, variables and a debug console. F8 added language servers (TypeScript 7 and pyright, found on the system): hover, completion, diagnostics, go to definition, references, rename, format, an Outline and a Problems panel; a workspace's own servers and venv run only after you trust it. From substrata came the Substrata theme (the default for new installs), a right panel and an editor split with sashes, a file graph tab, a live Markdown preview, image, video, audio and PDF tabs, real folder and file pickers (typed paths only when Preferences allow them) and a developer Home. F9 completes the family: subform's own MCP server at `POST /mcp` (behind LocalGuard and a bearer token) with the stdio launcher `./subform mcp`, so agents can reach the workbench; the harness skill pack under `.claude/skills/subform-harness/` that routes an agent around this repository; packaging with `setup/freeze_backend` (the engine frozen with PyInstaller) and `build_app` (the Tauri desktop app), with a Linux `.deb` built and cold-started here; Clone repo and New Form app on Home; and a right panel. Headless sessions now run with a per-session permission mode (accept edits inside the worktree by default), commits say which identity they used, and a workspace that formslot has not indexed says so. The plan of record ships in the planning sidecar zip.

## Quick start

New users: double-click `Install subform.command` on macOS (the first time, right-click it and choose Open, because macOS asks before it runs a downloaded file) or `Install subform.bat` on Windows. The window installs subform, then offers to start it and stays open. On Home, the formslot card then installs and sets up formslot for you, and adds each project you open with one click.

From a terminal:

```bash
./subform_oc_install     # backend venv and frontend packages
./subform                # engine on 127.0.0.1:5655, window on localhost:5650
./subform doctor         # toolchain, installs and ports
frontend/node_modules/.bin/tauri dev   # the desktop window, from the repository root
```

| Port | Use |
| --- | --- |
| 5650 | Vite dev server (localhost only) |
| 5651 | Vite preview |
| 5655 | engine in development; the desktop engine binds a free port |

## Licence

GPL-3.0-only. Copyright (C) 2026 NodeAgentc, Inc. See `LICENSE`. Code ported from formvis (Apache-2.0) and substrata (MIT) keeps its notices in `NOTICE.md` when it lands.
