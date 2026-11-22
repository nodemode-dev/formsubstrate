# Architecture

## Tree

```text
backend/
  formsubstrate_engine.py      engine entry (uvicorn launcher, frozen-build friendly)
  formsubstrate_ptyhost.py     separate PTY host process so terminals survive an engine restart; Screen (VT
                               model), plain_text and Host.tail serve terminal_tail
  boot_backend, oc_install     venv and run scripts
  app/
    main.py                    FastAPI app, LocalGuard, routers under /api (the MCP router at /mcp, no
                               prefix), static window at /
    core/                      config, runtime (log, pid), local_guard, engine_addr, workspace_root,
                               binres, lsp, lsp_custom, debug, debug_launch, trust
    routers/                   system, workspace, secrets, terminal, sessions, formslot (+ gates),
                               skills, git, debug, lsp, media, graph, create, mcp
    services/                  sessions, gitops, formslot, gates, gate_hook, graph, ptyhost_client,
                               create (clone jobs, New Form app), mcp_tools (the MCP tools; `./formsubstrate agents sync` lists them), mcp_clients (approved outside clients);
                               gate_hook.py holds SCRIPT, the source of the hook sf_gate.py that
                               gates.ensure_script writes to [data]/hooks/
    templates/                 common, python, rust: files the New Form app writes (bundled by
                               setup/freeze_backend as app/templates)
  formsubstrate_mcp.py         stdio launcher behind ./formsubstrate mcp
frontend/
  index.html                   critical style and pre-paint theme boot
  public/                      splash.html and static files
  src/main.ts, app.ts          boot and shell assembly
  src/extensions/              registry.ts plus debug, files, formslot, git, lsp, search, sessions
  src/ui/                      shell modules, editor/, graph/, palette/ (symbol search, fuzzy), panels/,
                               preview/, review/, i18n; terminal-dock.ts (gate banner and tab badge),
                               gate-cards.ts, close-guard.ts (quit guard), command-palette.ts
  src/io/                      engine clients: api, workspace, git, sessions, terminals, formslot,
                               lsp, debug, graph, secrets, trust, create, window-token
  src/styles/                  tokens.css and per-area CSS
src-tauri/                     Tauri 2 shell: main, close_guard, packaged, reveal, text_edit, traffic_lights,
                               window_state, window_token; tauri.conf.json, capabilities, entitlements
setup/                         install_all, boot_all, boot_backend, boot_frontend, serve, doctor, clean,
                               freeze_backend (PyInstaller engine folder), lib.sh
build_app, build_app.bat       window, frozen engine and Tauri bundle in one run (see docs/RELEASE.md)
formsubstrate                  root dispatcher (install, boot, backend, frontend, serve, doctor, mcp, clean, version)
```

## Dependency direction

- `io` talks to the engine and imports nothing from `ui` or `extensions` except types.
- `extensions` import `io`, `ui` helpers and the registry; `ui` modules do not import extensions except for event name constants.
- Routers import services and core; services import core; core imports nothing from routers.
- The window reaches the engine only through `io/api.ts`.

## Data flow of an edit

Window action, `io/[x].ts` request, router validates and translates, service does the work (git, files, processes), result patched into the DOM in place. Long-lived channels: SSE `/api/sessions/events`, WebSockets for terminals, LSP and debug.

## Ports and environment

| Item | Value |
| --- | --- |
| Window dev server | 5650 (preview 5651), `host: false`, strictPort |
| Engine | 5655, 127.0.0.1 only; override `FORMSUBSTRATE_PORT` |
| Family block | 5650 to 5659 is formsubstrate's |
| `FORMSUBSTRATE_DATA_DIR` | data folder (registry, worktrees, identity, recent list, logs) |
| `FORMSUBSTRATE_DIST` | built window folder served at `/` |
| `FORMSUBSTRATE_CORS_ORIGINS` | replaces the default window origins |
| `FORMSUBSTRATE_BIN_DIR` | first place `find_bin` looks |
| `FORMSUBSTRATE_PORTABLE=1` | data beside the executable |
| `FORMSUBSTRATE_DESKTOP=1` | set by the Tauri shell |
| `FORMSUBSTRATE_WINDOW_TOKEN` | the window token, made by the Tauri shell and read once by the engine |
| `FORMSUBSTRATE_PORT` | engine port for the launcher and `serve` (the launcher falls back to `engine.port` in the data folder, then 5655) |
| `FORMSUBSTRATE_ENGINE`, `FORMSUBSTRATE_SESSION`, `FORMSUBSTRATE_WORKTREE`, `FORMSUBSTRATE_REPO`, `FORMSUBSTRATE_GATE_TOKEN` | given to an agent session by `gates.session_env`; the hook and the MCP launcher read them |
| `FORMSUBSTRATE_TERMINAL=1` | set in every terminal the engine starts |
| `FORMSUBSTRATE_PTYHOST_IDLE`, `FORMSUBSTRATE_PTYHOST_REAP` | pty-host idle and reap seconds (defaults 600 and 300) |
| `FORMSLOT_BIN`, `FORMSLOT_DATA_DIR`, `FORMMCP_BIN` | external tool locations |

There is no other prefix: every formsubstrate variable starts `FORMSUBSTRATE_`, the window token header is `X-FormSubstrate-Window` and the session header `X-FormSubstrate-Session`.

## Phases

F1 scaffold, engine skeleton and desktop boot; F2 shell (tokens, title bar, menus, status bar); F3 Home and Preferences; F4 workspace, files, editor, search; F5 terminals, Claude Code tabs, sessions and worktrees; F6 git, review, rewind and the commit wrapper; F7 formslot inside the workbench; F8 language servers and the debugger (with the graph, previews and substrata ports); F9 MCP surface, this kit and packaging. Releases since: v0.11.0 Bash write gates, the PostToolUse after-check, read-only `terminal_tail`; v0.12.0 palette symbol search (`@`, `#`), the quit guard, more Bash forms, the VT screen model and 256 KiB tail window; then the gate banner and tab badge, engine-held waivers keyed on content, loud fail-opens, parent session markers dropped from terminals. Every release from 0.17.0 on is in `CHANGELOG.md`. The plan itself is in the sidecar.
