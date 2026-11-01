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

### backend/app/core/local_guard.py · WINDOW_TOKEN, hand_out_token, require_window

- refers-to: backend/app/core/local_guard.py :: WINDOW_TOKEN, hand_out_token, require_window
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review H1: LocalGuard lets a request with no Origin through, so an agent session could call the owner routes with curl. The engine now mints `WINDOW_TOKEN` (`secrets.token_urlsafe(32)`) at import and keeps it in memory only. `POST /api/window-token` returns it, and only when the request carries an Origin that LocalGuard's own rule accepts (the configured window origins, or an http origin equal to the Host). It is a POST on purpose: a browser sends no Origin on a same-origin GET, which is how the window is served when the engine hosts `dist`, while a POST always carries one. Owner routes (gate answer, formslot start, index, install, confirm, mcp, drift) depend on `require_window`, which compares the `X-Subform-Window` header in constant time and answers 403 for a missing or wrong value. The token is never written to a session env, a file, a log or an error body. A restart mints a new token and the window refetches once on a 403.

Residual risk, stated plainly: a process of the same user that deliberately forges `Origin: http://localhost:5650` can still fetch the token, and a same-user process can read other processes' memory or `/proc/<pid>/environ` of the engine. What this stops is the agent session answering its own gate, confirming slots or changing the install mode through the environment and routes it was handed, by accident or by a prompt-injected command. It is not a sandbox.

### backend/app/core/engine_addr.py · port

- refers-to: backend/app/core/engine_addr.py :: port
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review LOW: `engine.port` holding `{"port": null}` made `int(None)` raise `TypeError`, which was not caught. `TypeError` joins the caught errors and the port falls back to the default.

### backend/app/core/lsp.py · report, locate, spawn

- refers-to: backend/app/core/lsp.py :: report
- kind: warning-context
- logged: v0.7.1 · 2026-10-30

review M3: listing servers ran `node_modules/.bin/tsgo --version` from the opened folder, so a cloned repo executed code on open. Workspace-local candidates (node_modules/.bin, .venv, venv) are now listed as found with `local: true` and never run by the listing, and `report` and `spawn` take `trust`. Without trust only binres.find_bin results are used and probed; with trust a workspace-local binary wins, and it is first run only when a socket is opened with `trust=1`. A local-only candidate without trust is `found` but not `usable`, with a note. The window must send `trust=1` for TypeScript servers installed under node_modules; until it does, only a system server is used.

### backend/app/core/lsp.py · spawn limits

- refers-to: backend/app/core/lsp.py :: spawn
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review M1 and LOW: at most 2 servers per language and 6 in all (live plus those still starting, so a burst cannot pass the check together). `Busy` is raised before anything starts and the router closes the socket with 4409 and the reason. Pairs with the router fix that stops the process on every exit after spawn.

### backend/app/core/lsp.py · minimal_env

- refers-to: backend/app/core/lsp.py :: minimal_env
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review LOW: language servers and the `--version` probe start with an allow-list environment (PATH, HOME, USER, LANG, LC_*, TZ, temp and XDG folders, the Windows system variables, SUBFORM_BIN_DIR) instead of the engine's full environment, so secrets held by the engine are not handed to a server. A tool that needs another variable will not see it; add it to `ENV_KEEP`.

### backend/app/core/debug.py · resolve_python, describe

- refers-to: backend/app/core/debug.py :: resolve_python
- kind: warning-context
- logged: v0.7.1 · 2026-10-30

review M3 and M4: the workspace venv python is listed (`probed: false`) but not run unless `resolve_python` is called with `trust`; without it the debuggee and adapter python come from the system only. `describe` takes the already resolved result, so the websocket no longer re-probes (up to 12 s per candidate) on the event loop. Probes run with the minimal environment and a closed stdin.

### backend/app/core/debug.py · Adapter debuggee tracking

- refers-to: backend/app/core/debug.py :: Adapter
- kind: warning-context
- logged: v0.7.1 · 2026-10-30

review M6: the recorded debuggee pid is cleared on the `exited` and `terminated` events. When it is recorded, its process group and, on Linux, its start time from /proc are stored; at stop it is signalled only if both still match, and the group only when the debuggee led it. A reaped adapter's group is signalled only on Linux and only when no process holds that pid (a reused pid is never hit). Elsewhere a reaped adapter's group is left alone. On Windows taskkill by pid is unchanged.

### backend/app/core/debug.py · ALLOWED, read_message

- refers-to: backend/app/core/debug.py :: ALLOWED
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review LOW: the relay forwards only the DAP requests in `ALLOWED` (launch is rewritten as before); attach, restart, runInTerminal, startDebugging, writeMemory and anything unknown are answered with a failure response. Messages that are not requests from the window are dropped. A header line over 64 KB raises `HeaderTooLong`; the relay sends `subform/adapterError` and closes with 4500 instead of ending silently. The adapter, and so the debuggee, starts with the minimal environment, so a program that needs other variables will not see them.

### backend/app/core/local_guard.py · WINDOW_TOKEN, hand_out_token, token_mode

- refers-to: backend/app/core/local_guard.py :: WINDOW_TOKEN, INJECTED, hand_out_token, token_mode
- kind: rationale
- logged: v0.10.0 · 2026-10-30

review M3. The route-handed token was forgeable: any local process could send `Origin: http://localhost:5650` to `POST /api/window-token` and get the token that unlocks the owner routes, `/api/create/*` and every session at `/mcp`. The desktop shell now makes a random token, starts the engine with it in `SUBFORM_WINDOW_TOKEN` and gives it to the window through the `window_token` Tauri command. The engine reads the variable once at import and removes it from its own environment so the sessions and terminals it starts do not inherit it, and `hand_out_token` answers 404. Without the variable (browser development build) behaviour is as before and `token_mode()` says so in the log at start: a development convenience, not a security boundary. Known limit: the variable stays readable by the same user in `/proc/[pid]/environ` or `ps eww` of the engine process; the token defends against agent sessions that lack that access path and against web pages, not against a hostile same-user process. Before: spoofed Origin got 200 and a token. After, with the variable set: 404.

### backend/app/core/config.py · data folder, env names and keychain copy from substrataform

- refers-to: backend/app/core/config.py :: _adopt_old_env, _migrate_data_dir, _copy_old_data, old_data_dir; backend/app/routers/secrets.py :: migrate_keyring; backend/app/main.py :: lifespan
- kind: rationale
- logged: v0.14.0 · 2026-10-31

The rename changed every name, so an existing install found nothing. Three one-time, copy-only steps, none of which deletes or edits the old data. (1) Env: any `SUBSTRATAFORM_*` variable is copied to `SUBFORM_*` at import when the new name is unset (the new name wins), then removed from the environment so child processes do not see it twice; the start log carries one deprecation warning per old name. It runs right after `.env` is read, so `SUBSTRATAFORM_WINDOW_TOKEN` also works; remove the fallback in the next release. (2) Data folder: inside `data_dir()`, before the folder is created, and only when `SUBFORM_DATA_DIR` is not set. The old paths are the current ones with the name replaced: `~/Substrataform`, the per-OS folder (`~/Library/Application Support/substrataform`, `%APPDATA%\substrataform`, `$XDG_DATA_HOME` or `~/.local/share/substrataform`) and `SubstrataformData` beside the engine in portable mode. If the new folder does not exist the old one is copied to a sibling `.migrating` folder, a marker `.migrated-from-substrataform.json` (source, time) is written into it and it is renamed into place, so a failed copy never leaves a half folder; `engine.lock` and sockets are skipped. If both exist the old one is left alone and the log says so. Absolute paths stored inside copied files (workspace roots are outside the folder; snapshots and session records may name the old folder) are not rewritten. (3) Keychain: at start, for each name in the new and old `secrets-index.json`, a value missing under service `subform` and present under `substrataform` is copied; nothing is deleted and no value is logged, only names. The marker `.keyring-migrated-from-substrataform` makes it run once, so a secret the owner later deletes is not brought back; if the keyring is unavailable no marker is written and the next start retries.

### backend/app/core/config.py · USER_DATA allow-list; backend/app/routers/secrets.py · owner-only writes, reserved names

- refers-to: backend/app/core/config.py :: USER_DATA, _copy_old_data; backend/app/routers/secrets.py :: RESERVED, _candidates, put_secret, delete_secret
- kind: rationale
- logged: v0.14.0 · 2026-10-31

review 14 and 7. The data folder copy no longer takes the whole old folder: it copies an allow-list (`recent.json`, `secrets-index.json`, `identity.json`, `allowed_signers`, `library/`, `triggers/`, `cogentics-provider.json`, `cogentics-models.json`) into the staging folder and records the names copied in the marker. Runtime state is left behind on purpose: `engine.port`, `ptyhost.*`, `service.json`, `sessions.json`, `worktrees/`, `hooks/`, `Logs/`, which name live processes or old absolute paths. Sessions and snapshots from the old install are therefore not carried over. Secrets: `PUT` and `DELETE /api/secrets/{name}` now depend on `require_window`, so an agent session can no longer write or delete a secret; the names starting `mcp.`, `plugin.`, `cogentics-` and `webhook-` are reserved for their owning services and refused with 400 on every verb of this route. The keychain copy now also covers what those services store: `cogentics-api-key`, `mcp.<server>.headers` (server names from `library/mcp-servers.json`, new or old folder) and the trigger webhook secrets (service `subform.triggers`, ids from `triggers/*.json`). Plugin secrets (`plugin.<plugin>.<setting>`) cannot be listed without the workspace's plugins and are not migrated: enter them again once. Checked on port 5656 with a file-backed test keyring: PUT without token 403, with token 204, reserved names 400, DELETE likewise, GET 200; an old-service value for each of the four kinds was copied once and only the allow-listed files appeared in the new folder.
