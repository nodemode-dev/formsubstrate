# HASHOUT_LOG · backend · {{name}}

Log for the engine. Current build version: v0.1.0

### backend/app/config.py · ports

- refers-to: backend/app/config.py :: FRONTEND_PORT, PREVIEW_PORT, BACKEND_PORT
- kind: explainer
- logged: v0.1.0 · {{date}}

The ports are the block {{port_base}} to {{port_end}} written at scaffold time. The engine binds 127.0.0.1 only; CORS allows the three ports of this block and nothing else. Add LocalGuard-style host and origin checks (as subform's `core/local_guard.py`) before any route changes state.

### backend/app/main.py · health

- refers-to: backend/app/main.py :: health
- kind: explainer
- logged: v0.1.0 · {{date}}

`GET /api/health` is the only route so far. The static window from `frontend/` is mounted at `/` when it exists.
