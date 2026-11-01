# Security model

Three layers, from outside in. A route is only as safe as the strongest layer it uses, so choose deliberately.

## 1. LocalGuard (every HTTP and WebSocket request)

`backend/app/core/local_guard.py`. Refuses with 403 (HTTP) or close code 4403 (WebSocket) unless:

- the Host header names loopback (127.0.0.1, localhost, ::1), and
- there is no Origin and `Sec-Fetch-Site` is not cross-site (curl and agent tools), or the Origin is a configured window origin, or it is an http origin equal to the Host.

This stops other websites and other machines. It does not stop another local process, including an agent session, from calling a route with no Origin.

## 2. Window token (owner-only state changes)

`WINDOW_TOKEN` is minted at engine start and held in memory. `POST /api/window-token` returns it only when the request carries an Origin that passes the window-origin rule (a POST always carries one; a same-origin GET may not). Owner routes depend on `require_window`, which compares `X-Subform-Window` in constant time. A restart mints a new token; the window refetches once on 403. Never put it in a file, log, session environment or error body.

Today it guards: formslot start, index, install, mcp, confirm, drift, and gate answer.

## 3. Session token (agent to engine)

`SUBFORM_GATE_TOKEN` is minted per session and handed to that session through its environment only. It authorises `POST /api/gates` and `GET /api/gates/[id]/wait` for that session, sent as `X-Subform-Session`. It cannot answer a gate.

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
