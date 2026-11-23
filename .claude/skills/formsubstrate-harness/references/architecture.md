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
                               skills, git, debug, lsp, media, graph, create, mcp, tasks, keybindings,
                               agents (agent programs and FormNET), ide (the Claude Code IDE connection)
    services/                  sessions, gitops, formslot, gates, gate_hook, graph, ptyhost_client,
                               create (clone jobs, New Form app), mcp_tools (the MCP tools; `./formsubstrate agents sync` lists them), mcp_clients (approved outside clients);
                               gate_hook.py holds SCRIPT, the source of the hook sf_gate.py that
                               gates.ensure_script writes to [data]/hooks/;
                               tasks (workspace tasks run as terminals, problem matchers), agent_programs
                               (how Codex, Cursor and Antigravity are found and started; agent_lookup is
                               the finder table it reads), formnet (the Route through FormNET switch),
                               ide_link (the Claude Code IDE connection, off by default)
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
                               gate-cards.ts, close-guard.ts (quit guard), command-palette.ts,
                               tasks.ts (task commands and picker), keys-page.ts (Preferences, Keys),
                               ide-link.ts (the window half of the IDE connection), new-session.ts
  src/io/                      engine clients: api, workspace, git, sessions, terminals, formslot,
                               lsp, debug, graph, secrets, trust, create, window-token, tasks,
                               keybindings, agents
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

Window action, `io/[x].ts` request, router validates and translates, service does the work (git, files, processes), result patched into the DOM in place. Long-lived channels: SSE `/api/sessions/events` and `/api/ide/events`, WebSockets for terminals, LSP and debug. Task state is polled (`GET /api/tasks/state`) while a task runs.

## Files in the data folder

Besides the registry, worktrees, identity, recent list and logs: `lsp-servers.json` (custom language servers), `debug.json` (the js-debug path), `mcp-clients.json` (approved outside MCP clients), and since v0.25.0 `keybindings.json` (changed shortcuts, `routers/keybindings.py`), `agent-paths.json` (program paths set in Preferences, `services/agent_programs.py`), `formnet.json` and the folder `formnet/` with `ca-bundle.pem` and `node-extra.pem` (`services/formnet.py`), and `ide.json` (the IDE connection switch, `services/ide_link.py`). The IDE connection's lock file is not in the data folder: it is `~/.claude/ide/[port].lock`. Workspace files: `.formsubstrate/tasks.json` and `.formsubstrate/launch.json`, each with a `.vscode` fallback that is read and never written.

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
| `FORMNET_DATA` | FormNET's folder, where its root certificate is looked for (else `~/formnet`) |
| `CLAUDE_CODE_SSE_PORT`, `ENABLE_IDE_INTEGRATION`, `CLAUDE_CODE_AUTO_CONNECT_IDE` | given to every terminal by `ide_link.add_env` while the IDE connection runs; these are Claude Code's names, not ours |

There is no other prefix of our own: every formsubstrate variable starts `FORMSUBSTRATE_`, the window token header is `X-FormSubstrate-Window` and the session header `X-FormSubstrate-Session`.

## Phases

F1 scaffold, engine skeleton and desktop boot; F2 shell (tokens, title bar, menus, status bar); F3 Home and Preferences; F4 workspace, files, editor, search; F5 terminals, Claude Code tabs, sessions and worktrees; F6 git, review, rewind and the commit wrapper; F7 formslot inside the workbench; F8 language servers and the debugger (with the graph, previews and substrata ports); F9 MCP surface, this kit and packaging. Releases since: v0.11.0 Bash write gates, the PostToolUse after-check, read-only `terminal_tail`; v0.12.0 palette symbol search (`@`, `#`), the quit guard, more Bash forms, the VT screen model and 256 KiB tail window; then the gate banner and tab badge, engine-held waivers keyed on content, loud fail-opens, parent session markers dropped from terminals. v0.25.0: workspace tasks, shortcuts that can be changed, sessions with Codex, Cursor and Antigravity, the Route through FormNET switch and the Claude Code IDE connection (the last two off by default). Every release from 0.17.0 on is in `CHANGELOG.md`. The plan itself is in the sidecar.
