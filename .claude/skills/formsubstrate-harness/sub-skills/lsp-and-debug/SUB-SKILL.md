---
name: lsp-and-debug
description: Change subform's language server relay, the debug adapter relay or workspace trust. Use for core/lsp.py, core/debug.py, routers/lsp.py, routers/debug.py, the editor LSP client, breakpoints, and any code that runs a program found inside the open workspace.
---

# lsp-and-debug

Language servers and debuggers are found on the system, never bundled. The engine spawns them and relays their protocol over WebSockets to the window.

## Language servers

- `backend/app/core/lsp.py`: the `LANGS` table (typescript, python, and the others listed there) with candidate executables in order; `locate`, `report`, `listing`, `spawn`, `LspProc`, limits `MAX_PER_LANG` 2 and `MAX_TOTAL` 6, frame cap, and `minimal_env()` which passes only the keys in `ENV_KEEP` (no secrets).
- TypeScript 7 serves itself: `tsc --lsp --stdio` (or `tsgo`), accepted only at major 7 or higher; `typescript-language-server` needs tsserver and is the fallback for older TypeScript.
- Routes: `GET /api/lsp/servers` reports what is installed, with install hints; `WS /api/lsp/ws?lang=[id]&trust=1` relays. If no server runs, the socket sends `subform/serverUnavailable` with install commands, then closes; busy closes with code 4409.
- The relay answers a few client requests itself (`client/registerCapability`, `workspace/configuration`, work-done progress) so servers do not stall.
- Window side: `frontend/src/ui/editor/lsp.ts`, `lsp-workspace.ts`, `extensions/lsp/index.ts` (Outline and Problems sections), built on `@codemirror/lsp-client`.
- Palette symbol search (`@` file, `#` workspace) consumes the same servers: `symbolHub` in `frontend/src/io/lsp.ts` asks them for document and workspace symbols, and `frontend/src/ui/palette/symbols.ts` shows a note instead of rows when no server runs ("Trust this workspace to run the ones installed in it" when the workspace is untrusted, via `workspaceTrusted`). It uses `searchWorkspace` only to pick a file that warms a server for `#`. There is no non-LSP symbol fallback.
- A new language: add an entry to `LANGS` with `label`, `exts`, `install` hints and ordered `candidates` (`name`, `exe`, `args`, `kind`); add the editor language in `ui/editor/languages.ts`.

## Debug

- `core/debug.py` resolves a Python with debugpy: the workspace venv (`.venv`, `venv`) only when trusted, else the system Python; `describe` feeds `GET /api/debug/adapters`; `spawn` starts the adapter.
- `WS /api/debug/ws?trust=1` relays Debug Adapter Protocol messages. One session at a time (`slot.busy`); busy is 4409, unavailable 4404, error 4500. Failures are sent as DAP-shaped events named `subform/busy` and `subform/unavailable`.
- Window side: `extensions/debug/index.ts`, `io/debug.ts`, `ui/editor/breakpoints.ts`.

## Workspace trust

- A workspace-local executable (node_modules/.bin, venv/bin, a workspace venv) runs only when the workspace is trusted. The window decides; `frontend/src/io/trust.ts` holds `isTrusted`, `workspaceTrusted`, `setTrusted`, and `trustQuery('?' or '&')` which appends `trust=1`. The trust list lives in preferences (`trustedWorkspaces`).
- The engine treats `trust=1` as the window's statement. Both relays refuse workspace-local programs without it and say so in a note ("found in this workspace; it is not run until the workspace is trusted").
- Any new feature that executes something from the workspace must take the same flag, default to untrusted, and show the same note. Subscribe to `TRUST_EVENT` to refresh.

## Gate

Import check on the engine, then `GET /api/lsp/servers` and `GET /api/debug/adapters` on your port. For relay changes, open a socket from a script and show the first messages. Log rationale in `backend/app/core/HASHOUT_LOG.md` and `backend/app/routers/HASHOUT_LOG.md`.
