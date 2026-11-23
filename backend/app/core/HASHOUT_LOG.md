# HASHOUT_LOG · backend/app/core (engine address, debug relay, language servers) · formsubstrate

Living log for the F7 and F8 engine helpers: core/engine_addr.py, core/debug.py and core/lsp.py. Source files stay comment-free; what they would have said lives here. The engine-wide log is backend/HASHOUT_LOG.md; workspace_root.py and binres.py are logged in backend/app/routers/HASHOUT_LOG.md.

Current build version: v0.25.1
Last updated: 2026-11-22

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

### backend/app/core/config.py, workspace_root.py · the rename to FormSubstrate carries SubForm state across once

- refers-to: backend/app/core/config.py :: OLD_NAME, OLD_ENV_PREFIX, NEW_ENV_PREFIX, MARKER_NAME, portable_dir, platform_data_dir, _migrate_data_dir, old_data_dir, data_dir; backend/app/core/workspace_root.py :: OLD_FOLDER, FOLDER, _adopt_old_folder, set_current; backend/app/routers/secrets.py :: SERVICE, OLD_SERVICE, KEYRING_MARKER; backend/app/services/gitops.py :: SNAP_ROOT, OLD_SNAP_ROOT, _adopt_old_snapshots; backend/app/services/triggers/hooks.py :: OLD_HEADERS
- kind: rationale
- logged: v0.17.0 · 2026-11-21

The app is now Substrate (family name FormSubstrate, machine name `formsubstrate`). The substrataform copy above was retargeted rather than stacked: the old name is now `subform`, so `SUBFORM_*` variables are adopted as `FORMSUBSTRATE_*` (the new name wins), `~/Subform`, the per-OS `subform` folder and `SubformData` are copied once into `~/FormSubstrate`, `formsubstrate` and `FormSubstrateData`, and keychain service `subform` is copied to `formsubstrate`. An install that still holds only substrataform data is no longer copied; every tester who ran a SubForm build already had it copied then. Two kinds of state live outside the data folder and are moved, not copied: a workspace's `.subform` folder is renamed to `.formsubstrate` when the workspace is opened and `.formsubstrate` does not exist (one `os.rename`, a failure leaves it alone), and snapshot refs under `refs/subform/snapshots/<key>/` are created under `refs/formsubstrate/snapshots/<key>/` and the old ref deleted, the first time that key's list is read, so a pruned snapshot does not come back. Webhook senders may keep the `X-Subform-*` headers; the new header is read first. `.subform` stays in the skip and block lists for a workspace where both folders exist. Checked with a fresh HOME on port 5657: the old data folder was copied with the marker, the deprecation warning for `SUBFORM_LOG_LEVEL` was logged, opening a workspace renamed its `.subform` folder, and `refs/subform/snapshots/workspace/3` was listed as `refs/formsubstrate/snapshots/workspace/3` with the old ref gone.

### backend/app/core/binres.py · find_agent, agent_env, agent_argv, wide_path, warm; backend/app/services/agent_lookup.py

- refers-to: backend/app/core/binres.py :: SHELL_WAIT, AGENT_OVERRIDES, find_bin, wide_path, find_agent, agent_env, agent_argv, warm; backend/app/services/agent_lookup.py (whole file); backend/app/services/sessions.py :: _claude; backend/app/services/runs/agent.py :: claude_path, _run_claude; backend/app/routers/terminal.py :: launch; backend/app/routers/system.py :: git_version, status; backend/app/routers/cogentics.py :: status; backend/app/main.py :: lifespan
- kind: rationale
- logged: v0.18.0 · 2026-11-22

An app opened from Finder, the Dock or the Start menu gets the system's short PATH, so `shutil.which("claude")` reported Claude Code missing for a person who has it in `~/.local/bin` or under a version manager. `agent_lookup.py` is the family's finder, version 1.0.1, copied from FormVis without a change: its SHA-256 is `62667f9b68b7d101e1896ce617240424e33b7e498c560bc79d45f0ab26c77d51`, the value FormVis records for 1.0.1 in `setup/agents.py`. It is never edited here; a new version replaces the whole file. Its table carries Claude Code, Codex, Cursor and Antigravity; only `claude` is started in this version.

- `find_agent(program)` looks in `FORMSUBSTRATE_BIN_DIR` and the bundle's `bin` first (as `find_bin` does), then asks the finder with the development override `FORMSUBSTRATE_<PROGRAM>_BIN`. Removed: `find_bin("claude")` at the three call sites and `shutil.which("claude")` in the two status routes.
- `find_bin` is kept for git, rg, formslot, formmcp and the language servers. Its last line was `return shutil.which(name)`; it now also searches `wide_path()`, the PATH the finder builds (the person's shell PATH, the known install folders, then the engine's PATH).
- `agent_env(env, path)` returns the environment for a start: the program's own folder first on PATH, and a frozen engine's `LD_LIBRARY_PATH` and `DYLD_LIBRARY_PATH` put back as they were. The finder drops `CLAUDE*` variables it does not know; every `CLAUDE*` key already in `env` is passed as `keep`, because `terminal.inherited_env` and `worktree.STRIPPED_ENV` have already decided which of them a child gets.
- `agent_argv` wraps a `.cmd` or `.bat` program in the command interpreter on Windows and changes nothing elsewhere. The finder's own `start_argv` also wraps every start in the login shell on macOS and Linux; that is not used here, because the environment above already carries the shell's PATH and the pty-host starts the program itself.
- `warm()` reads the shell PATH once on a background thread at engine start, so the first session does not wait up to `SHELL_WAIT` seconds for a login shell.
- No Preferences field for a program's path yet; the finder accepts one (`setting`) and the field arrives with the other three programs.

Run on Linux with a stand-in `claude` in a made-up home and a PATH of the four system folders: found in `~/.local/bin`, its folder first on the child's PATH. Not run on macOS or Windows, and never against a real agent program.

### backend/app/core/startup.py · claim, holder, watch; backend/app/core/runtime.py · claim

- refers-to: backend/app/core/startup.py (whole file); backend/app/core/runtime.py :: AlreadyRunning, _alive, claim
- kind: rationale
- logged: v0.18.0 · 2026-11-22

`startup.py` comes from FormVis (`backend/app/core/startup.py`, Apache-2.0) with five names changed: `APP`, `NAMES`, `SHELL_ENV` (`FORMSUBSTRATE_SHELL_PID`), `ALONE_ENV` and `ERRORS_NAME`. The lock now records `born`, `shell` and `shellBorn` beside `pid` and `started`.

Removed from `runtime.py`: `class AlreadyRunning(RuntimeError): pass` (now `startup.Busy` under the same name); the body of `_alive` (on Windows `OpenProcess(0x1000, False, pid)`, which counts a finished process as alive while anything holds a handle; elsewhere `os.kill(pid, 0)` plus the zombie test in `/proc`); and the body of `claim`: read `pid` from the lock, `if held and held != os.getpid() and _alive(held): raise AlreadyRunning(...)`, then write `{"pid", "started"}`. That rule obeyed any live process with the recorded id for ever. On Windows the engine did not leave with its app, so after the shell was ended from Task Manager the next start met a live engine, raised, and the person saw "The Substrate engine failed to start".

The rule now: a lock whose engine is gone, or whose process id belongs to a different process (start times differ), is free. A lock whose engine is alive and whose shell is alive is busy and refuses. A lock whose engine is alive and whose shell is gone is a leftover: the engine is ended (terminate, then kill after five seconds) and the lock is taken. A lock written by 0.17.1 has no `shell`: it is a leftover when this start has a shell, and busy when it has none (two `./formsubstrate boot` in a row still refuse).

`keep_errors`, `alone`, `app_beside` and `open_app` are in the file and not called: Substrate's engine sits in a folder of its own inside the bundle, so FormVis's places for the app program do not apply.

### backend/app/core/lsp.py · record_diagnostics, forget_diagnostics, diagnostics_of

- refers-to: backend/app/core/lsp.py :: PROBLEM_ROOTS, PROBLEM_DOCS, PROBLEM_ITEMS, PROBLEM_TEXT, PROBLEM_FIELD, PROBLEM_URI, _problems, _problems_lock, _whole, _diagnostic, record_diagnostics, forget_diagnostics, diagnostics_of, LspProc.stop; backend/app/routers/lsp.py :: lsp_ws.server_to_client
- kind: rationale
- logged: v0.21.0 · 2026-11-22

A memory-only store of the latest `textDocument/publishDiagnostics` per workspace root and document URI, so the MCP tool `problems` can answer what the window's editor shows. Shape: `_problems` is an ordered map root to `{"docs": ordered map uri to entry, "servers": set of owners}`; an entry is `uri`, `version`, `at` (wall time), `seq`, `sent` (how many diagnostics the server sent), `items` and `owner` (the `LspProc` that published it). Each item keeps only `line` and `character` of the range start (0-based, as LSP sends them), `severity` (1 to 4; a missing or unknown severity is kept as 1, error, as VS Code reads it), `message` (first 2,000 characters), `source` and `code` (strings of at most 200 characters; a numeric code becomes its string). Related information, tags, code descriptions and data are dropped. A publish replaces the document's entry and moves it to the newest end; an empty list removes the document but leaves the root marked as reported, so the tool can tell "no problems" from "no server". Bounds: 200 diagnostics per document (the first 200 the server sent), 2,000 documents per root with the oldest dropped, 16 roots with the least recently published dropped, URIs over 4,096 characters ignored. `forget_diagnostics(owner)` runs first in `LspProc.stop`, which `lsp_ws` always reaches in its `finally` and `shutdown` calls for every live server: it removes the documents that server published and the server from its root, and drops the root when no publishing server is left, so a second server on the same root (another language, or a second window) keeps its own documents. A document re-published by another server changes owner. One `threading.Lock` guards the store because the MCP tool maps URIs in a worker thread; `diagnostics_of(root)` returns copies without the owner, newest first, or `None` when no server has published for that root. Nothing is written to disk. The relay records in `server_to_client` before forwarding the message unchanged; the root is `workspace_root.real_root()` taken when the socket opened, the same real path `mcp_tools._root` returns for the open workspace. Diagnostics answered to a pull (`textDocument/diagnostic`, which the native TypeScript 7 server uses) are responses, not notifications, and are not recorded.

### backend/app/core/trust.py · is_trusted, set_trust
- refers-to: backend/app/core/trust.py :: LIMIT, _trusted, _key, is_trusted, set_trust; backend/app/services/triggers/manager.py :: Triggers.set_trust, Triggers.trusted
- kind: rationale
- logged: v0.24.0 · 2026-11-22

One engine-side record of the trusted workspaces, used by the language servers (built-in candidates found inside a workspace and every custom server) and by triggers. Until now the triggers manager kept its own set (`Triggers._trusted`), and the language-server socket believed `?trust=1`, which any local page that can open the socket can also pass. The record holds real paths (`os.path.realpath`, then `os.path.normcase` so a Windows path in another case is the same workspace), at most 200, in memory only: the window announces trust at boot, on every workspace change and on every trust change, so an engine restart starts with nothing trusted until the window speaks. `set_trust` only changes the record for the workspace that is open now; a path that is not the open workspace changes nothing and answers the current state, as the triggers route always did. Removed from `services/triggers/manager.py`: `self._trusted: set[str] = set()` in `__init__`, the body of `set_trust` (compare `os.path.realpath(workspace)` with the open root, then add or discard) and the body of `trusted` (`os.path.realpath(root) in self._trusted`); both methods now call this module, so `POST /api/triggers/trust` answers the same `{"trusted": bool}`.

### backend/app/core/lsp_custom.py · PRESETS, add, change, remove, of_lang, install_of
- refers-to: backend/app/core/lsp_custom.py (whole file); backend/app/services/secret_store.py :: _read, _write_private
- kind: rationale
- logged: v0.24.0 · 2026-11-22

The custom language servers, kept in `lsp-servers.json` in the data folder as `{"version": 1, "servers": [...]}`, written with `secret_store._write_private` (a new file opened 0600 with `O_EXCL` and `O_NOFOLLOW`, fsync, then `os.replace`), and read back through a cache keyed on mtime and size, as `services/mcp_clients.py` does. An entry is `id` (from the preset name or the label, lower case and dashes, at most 40 characters, made unique with `-2`, `-3`), `label` (1 to 80 characters), `program` (a command name of letters, digits and `._+-` without folders, looked up later with `find_bin` and its repaired PATH, or an absolute path, stored with forward slashes), `args` (a list of at most 32 strings of at most 512 characters, no control characters), `exts` (1 to 16, each like `.rs`, lower-cased, not twice, not one of the built-in `LANGS` extensions, not owned by another custom server: 409 names the owner), `languageId` (the LSP language id, letters, digits and `._+-`), `initializationOptions` (a JSON object or list, at most 16,384 bytes serialised and 16 levels deep, or null) and `preset` (a known preset name or null). Unknown fields are refused, so a body cannot slip in anything the engine would later read. A file edited by hand is filtered on read: invalid entries, a repeated id and an entry whose extension an earlier entry owns are skipped. At most 32 servers.

Presets, each added with one click and then editable; Substrate never runs an install line, it only shows it under a server that was not found:
- `rust-analyzer` (no arguments, `.rs`, `rust`). Install: `rustup component add rust-analyzer`, or `brew install rust-analyzer`. Source: the rust-analyzer book, "rust-analyzer Binary" (https://rust-analyzer.github.io/book/rust_analyzer_binary.html), which gives `rustup component add rust-analyzer`, the prebuilt release download, `cargo xtask install --server` from a clone, `brew install rust-analyzer` on macOS and `pacman -S rust-analyzer` on Arch.
- `json`, `html`, `css` (`vscode-json-language-server --stdio` for `.json .jsonc`, `vscode-html-language-server --stdio` for `.html .htm`, `vscode-css-language-server --stdio` for `.css .scss .less`). Install: `npm i -g vscode-langservers-extracted`. Source: the README of hrsh7th/vscode-langservers-extracted (https://github.com/hrsh7th/vscode-langservers-extracted): "You can install this via `npm i -g vscode-langservers-extracted`", listing the html, css, json and eslint servers; the Homebrew formula page (https://formulae.brew.sh/formula/vscode-langservers-extracted) lists the same binaries (plus markdown) at 4.10.0. These three start with `initializationOptions` `{"provideFormatter": true}`, without which the servers report no formatting provider; checked with the JSON server, which then answers `textDocument/formatting`.
- `yaml` (`yaml-language-server --stdio`, `.yaml .yml`). Install: `npm install -g yaml-language-server`. Source: the README of redhat-developer/yaml-language-server (https://github.com/redhat-developer/yaml-language-server, and the npm README at https://unpkg.com/yaml-language-server@1.24.0/README.md): "Install yaml-language-server globally: npm install -g yaml-language-server", then "yaml-language-server --stdio".

Ran in /tmp with npm 10 on Node 22: `npm install vscode-langservers-extracted@4 yaml-language-server` gave all five binaries; `rustup component add rust-analyzer` gave rust-analyzer 1.97.0.

### backend/app/core/lsp.py · spawn, custom_path, custom_env, stop_lang, stop_trusted_only, Unavailable, LspProc.init, listing
- refers-to: backend/app/core/lsp.py :: spawn, custom_path, custom_env, stop_lang, stop_trusted_only, Unavailable, LspProc, listing; backend/app/core/lsp_custom.py :: of_lang, install_of
- kind: rationale
- logged: v0.24.0 · 2026-11-22

`spawn` now takes `lang` as a built-in name or `custom:<id>`. A custom server is refused before anything else when the workspace is not trusted: `Unavailable("trust the workspace to run <label>", install, "untrusted")`, so no lookup runs and no process starts. `trust` is the engine's own record (`core/trust.py`), passed in by the socket route; the old `?trust=1` query is no longer read. A trusted custom server is found with `custom_path` (an absolute path must be an executable file; a command name goes through `locate(root, name, True)`: the workspace's `node_modules/.bin` and venv folders first, then `find_bin`, which also searches `binres.wide_path()`), started with `[path, *args]` in the workspace root, stdin and stdout piped, stderr dropped and its own process group, as the built-in servers are. Its environment is `minimal_env()` with PATH set to the program's own folder, then `wide_path()` (the person's shell PATH and the known install folders), so rust-analyzer finds cargo and an npm server finds node in the desktop app, whose own PATH is short on macOS. No `--version` is run for a custom program, in the listing or at start. The same limits apply (`MAX_PER_LANG` per `custom:<id>`, `MAX_TOTAL` over all), and `record_diagnostics`, `forget_diagnostics` and `LspProc.stop` are shared. `LspProc.init` carries the entry's `initializationOptions` for the socket route to put into `initialize`. `stop_lang` stops every process of one language (after a change or a removal); `stop_trusted_only` stops every custom server and every server whose program lives inside the workspace (after trust is withdrawn). `listing(root, trust)` passes the engine's trust to `report`, so a trusted workspace's own TypeScript or Python server is shown as active. On Windows an npm shim is a `.cmd`, started directly as the built-in `typescript-language-server` already is; an absolute path to the `.exe` or the node script avoids it. Removed from `spawn`: `if lang not in LANGS: raise Unavailable(f"unknown language: {lang}", [])` as the first line (now also accepting a known custom id), `argv = rep.active.argv` and `env=minimal_env()` (now chosen per kind), and `LspProc(lang=lang, resolved=rep.active, proc=proc)`.

Ran against a live engine (made-up data folder /tmp/h1/data, a cargo project with a git repository at /tmp/h1/ws): untrusted, the socket for `custom:rust-analyzer` answered `formsubstrate/serverUnavailable` with "trust the workspace to run Rust (rust-analyzer)" and reason `untrusted`, with and without `&trust=1`, and `pgrep` found no rust-analyzer before or after. Trusted: initialize listed completion, definition, hover, formatting and diagnostic providers; hover on the call to `greet` answered `fn greet(name: &str) -> String`, definition pointed at line 0, completion offered `text`, `greet`, `main`; closing the socket ended the process (none left after 2 s). JSON and YAML presets: initialize, documentSymbol and (JSON) formatting answered through the same socket.

### backend/app/core/debug_launch.py · listing, resolve, clean, create, strip_comments (the launch file)
- refers-to: backend/app/core/debug_launch.py (whole file); backend/app/core/debug.py :: launch_fields, launch_arguments, window_fields; backend/app/core/trust.py :: is_trusted; backend/app/core/workspace_root.py :: resolve, _inside
- kind: rationale
- logged: v0.24.0 · 2026-11-22

The launch file is `.formsubstrate/launch.json`; when that file does not exist `.vscode/launch.json` is read instead and the listing says so (`fallback: true`, `source`). Both are found through `workspace_root.resolve`, so a symlink that leaves the workspace is treated as no file. The file is read only when `trust.is_trusted(root)` is true, the engine's own record set through the owner route `POST /api/lsp/trust`; nothing the window sends on the debug socket counts as trust (the old `?trust=1` on `/api/debug/ws` is gone, and the workspace venv now follows the same record). In an untrusted workspace `listing` answers that a file exists and `problem` says why it was not read; it never opens it. `resolve` checks trust again before every launch.

The file is JSON with comments and trailing commas (VS Code writes both), so `strip_comments` and `strip_trailing_commas` walk the text outside strings before `json.loads`; at most 262,144 bytes and 64 configurations. Fields read, in VS Code's shape: `type` (`python`, `debugpy`, `node`, `pwa-node`), `request` (`launch` only), `name`, `program`, `args` (list of text), `cwd`, `env` (object of text values, names like a variable name, at most 128), `justMyCode`, `stopOnEntry`. `console`, `presentation`, `preLaunchTask`, `postDebugTask` and `internalConsoleOptions` are skipped without a word; any other field is listed in `ignored`, which the panel shows. A configuration with another type, `attach`, `module` instead of `program`, a wrong field type or an unknown `${...}` is listed with `runnable: false` and the reason in `problem`. Variables: `${workspaceFolder}`, `${file}`, `${fileBasenameNoExtension}`, `${relativeFile}`; the last three come from the editor's active file, sent by the window as a workspace path and resolved by the engine, and a configuration that needs one without an open file is refused by name.

Paths: `program` and `cwd` are expanded and then, unless the text the person wrote is itself absolute, must resolve inside the workspace (a relative `..` is refused with a message that says to write an absolute path). An absolute path written in the file is taken as written: the file is the person's, in a workspace they trusted. Nothing reaches a shell; the fields become DAP `launch` arguments. The window never sends these fields: it sends `{configuration: {index, name}, file}` and the engine reads the file again, so a file edited after the picker was filled answers 409 "the launch file changed" rather than running something else. A launch typed by the window (Current File) still goes through `confine`, which refuses any absolute path outside the workspace, and carries no env.

`create` writes the starter (a Python and a Node.js "current file" configuration) with `open(..., "x")`, only when `.formsubstrate/launch.json` does not exist (409 otherwise), through `resolve(write=True)`.

Run in /tmp with debugpy 1.8.22: listing untrusted (not read, reason given), launch by configuration untrusted (refused), trusted listing with six configurations (two refused types, one bad env, one escaping path refused at launch with 403), a run with `args` and `env` printing `['one', 'loop', 'loop.py'] from-launch`, the `.vscode` fallback with `debugpy` and an ignored `subProcess`, the starter written once and refused the second time.

### backend/app/core/debug.py · NodeAdapter, Link, spawn_node, resolve_node, js_debug_entry, settings (Node.js through js-debug)
- refers-to: backend/app/core/debug.py :: Link, NodeAdapter (send, _pump, _event, _start_child, _refocus, stop), spawn_node, free_port, resolve_node, describe_node, js_debug_entry, js_debug_places, settings, save_settings, launch_arguments, ROOT_ONLY, BROADCAST, RESUMES; backend/app/routers/debug.py :: debug_ws, relay
- kind: rationale
- logged: v0.24.0 · 2026-11-22

The second adapter is Node.js through Microsoft's js-debug (vscode-js-debug, MIT, not bundled, no NOTICE row because nothing of it ships). Sources read on 2026-11-22: the project README (https://github.com/microsoft/vscode-js-debug), which says builds of the standalone DAP server are on the releases page and that it is used by other tools such as Neovim; the releases page (https://github.com/microsoft/vscode-js-debug/releases), latest v1.140.0, asset `js-debug-dap-v1.140.0.tar.gz`, which unpacks to `js-debug/src/dapDebugServer.js`; the usage text inside that file, `dapDebugServer.js [port|socket path=8123] [host=localhost]`; the Debug Adapter Protocol specification (https://microsoft.github.io/debug-adapter-protocol/specification) for the `startDebugging` reverse request (sent only when the client said `supportsStartDebuggingRequest`, arguments `request` and `configuration`) and for `SourceBreakpoint.condition`, `hitCondition`, `logMessage` with `supportsConditionalBreakpoints`, `supportsHitConditionalBreakpoints`, `supportsLogPoints`. OPTIONS.md of the repository could not be fetched (robots), so the launch fields are the ones the v1.140.0 server accepted in the runs below: `type: pwa-node`, `request`, `program`, `args`, `cwd`, `env`, `runtimeExecutable`, `stopOnEntry`, `skipFiles`, `console: internalConsole`, `outputCapture: std`.

Finding it: the path saved in Preferences (`debug.json` in the data folder, `jsDebugPath`, absolute, set through `PUT /api/debug/settings` with the window key), then `FORMSUBSTRATE_JS_DEBUG`, then known places (`~/.local/share/js-debug`, `~/js-debug`, Mason's `js-debug-adapter` package, `~/Library/Application Support/js-debug`, `/usr/local/lib`, `/usr/local/share`, `/opt`, `%LOCALAPPDATA%` and `%PROGRAMFILES%`). A place counts only when it is, or holds, a file named `dapDebugServer.js`. `node` comes from PATH. Substrate never downloads js-debug; when it is missing the adapter entry carries `reason` (`no-node` or `no-js-debug`) and the window shows the steps.

js-debug is a TCP server, not a stdio adapter, and the session that the client opens (the root) only starts the process: every Node process and worker is a child session that js-debug asks for with `startDebugging`, and the client must open another connection to the same port and send `initialize` and `launch` with the given configuration (it carries `__pendingTargetId`). `NodeAdapter` does this inside the engine so the window still sees one DAP stream: it starts `node dapDebugServer.js <free port> 127.0.0.1` in its own process group with the reduced environment, connects the root link, adds `supportsStartDebuggingRequest` to the window's `initialize`, and on each `startDebugging` (from the root or from a child, so nested processes work) opens a child link, initializes it with the same arguments, launches it, waits for its `initialized`, replays every `setBreakpoints` the window has sent plus the exception and function breakpoints, sends `configurationDone`, and answers the reverse request. Requests from the window: `initialize`, `launch`, `configurationDone`, `disconnect`, `terminate` go to the root; breakpoint requests go to the root and every child (the answer the window gets is the focused child's, or the root's before any child exists); everything else goes to the focused child. The focus is the child that stopped last. `continue` on the focused child moves the focus to another child that is still paused and repeats its `stopped` event, and so does the end of the focused child. Sequence numbers are rewritten per link (`Link.routes`). A child's `initialized` and `terminated` are kept from the window; the root's `terminated` ends the session. Any other reverse request is answered as not supported.

Not supported, said plainly: `attach` configurations in the launch file; browser targets (`pwa-chrome`); when two processes are paused at once the panel shows one, the one that stopped last, and reaches the other after Continue; a breakpoint's verified state for Node is not reported at start (js-debug binds when the script loads and says so in later `breakpoint` events, which the panel does not show). A TypeScript file is passed to `node` as it is, so it runs only where that Node strips types. The port is on 127.0.0.1 and open for the length of the session; another local process could connect to it, which is the same reach a local process already has.

Run in /tmp with js-debug v1.140.0 and Node 22.23.5 through the engine: a conditional breakpoint `i === 3` stopped once with `i * 10` = 30, hit count 5 stopped once at i = 4, a logpoint printed six lines without stopping, the launch file configuration ran with its args and env, and a forked child process stopped at its own breakpoint (42) before the parent stopped at its exit handler; no js-debug or node process was left after the sessions.

### backend/app/core/lsp.py · record_diagnostics (slot), diagnostics_of (merge)

- refers-to: backend/app/core/lsp.py :: record_diagnostics, diagnostics_of, forget_diagnostics; backend/app/services/tasks.py :: _digest, Run.slot; backend/app/services/mcp_tools.py :: _problem_docs
- kind: warning-context
- logged: v0.25.0 · 2026-11-22

The store kept one entry per uri, so a second reporter for the same file replaced the first: a task's problems for `a.ts` would have removed the language server's, and the server's next publish would have removed the task's. `record_diagnostics` gained `slot` (default empty, which is what every language server passes, so their behaviour is unchanged): a non-empty slot keys the entry as `uri + NUL + slot` while the stored `uri` stays the real one. `diagnostics_of` now joins entries that share a uri into one document, newest first: `items` are concatenated (cut to `PROBLEM_ITEMS`), `sent` is summed, and `version`, `at` and `seq` are the newest entry's. The MCP reader needs no change and sees one document per file with both sources' rows, each row carrying its own `source`. `forget_diagnostics(owner)` already removes by owner, so it clears one task's rows and leaves the server's. Checked in a /tmp script: server row, task row and a second server publish gave `['from lsp 2', 'from task']`; forgetting the task left the server row; forgetting both removed the root.

### backend/app/core/binres.py · find_agent

- refers-to: backend/app/core/binres.py :: find_agent, AGENT_OVERRIDES; backend/app/services/agent_programs.py :: locate
- kind: rationale
- logged: v0.25.0 · 2026-11-22

`find_agent` now answers `agent_programs.locate(program).path`, so the person's path from Preferences, Agents comes first for every caller (sessions, the claude terminal tab, graph runs, the status route, cogentics), then the vendor folders, then the finder as before. With no path set the answer is what it was.
