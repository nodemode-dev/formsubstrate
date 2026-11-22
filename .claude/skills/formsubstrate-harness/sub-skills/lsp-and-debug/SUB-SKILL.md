---
name: lsp-and-debug
description: Change formsubstrate's language server relay, the debug adapter relay or workspace trust. Use for core/lsp.py, core/lsp_custom.py, core/debug.py, core/debug_launch.py, core/trust.py, routers/lsp.py, routers/debug.py, the editor LSP client, quick fixes, custom language servers, breakpoints, the launch file, Node.js debugging, and any code that runs a program found inside the open workspace.
---

# lsp-and-debug

Language servers and debuggers are found on the system, never bundled. The engine spawns them and relays their protocol over WebSockets to the window.

## Language servers

- `backend/app/core/lsp.py`: the `LANGS` table (typescript, python, and the others listed there) with candidate executables in order; `locate`, `report`, `listing`, `spawn`, `LspProc`, limits `MAX_PER_LANG` 2 and `MAX_TOTAL` 6, frame cap, and `minimal_env()` which passes only the keys in `ENV_KEEP` (no secrets).
- TypeScript 7 serves itself: `tsc --lsp --stdio` (or `tsgo`), accepted only at major 7 or higher; `typescript-language-server` needs tsserver and is the fallback for older TypeScript.
- Routes: `GET /api/lsp/servers` reports what is installed, with install hints; `WS /api/lsp/ws?lang=[id]` relays (`lang` is a built-in name or `custom:[id]`; trust comes from the engine record, see Workspace trust). If no server runs, the socket sends `formsubstrate/serverUnavailable` with install commands and a `reason` (`untrusted` or `missing`), then closes; busy closes with code 4409.
- Custom servers: `backend/app/core/lsp_custom.py` keeps them in `lsp-servers.json` in the data folder (at most 32; `PRESETS` for rust-analyzer, JSON, HTML, CSS and YAML; the engine never runs an install line). `GET /api/lsp/custom` lists them; `POST`, `PUT` and `DELETE /api/lsp/custom` need the window token. `lsp.spawn` refuses a custom server in an untrusted workspace before any lookup. The Preferences card is in `frontend/src/ui/settings.ts`.
- Code actions (quick fixes, source actions, Organize Imports) are built beside the library: `frontend/src/ui/editor/lsp.ts` (`Session.actions`, `runAction`), `lsp-edits.ts` (`applyWorkspaceEdit`, which also writes files that are not open through the workspace routes) and `code-actions.ts` (the bulb gutter, the action list, the editor context menu). The commands `lsp-quick-fix` (`Mod+.`), `lsp-source-action` and `lsp-organize-imports` (`Alt+Shift+O`) are in `extensions/lsp/index.ts`. Write key strings in the order `comboOf` builds them (Alt, Shift, Mod), or the shortcut never matches.
- The relay answers a few client requests itself (`client/registerCapability`, `workspace/configuration`, work-done progress) so servers do not stall.
- Window side: `frontend/src/ui/editor/lsp.ts`, `lsp-workspace.ts`, `extensions/lsp/index.ts` (Outline and Problems sections), built on `@codemirror/lsp-client`.
- Palette symbol search (`@` file, `#` workspace) consumes the same servers: `symbolHub` in `frontend/src/io/lsp.ts` asks them for document and workspace symbols, and `frontend/src/ui/palette/symbols.ts` shows a note instead of rows when no server runs ("Trust this workspace to run the ones installed in it" when the workspace is untrusted, via `workspaceTrusted`). It uses `searchWorkspace` only to pick a file that warms a server for `#`. There is no non-LSP symbol fallback.
- A new language: add an entry to `LANGS` with `label`, `exts`, `install` hints and ordered `candidates` (`name`, `exe`, `args`, `kind`); add the editor language in `ui/editor/languages.ts`.

## Debug

- Two adapters, `python` and `node`; `GET /api/debug/adapters` lists both, each with a `reason` when it is missing.
- Python: `core/debug.py` resolves a Python with debugpy: the workspace venv (`.venv`, `venv`) only when trusted, else the system Python; `spawn` starts the adapter.
- Node.js: Microsoft's js-debug, never bundled or downloaded. `resolve_node` takes `node` from PATH and finds `dapDebugServer.js` from the path saved in Preferences (`debug.json`, `GET` and `PUT /api/debug/settings`, the `PUT` with the window token), then `FORMSUBSTRATE_JS_DEBUG`, then known places. js-debug is a TCP server that asks for a child session per process (`startDebugging`); `NodeAdapter` opens those links inside the engine so the window still sees one DAP stream.
- `WS /api/debug/ws?adapter=python|node` relays Debug Adapter Protocol messages (trust comes from the engine record, see Workspace trust). One session at a time (`slot.busy`); busy is 4409, unavailable 4404, error 4500. Failures are sent as DAP-shaped events named `formsubstrate/busy` and `formsubstrate/unavailable`. The `launch` request is rebuilt by `debug.launch_arguments`; the window's fields are never passed on.
- The launch file: `core/debug_launch.py` reads `.formsubstrate/launch.json`, or `.vscode/launch.json` when that file does not exist, only in a trusted workspace. `GET /api/debug/launch` lists the configurations or says why the file was not read; `POST /api/debug/launch` (window token) writes a starter file. It runs `launch` requests of type `python`, `debugpy`, `node` or `pwa-node`; `attach` is not supported.
- Window side: `extensions/debug/index.ts` (the panel, Watch, logpoints), `extensions/debug/launch.ts` (the configuration picker), `io/debug.ts`, `ui/editor/breakpoints.ts` (conditions, hit counts and logpoints, kept per workspace in `localStorage`).

## Workspace trust

- A workspace-local executable (node_modules/.bin, venv/bin, a workspace venv), a custom language server and the launch file are used only when the workspace is trusted. The person decides in the window; `frontend/src/io/trust.ts` holds `isTrusted`, `workspaceTrusted` and `setTrusted`, and the trust list lives in preferences (`trustedWorkspaces`).
- The engine keeps one record of that decision, `backend/app/core/trust.py` (`is_trusted`, `set_trust`; in memory, only for the open workspace). It is set through window-token routes: `POST /api/lsp/trust` (`syncTrust` in `frontend/src/io/lsp.ts`; `trustSynced` and `forgetTrustSync` beside it) and `POST /api/triggers/trust`. Both sockets read the record; neither takes `trust=1`. A session is not opened until `syncTrust` has settled, or the first file after boot could be refused as untrusted.
- Without trust both relays refuse workspace-local programs and say so in a note ("found in this workspace; it is not run until the workspace is trusted"); a custom server answers "trust the workspace to run [label]".
- `trustQuery('?' or '&')`, which appends `trust=1`, is still used by the plugin routes (`frontend/src/io/library.ts`), not by the language-server or debug sockets.
- Any new feature that executes something from the workspace must read `trust.is_trusted`, default to untrusted, and show a note. Subscribe to `TRUST_EVENT` to refresh.

## Gate

Import check on the engine, then `GET /api/lsp/servers` and `GET /api/debug/adapters` on your port. For relay changes, open a socket from a script and show the first messages. Log rationale in `backend/app/core/HASHOUT_LOG.md` and `backend/app/routers/HASHOUT_LOG.md`.
