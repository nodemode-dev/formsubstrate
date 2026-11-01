<h1 align="center">subform</h1>

<p align="center"><b>The Form family's developer workbench: a code editor in the family's shell that runs several Claude Code agents at once, each in its own git worktree, and shows what formslot already knows before an agent writes.</b></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.1.1-f97316" alt="version v0.1.1" />
  <img src="https://img.shields.io/badge/status-building-8b5cf6" alt="status building" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-555555" alt="license GPL 3.0" />
</p>

subform opens Form repositories, edits code with language servers and a debugger, hosts Claude Code sessions in terminal tabs and headless runs, reviews their changes hunk by hunk, and commits them under the family's identity and signing rules. It uses the formvis shell (splash, Home, menu bar, title bar, status bar, Preferences) and editor pieces from substrata, ported into a fresh repository.

**Status:** building. Phase F1 has landed: the engine skeleton, the root scripts and the desktop boot (splash, hidden build, reveal on `app_ready`). The editor, terminals and agents arrive in later phases; the plan of record ships in the planning sidecar zip.

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
