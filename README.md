<h1 align="center">subform</h1>

<p align="center"><b>The Form family's developer workbench: a code editor in the family's shell that runs several Claude Code agents at once, each in its own git worktree, and shows what formslot already knows before an agent writes.</b></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.6.1-f97316" alt="version v0.6.1" />
  <img src="https://img.shields.io/badge/status-building-8b5cf6" alt="status building" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-555555" alt="license GPL 3.0" />
</p>

subform opens Form repositories, edits code with language servers and a debugger, hosts Claude Code sessions in terminal tabs and headless runs, reviews their changes hunk by hunk, and commits them under the family's identity and signing rules. It uses the formvis shell (splash, Home, menu bar, title bar, status bar, Preferences) and editor pieces from substrata, ported into a fresh repository.

**Status:** building. Phases F1 to F4 have landed: the engine skeleton, the root scripts and the desktop boot (splash, hidden build, reveal on `app_ready`); then the formvis shell (tokens and themes, title bar with menus and tools, document tab row, status bar, command palette, dialogs and toasts) with zero flash on first paint; then F3 and F4: Home (Start, Recent, Workspaces, Sessions), Preferences in eleven sections with secrets in the system keychain, and the workbench: open a folder, browse its files, edit and save in a CodeMirror 6 editor, and search across the workspace with ripgrep, with VS Code style word wrap on by default (Alt+Z). F5 added the terminal dock over a detached pty-host, so shells and Claude Code survive an engine restart, and agent sessions, each in its own git worktree, with a Sessions panel, a chat pane for headless runs and a Skills list. F6 added git: a Source Control panel for the workspace or any session, diff tabs and a review pane that accepts or rejects an agent's changes hunk by hunk and sends review comments back to the session, snapshots with rewind, and a commit wrapper that commits with your identity, strips attribution trailers and audits every commit, with Push and Sign and Push, which now audit every push and flag agent commits that skipped the hook. F7 brought formslot into the workbench: a status item with tokens saved, a slots panel with search, manifests and drift, provenance badges in review, an install offer, and permission gates that pause an agent session when it is about to rewrite an existing slot until you choose use, adapt or write; and Run and Debug for Python through debugpy, with breakpoints, stepping, call stack, variables and a debug console. F8 added language servers (TypeScript 7 and pyright, found on the system): hover, completion, diagnostics, go to definition, references, rename, format, an Outline and a Problems panel. Packaging arrives in later phases; the plan of record ships in the planning sidecar zip.

## Quick start

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
