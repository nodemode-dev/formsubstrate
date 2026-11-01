# HASHOUT_LOG · backend/app/core (engine address, debug relay, language servers) · subform

Living log for the F7 and F8 engine helpers: core/engine_addr.py, core/debug.py and core/lsp.py. Source files stay comment-free; what they would have said lives here. The engine-wide log is backend/HASHOUT_LOG.md; workspace_root.py and binres.py are logged in backend/app/routers/HASHOUT_LOG.md.

Current build version: v0.7.0
Last updated: 2026-10-30 · Phases F7 and F8

### backend/app/core/engine_addr.py · remember

- refers-to: backend/app/core/engine_addr.py :: remember
- kind: rationale
- logged: v0.7.0 · 2026-10-30

The engine does not know its own port when started as `uvicorn app.main:app` (only `subform_engine.py` writes `engine.port`). Every request to the sessions and formslot routers records the listening socket's port from the ASGI scope; `session_env` then puts it in `SUBFORM_ENGINE`. Fallbacks, in order: `SUBFORM_PORT`, `<data>/engine.port`, 5655. Session creation and resume always arrive through a request, so the value is set before any launch.

### backend/app/core/debug.py · module

- refers-to: backend/app/core/debug.py :: resolve_python
- kind: rationale
- logged: v0.7.0 · 2026-10-30

Ideas ported from substrata backend/app/core/dap.py (MIT, owner's): Content-Length framing over stdio and the workspace-venv-first rule. Not ported: the LspProc dependency, the node row, the `import debugpy` probe of the engine's own interpreter. The engine never imports debugpy and its interpreter is not a candidate. Candidates are the workspace venv python (.venv or venv, bin or Scripts), then python3 and python on PATH, each probed with `python -c "import debugpy"` from the temp folder (so a debugpy.py in the workspace cannot answer). The debuggee runs on the first candidate (the venv when there is one); the adapter runs on the first candidate that has debugpy. When the two differ, debugpy's launcher injects its own path into the debuggee, which was not exercised here.

### backend/app/core/debug.py · launch_arguments

- refers-to: backend/app/core/debug.py :: launch_arguments
- kind: warning-context
- logged: v0.7.0 · 2026-10-30

The relay does not forward the window's launch request. It rebuilds it: program and cwd confined to the open workspace (relative paths through workspace_root.resolve, absolute ones by realpath inside the root), args a list of at most 256 strings, python forced to the engine's choice, console forced to internalConsole (so the debuggee's output comes back as DAP output events, which is the debug console), env limited to PYTHONUNBUFFERED=1 so print output is not held in a pipe buffer until exit. attach, runInTerminal and startDebugging are answered with a failure response and never reach the adapter, because they would let a client start or join a process outside the confinement. justMyCode defaults on and stopOnEntry off.

### backend/app/core/debug.py · Adapter.stop

- refers-to: backend/app/core/debug.py :: Adapter.stop
- kind: warning-context
- logged: v0.7.0 · 2026-10-30

Killing the adapter's process group is not enough: debugpy's launcher puts the debuggee in its own group, and a debuggee paused at a breakpoint survived an abrupt socket close in the first run (found by checking ps). Stop now sends a disconnect with terminateDebuggee, waits 0.8 s, then SIGTERM then SIGKILL to the adapter group, then SIGKILL to the debuggee pid recorded from the `process` event (systemProcessId), by group and by pid. On Windows taskkill /T /F is used for both. If the engine itself is killed with SIGKILL nothing runs: the adapter loses its stdin and exits, but a debuggee is not guaranteed to follow.

### backend/app/core/lsp.py · module

- refers-to: backend/app/core/lsp.py :: spawn
- kind: rationale
- logged: v0.7.0 · 2026-10-30

Ported and rewritten from substrata v2.11.1 backend/app/core/lsp.py (MIT, owner's). One server process per WebSocket, framed JSON-RPC on stdio, stopped when its socket closes and on engine shutdown (shutdown() walks the live set). POSIX processes start in their own session and are stopped with killpg because tsserver and node wrappers spawn children. Servers are only found, never bundled: workspace-local bin folders (node_modules/.bin, frontend/node_modules/.bin, .venv, venv) first, then binres.find_bin (SUBFORM_BIN_DIR, PATH).

### backend/app/core/lsp.py · LANGS typescript candidates

- refers-to: backend/app/core/lsp.py :: report
- kind: rationale
- logged: v0.7.0 · 2026-10-30

TypeScript 7 compatibility, measured: typescript-language-server 6.0.2 refuses a TypeScript 7 workspace ("provides no tsserver.js"), because TypeScript 7 (the Go port) ships no tsserver. TypeScript 7 instead serves LSP itself: `tsc --lsp --stdio` (the native binary, also reachable as the node `tsc` wrapper). Candidate order is tsgo, tsc of major 7 or newer, then typescript-language-server; the last is skipped (noted, not usable) when the workspace TypeScript is 7 or newer. formvis uses typescript 7.0.2, so it gets the native server. The native server uses pull diagnostics only (textDocument/diagnostic), so the window pulls. Python uses pyright-langserver, verified end to end; pylsp was only probed with a raw initialize and hover.
