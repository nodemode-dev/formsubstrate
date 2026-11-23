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

It guards: formslot start, index, install, mcp, confirm, drift, gate answer, `GET /api/gates/notes`, and every `/api/create/*` route (clone, jobs, options, port, app). Since v0.25.0 it also guards: `POST /api/tasks/run`, `POST /api/tasks/stop` and `POST /api/tasks/file`; `PUT /api/keybindings`; `PUT /api/agents/{program}/path` and `PUT /api/formnet`; `PUT /api/ide/settings`, `POST /api/ide/state`, `POST /api/ide/reply` and `POST /api/ide/mention`. Their reads (`GET /api/tasks`, `/api/tasks/state`, `/api/keybindings`, `/api/agents`, `/api/formnet`, `/api/ide/settings`, `/api/ide/events`) take no key. It is also accepted as the bearer token at `POST /mcp`, where it sees every session; a session gate token sees only its own. `POST /mcp` also accepts the headers `X-FormSubstrate-Session` and `X-FormSubstrate-Window`; no token is 401, an unknown token 403.

## 3. Session token (agent to engine)

`FORMSUBSTRATE_GATE_TOKEN` is minted per session and handed to that session through its environment only. It authorises `POST /api/gates`, `POST /api/gates/notes`, `GET /api/gates/waived` and `GET /api/gates/{id}/wait` for that session, sent as `X-FormSubstrate-Session`. It cannot answer a gate. The gate hook also sees the `Bash` tool: the command is parsed, never run, for the write forms listed in `CLAUDE.md` (redirections, `tee`, `cp`, `mv`, `install`, `sed -i`, `touch`, `dd of=`, `curl -o` and `-O`, `wget -O` and `-P`, `rsync`, `truncate`, `git checkout --`, `git restore`, `patch FILE`, awk `print > "file"`, heredocs, `bash -c`, `unzip -d` and `tar -x -C` by reading the member list; `X=literal` variables set earlier in the command are resolved). The PostToolUse hook on Bash can only warn, not block. Not gated before the call, caught afterwards by the files they changed: computed targets (`> "$f"` with an unknown value), script files run by name, `perl -i`, archives that do not exist yet or come from stdin. A command over 64 KB is not analysed before the call, and when the lexer cannot parse a command only literal redirect targets and `tee` targets are found by a conservative scan. The hook runs git with `--no-optional-locks`, `core.fsmonitor=false` and `core.hooksPath=/dev/null`, and diffs with `--no-ext-diff --no-textconv`, so it never takes the index lock or runs a program the repository configures.

The owner's Write new anyway waiver is engine state keyed on content (path, first slot id, SHA-256 of the tool input without `file_path`), held in `gates._waivers` and dropped with the session. The agent can write any file in its worktree and in the data folder, so no waiver or "seen" state may live in a file. A hook that cannot decide fails open but loudly: a line in `[data]/hooks/sf_gate.log`, stderr, and an engine note shown in the review pane. A silent fail-open is a bug.

Only Claude Code sessions are gated: the hooks are Claude Code settings. A session run by Codex, Cursor or Antigravity (`services/agent_programs.py`, `CAPS[...]["gates"]` false) still gets its own worktree, terminal and token, but its writes pass no gate, and the window says so. Codex receives the session's MCP servers as `-c` config overrides with the token forwarded by name (`env_vars`), never on the command line; Cursor and Antigravity are started plainly.

Terminal output read through the MCP tool `terminal_tail` is redacted with a conservative pattern set; it is not a guarantee, and a session token may tail only its own session's terminals. Terminals started by the engine drop the parent agent harness's session markers (`inherited_env` in `routers/terminal.py`).

## Workspace trust

The person decides in the window, which keeps the list of trusted folders in preferences (`trustedWorkspaces`). For language servers, the debugger, tasks and triggers the engine keeps its own record of that decision in `backend/app/core/trust.py`: real paths, at most 200, in memory only, so after an engine restart nothing is trusted until the window speaks again.

- The record is set only through window-token routes: `POST /api/lsp/trust` (the window calls it through `syncTrust` in `frontend/src/io/lsp.ts`, once per pair of workspace path and trust) and `POST /api/triggers/trust`. `set_trust` changes the record only for the workspace that is open now.
- `WS /api/lsp/ws` and `WS /api/debug/ws` call `trust.is_trusted(root)`. Neither reads a `trust` query flag any more, so another local program that opens a socket cannot claim trust.
- What the record gates: a language server found inside the workspace (`node_modules/.bin`, a venv), every custom language server (`core/lsp_custom.py`; refused with reason `untrusted` before any lookup, so no process starts), the workspace venv for debugpy, and reading `.formsubstrate/launch.json` or `.vscode/launch.json` (`core/debug_launch.py`, checked again before every launch), and workspace tasks (`services/tasks.py`: `.formsubstrate/tasks.json`, else `.vscode/tasks.json`, and the `package.json` scripts are not read, listed or run without trust; `GET /api/tasks` then answers `trusted: false` and `POST /api/tasks/run` answers 403 even with the window token). Without trust the engine falls back to system programs for the built-in languages and reports a note.
- When trust is withdrawn, `POST /api/lsp/trust` stops every custom server and every server started from inside the workspace (`lsp.stop_trusted_only`), and every running task (`tasks.stop(None)`). Stopping a task needs the window token and not trust, so a task can still be stopped afterwards.
- A task run never carries a command from the window: the body holds a label, and the engine reads the task file again and builds the command itself. A custom problem-matcher regexp comes from the workspace file and Python's `re` has no time limit; matching runs in a worker thread, so a slow pattern cannot stall the event loop but can keep that thread busy.
- The custom server list (`lsp-servers.json` in the data folder) and the js-debug path (`debug.json`) are changed only through window-token routes (`POST`, `PUT`, `DELETE /api/lsp/custom`, `PUT /api/debug/settings`, `POST /api/debug/launch`); the matching `GET` routes take no key.
- A launch never passes the window's fields on: the engine rebuilds the `launch` request (`debug.launch_arguments`), reads a chosen configuration from the file again, and confines a Current File launch to the workspace.
- Other routes still take trust as a statement from the window in the request: the `trust` query on `/api/plugins`, `/api/presets` and the harness import, the `trusted` body field on runs, sessions and Cogentics, and the `trust` body field on a recipe run. They do not read the engine record. Every one of them that changes or starts something also needs the window token; `GET /api/plugins` takes no key and never loads workspace plugins on its own (`plugins.listing` reloads without trust).

## The Claude Code IDE connection

`backend/app/services/ide_link.py`, off by default (`ide.json` in the data folder; the person turns it on in Preferences, Agents, "Claude Code in the editor"). It is the one listener that is not the FastAPI app, so LocalGuard does not cover it and it carries its own checks.

- A WebSocket server on 127.0.0.1, on a random port from 10000 to 65535, that exists only while the switch is on and a workspace is open.
- `_admit` refuses before the handshake, in this order: a Host that is not loopback (403), any request with an Origin or `Sec-Fetch-Site: cross-site` (403), a missing or wrong token compared in constant time (401), a ninth client (503).
- The token is minted at every start, written only to the lock file `~/.claude/ide/[port].lock` (mode 0600, under `$CLAUDE_CONFIG_DIR/ide/` when set), never returned by a route and never logged. The lock file is removed when the server stops; stale files are removed only when their `ideName` is Substrate and their pid is dead.
- Its tools read what the engine already holds (problems, open editors, selection) and ask the window to open a file, save, or show a proposed change; a path outside the workspace root is refused. Substrate does not write the proposed file: the CLI does after Accept.
- Status: built from the vendor's VS Code page plus third-party write-ups, and run against a stand-in client only, never the real `claude`. Do not describe it as verified.

## Route through FormNET

`backend/app/services/formnet.py`, off by default (`formnet.json`). When on and 127.0.0.1:8761 answers, `terminal_env` gives new terminals and sessions the proxy variables, `NO_PROXY` with this computer's addresses first, and certificate variables pointing at a bundle in `[data]/formnet/`. The engine's own requests, language servers, git routes and graph runs are never routed, and running terminals are not changed. A dead proxy leaves the terminal unchanged.

## Other fixed rules

- The engine binds 127.0.0.1 only.
- Secrets live in the OS keyring under the service name `formsubstrate`, and are saved and removed only through window-token routes. `services/secret_store.py` (behind `routers/secrets.py` and the Cogentics provider key in `services/cogentics/llm.py`) has one fallback: when the computer has no usable keyring (`system_store()` is false, or the keyring answers `NoKeyringError`), `put` writes the value to `secrets-local.json` in the data folder, created with mode 0600 through `_write_private` (on Windows the user profile's permissions protect it). `secrets-index.json` records which names are saved and in which store (`keychain` or `file`), never a value. Plugin secrets (`services/library/plugins.py`), webhook secrets (`services/triggers/hooks.py`) and MCP server headers (`services/library/mcp_client.py`) call the keyring directly and have no fallback, so they are never in a file.
- Paths from the window are resolved through the workspace root helpers (`real_root`, `resolve`) before use.
- Child processes get a reduced environment where they run untrusted workspace tools (`minimal_env` in `core/lsp.py`, `ENV_KEEP` in `core/debug.py`).
- Programs are located through `find_bin`; the engine never shells out through a string. The one exception is a workspace task of type `shell`, which is the person's own command line run through their login shell in a trusted workspace; a `process` task never meets a shell.
- Agent programs are located through `agent_programs.locate`: the path the person set (`agent-paths.json`, changed only through `PUT /api/agents/{program}/path`, an absolute path of an existing file that can run), then `FORMSUBSTRATE_BIN_DIR` and the bundled folder, then the finder. `binres.find_agent` answers the same.

## Deliberately open

Read-only status routes (`/api/formslot/status`, `/api/system/status`, listings) and the reading workspace and git routes (tree, file, search, status, diff, review, log, branches) rely on LocalGuard alone; the workspace and git routes that write (`OWNER` in `routers/workspace.py` and `routers/git.py`) need the window token. A new route that mutates something an agent should not mutate on its own should use the window token.
