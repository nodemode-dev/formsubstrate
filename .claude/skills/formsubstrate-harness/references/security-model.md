# Security model

Three layers, from outside in. A route is only as safe as the strongest layer it uses, so choose deliberately.

## 1. LocalGuard (every HTTP and WebSocket request)

`backend/app/core/local_guard.py`. Refuses with 403 (HTTP) or close code 4403 (WebSocket) unless:

- the Host header names loopback (127.0.0.1, localhost, ::1), and
- there is no Origin and `Sec-Fetch-Site` is not cross-site (curl and agent tools), or the Origin is a configured window origin, or it is an http origin equal to the Host.

This stops other websites and other machines. It does not stop another local process, including an agent session, from calling a route with no Origin.

## 2. Window token (owner-only state changes)

Two modes, logged once when the engine starts.

- Desktop app (the real boundary): the Tauri shell makes a random token (`src-tauri/src/window_token.rs`), passes it to the engine in the environment variable `FORMSUBSTRATE_WINDOW_TOKEN`, and serves it to the window through the `window_token` Tauri command (allowed in `capabilities/default.json` for the main window only). The engine removes the variable from its own environment at import, so sessions and terminals it spawns do not inherit it, and `POST /api/window-token` answers 404. Another local process cannot call a Tauri command. Limit: the variable stays readable by the same user through `/proc/[pid]/environ` or `ps eww` for the life of the engine, so the token defends against agent sessions and web pages, not against a hostile process running as the same user.
- Browser development build (no shell): the engine mints `WINDOW_TOKEN` at start and `POST /api/window-token` returns it to any request whose Origin passes the window-origin rule. A local process can send that Origin, so this route is a development convenience and not a security boundary.

Owner routes depend on `require_window`, which compares `X-FormSubstrate-Window` in constant time. A restart gives a new token (the shell restarts the engine with its own token); the window refetches once on 403. Never put it in a file, log, session environment or error body. The window code is `frontend/src/io/window-token.ts`.

It guards: formslot start, index, install, mcp, confirm, drift, gate answer, `GET /api/gates/notes`, and every `/api/create/*` route (clone, jobs, options, port, app). It is also accepted as the bearer token at `POST /mcp`, where it sees every session; a session gate token sees only its own. `POST /mcp` also accepts the headers `X-FormSubstrate-Session` and `X-FormSubstrate-Window`; no token is 401, an unknown token 403.

## 3. Session token (agent to engine)

`FORMSUBSTRATE_GATE_TOKEN` is minted per session and handed to that session through its environment only. It authorises `POST /api/gates`, `POST /api/gates/notes`, `GET /api/gates/waived` and `GET /api/gates/{id}/wait` for that session, sent as `X-FormSubstrate-Session`. It cannot answer a gate. The gate hook also sees the `Bash` tool: the command is parsed, never run, for the write forms listed in `CLAUDE.md` (redirections, `tee`, `cp`, `mv`, `install`, `sed -i`, `touch`, `dd of=`, `curl -o` and `-O`, `wget -O` and `-P`, `rsync`, `truncate`, `git checkout --`, `git restore`, `patch FILE`, awk `print > "file"`, heredocs, `bash -c`, `unzip -d` and `tar -x -C` by reading the member list; `X=literal` variables set earlier in the command are resolved). The PostToolUse hook on Bash can only warn, not block. Not gated before the call, caught afterwards by the files they changed: computed targets (`> "$f"` with an unknown value), script files run by name, `perl -i`, archives that do not exist yet or come from stdin. A command over 64 KB is not analysed before the call, and when the lexer cannot parse a command only literal redirect targets and `tee` targets are found by a conservative scan. The hook runs git with `--no-optional-locks`, `core.fsmonitor=false` and `core.hooksPath=/dev/null`, and diffs with `--no-ext-diff --no-textconv`, so it never takes the index lock or runs a program the repository configures.

The owner's Write new anyway waiver is engine state keyed on content (path, first slot id, SHA-256 of the tool input without `file_path`), held in `gates._waivers` and dropped with the session. The agent can write any file in its worktree and in the data folder, so no waiver or "seen" state may live in a file. A hook that cannot decide fails open but loudly: a line in `[data]/hooks/sf_gate.log`, stderr, and an engine note shown in the review pane. A silent fail-open is a bug.

Terminal output read through the MCP tool `terminal_tail` is redacted with a conservative pattern set; it is not a guarantee, and a session token may tail only its own session's terminals. Terminals started by the engine drop the parent agent harness's session markers (`inherited_env` in `routers/terminal.py`).

## Workspace trust

The person decides in the window, which keeps the list of trusted folders in preferences (`trustedWorkspaces`). For language servers, the debugger and triggers the engine keeps its own record of that decision in `backend/app/core/trust.py`: real paths, at most 200, in memory only, so after an engine restart nothing is trusted until the window speaks again.

- The record is set only through window-token routes: `POST /api/lsp/trust` (the window calls it through `syncTrust` in `frontend/src/io/lsp.ts`, once per pair of workspace path and trust) and `POST /api/triggers/trust`. `set_trust` changes the record only for the workspace that is open now.
- `WS /api/lsp/ws` and `WS /api/debug/ws` call `trust.is_trusted(root)`. Neither reads a `trust` query flag any more, so another local program that opens a socket cannot claim trust.
- What the record gates: a language server found inside the workspace (`node_modules/.bin`, a venv), every custom language server (`core/lsp_custom.py`; refused with reason `untrusted` before any lookup, so no process starts), the workspace venv for debugpy, and reading `.formsubstrate/launch.json` or `.vscode/launch.json` (`core/debug_launch.py`, checked again before every launch). Without trust the engine falls back to system programs for the built-in languages and reports a note.
- When trust is withdrawn, `POST /api/lsp/trust` stops every custom server and every server started from inside the workspace (`lsp.stop_trusted_only`).
- The custom server list (`lsp-servers.json` in the data folder) and the js-debug path (`debug.json`) are changed only through window-token routes (`POST`, `PUT`, `DELETE /api/lsp/custom`, `PUT /api/debug/settings`, `POST /api/debug/launch`); the matching `GET` routes take no key.
- A launch never passes the window's fields on: the engine rebuilds the `launch` request (`debug.launch_arguments`), reads a chosen configuration from the file again, and confines a Current File launch to the workspace.
- Other routes still take trust as a statement from the window in the request: the `trust` query on `/api/plugins`, `/api/presets` and the harness import, and the `trusted` body field on runs, sessions and Cogentics. They do not read the engine record.

## Other fixed rules

- The engine binds 127.0.0.1 only.
- Secrets live in the OS keyring via `routers/secrets.py`, never in files.
- Paths from the window are resolved through the workspace root helpers (`real_root`, `resolve`) before use.
- Child processes get a reduced environment where they run untrusted workspace tools (`minimal_env` in `core/lsp.py`, `ENV_KEEP` in `core/debug.py`).
- Programs are located through `find_bin`; the engine never shells out through a string.

## Deliberately open

Read-only status routes (`/api/formslot/status`, `/api/system/status`, listings) and most workspace and git routes rely on LocalGuard alone. A new route that mutates something an agent should not mutate on its own should use the window token.
