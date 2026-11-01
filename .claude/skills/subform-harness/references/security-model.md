# Security model

Three layers, from outside in. A route is only as safe as the strongest layer it uses, so choose deliberately.

## 1. LocalGuard (every HTTP and WebSocket request)

`backend/app/core/local_guard.py`. Refuses with 403 (HTTP) or close code 4403 (WebSocket) unless:

- the Host header names loopback (127.0.0.1, localhost, ::1), and
- there is no Origin and `Sec-Fetch-Site` is not cross-site (curl and agent tools), or the Origin is a configured window origin, or it is an http origin equal to the Host.

This stops other websites and other machines. It does not stop another local process, including an agent session, from calling a route with no Origin.

## 2. Window token (owner-only state changes)

Two modes, logged once when the engine starts.

- Desktop app (the real boundary): the Tauri shell makes a random token (`src-tauri/src/window_token.rs`), passes it to the engine in the environment variable `SUBFORM_WINDOW_TOKEN`, and serves it to the window through the `window_token` Tauri command (allowed in `capabilities/default.json` for the main window only). The engine removes the variable from its own environment at import, so sessions and terminals it spawns do not inherit it, and `POST /api/window-token` answers 404. Another local process cannot call a Tauri command. Limit: the variable stays readable by the same user through `/proc/[pid]/environ` or `ps eww` for the life of the engine, so the token defends against agent sessions and web pages, not against a hostile process running as the same user.
- Browser development build (no shell): the engine mints `WINDOW_TOKEN` at start and `POST /api/window-token` returns it to any request whose Origin passes the window-origin rule. A local process can send that Origin, so this route is a development convenience and not a security boundary.

Owner routes depend on `require_window`, which compares `X-Subform-Window` in constant time. A restart gives a new token (the shell restarts the engine with its own token); the window refetches once on 403. Never put it in a file, log, session environment or error body. The window code is `frontend/src/io/window-token.ts`.

It guards: formslot start, index, install, mcp, confirm, drift, gate answer, and every `/api/create/*` route (clone, jobs, options, port, app). It is also accepted as the bearer token at `POST /mcp`, where it sees every session; a session gate token sees only its own.

## 3. Session token (agent to engine)

`SUBFORM_GATE_TOKEN` is minted per session and handed to that session through its environment only. It authorises `POST /api/gates`, `POST /api/gates/notes` and `GET /api/gates/[id]/wait` for that session, sent as `X-Subform-Session`. It cannot answer a gate. The gate hook also sees the `Bash` tool: the command is parsed, never run, for common write forms, and the PostToolUse safety net can only warn, not block; a write through a program the parser does not know (a script file, a compiler) is gated only after the fact.

## Workspace trust

Separate from the engine tokens. The window keeps a list of trusted folders in preferences. Language servers and debug adapters installed inside a workspace run only when the window sends `trust=1`. The engine otherwise falls back to system programs and reports a note.

## Other fixed rules

- The engine binds 127.0.0.1 only.
- Secrets live in the OS keyring via `routers/secrets.py`, never in files.
- Paths from the window are resolved through the workspace root helpers (`real_root`, `resolve`) before use.
- Child processes get a reduced environment where they run untrusted workspace tools (`minimal_env` in `core/lsp.py`, `ENV_KEEP` in `core/debug.py`).
- Programs are located through `find_bin`; the engine never shells out through a string.

## Deliberately open

Read-only status routes (`/api/formslot/status`, `/api/system/status`, listings) and most workspace and git routes rely on LocalGuard alone. A new route that mutates something an agent should not mutate on its own should use the window token.
