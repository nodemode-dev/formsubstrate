---
name: engine-route
description: Add or change a subform engine route, service or core module in the Python and FastAPI backend, behind LocalGuard and the window token or session token. Use for anything under backend/app, config and data folder questions, secrets in the keyring, and where the MCP route at POST /mcp fits.
---

# engine-route

The engine is `backend/app`: `main.py` wires it, `core/` holds process-level helpers, `routers/` holds thin HTTP layers, `services/` holds the logic. Routers parse and refuse; services do the work and raise their own `Refused` with a status and detail.

## Existing shape

- `main.py`: `LocalGuard` and CORS are added as middleware, then `include_router(..., prefix="/api")` for system, workspace, secrets, terminal, sessions, formslot, skills, git, debug, lsp, media, graph and create (the New Form app and clone routes, all behind `require_window`); the MCP router is included without a prefix. The sessions and formslot routers add `Depends(remember)` so the engine learns its own port. The built window is mounted at `/` last.
- `core/config.py`: ports (window 5650, engine 5655), `data_dir()` (override `SUBFORM_DATA_DIR`, else portable, else `~/Subform` if present, else the platform data folder), `dist_dir()` (`SUBFORM_DIST`), `cors_origins()`, `window_origins()`, `is_desktop()`.
- `core/local_guard.py`: `LocalGuard` ASGI middleware, `WINDOW_TOKEN` (the value of `SUBFORM_WINDOW_TOKEN` when the desktop shell supplies it, else minted at start), `hand_out_token` (404 when the shell supplied the token), `require_window`.
- `core/workspace_root.py`: the process-wide workspace root; use `real_root()` and its `Refused`.
- `core/binres.py` `find_bin`: the single choke point for locating programs the engine runs (git, claude, formslot, language servers, ripgrep).

## Adding a route

1. Put logic in `services/[name].py`; raise a service `Refused(status, detail)`.
2. Create `routers/[name].py` with `router = APIRouter()`; translate `Refused` to `HTTPException`. Validate bodies with pydantic models and `Field(max_length=...)`.
3. Register it in `main.py` with `prefix="/api"`. LocalGuard already covers every HTTP and WebSocket route, so a new route is behind it by construction; do not add routes to a second app or bypass the middleware.
4. For an owner-only state change (anything that starts a process, writes outside the session's own scope, installs, or answers a prompt) add `dependencies=[Depends(require_window)]`. The window sends `X-Subform-Window`; in the frontend call `owner()` from `io/window-token.ts` (it takes the token from the Tauri `window_token` command, falls back to `POST /api/window-token` in a browser development build, caches it, and retries once on a 403 status).
5. For calls made by an agent session itself (the gate hook), use the per-session token in the `X-Subform-Session` header, verified by `gates.verify`; never the window token.
6. Bind only 127.0.0.1. Never accept a path without resolving it through the workspace root helpers; refuse symlink escapes.
7. Secrets only through the keyring (`routers/secrets.py`); never in a file, log, env of a session or error body.
8. Streaming: SSE routes must end on shutdown (`session_service.close_streams` is called from the signal handler and lifespan); WebSockets close with an app code (4409 busy, 4404 unavailable) after sending a notice.
9. Add shutdown work to `lifespan` in `main.py`.
10. Frontend client in `io/[name].ts`; HASHOUT entry in `backend/app/routers/HASHOUT_LOG.md` or `services/HASHOUT_LOG.md`.

Note: today the git routes and most others are guarded by LocalGuard alone; the formslot owner routes, `GET /api/gates/notes`, `POST /api/gates/{id}/answer` and every `/api/create/*` route use `require_window`. Routes an agent session calls itself (`POST /api/gates`, `POST /api/gates/notes`, `GET /api/gates/waived`, `GET /api/gates/{id}/wait`) verify `X-Subform-Session` with `gates.verify`. Decide per route and record the decision in HASHOUT.

## The MCP route

subform's own MCP server is live: `routers/mcp.py` mounts `POST /mcp` on the app without the `/api` prefix (`include_router(mcp_router.router)`), the tools are in `services/mcp_tools.py`, and `./subform mcp` (`backend/subform_mcp.py`) is a stdio launcher that forwards to the engine. There are nine tools: `workspace_info`, `workspace_search`, `file_read`, `session_list`, `session_status`, `review_list`, `review_comment`, `terminal_list`, `terminal_tail`. See `docs/MCP.md` and the HASHOUT entries before touching it. Rules that apply: it sits behind LocalGuard and a bearer token (the window token or one session's gate token), file paths go through `_confined` (no symlinks, no `.git`, `.subform` or dotenv files, search results filtered the same way), tools that change state must be gated by consent or the window token, and the per-session MCP config written by `services/sessions.py` (`_mcp_config`) is where the server is offered to sessions.

## Gate

`venv/bin/python -c "import app.main"`, then start the engine on your port with a scratch data folder and curl the route with and without Origin and the token (`X-Subform-Window` for owner routes, `X-Subform-Session` for session routes); paste the status codes. For `/mcp`, see the recipe in `references/verification-recipes.md`.
