# HASHOUT_LOG · triggers (services, router) · formsubstrate

Living log for backend/app/services/triggers/ and backend/app/routers/triggers.py. Source files stay comment-free.

Current build version: v0.20.0
Last updated: 2026-11-22

### backend/app/services/triggers/manager.py · Triggers

- refers-to: backend/app/services/triggers/manager.py :: Triggers
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Ported from substrata backend/app/core/triggers.py and routers/trigger_routes.py (MIT, owner's). Kinds: interval, delay (once after N seconds), watch (a path pattern in the workspace), webhook. Actions: run_recipe (with inputs and `inputs_from_payload`), run_graph (a saved graph from `.subform/graphs/`), resume (a parked run). One asyncio task ticks once a second inside the engine process; watch triggers scan at most every 2 seconds in a thread.

### backend/app/services/triggers/manager.py · when triggers run

- refers-to: backend/app/services/triggers/manager.py :: Triggers._bind, Triggers.tick
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Choice: triggers run only while the engine is running, which is while the app is open, exactly as in substrata (its watcher loop lived in its backend process and nothing scheduled work with the operating system). Nothing is installed in cron, launchd, Task Scheduler or a login item. Beyond substrata, nothing runs late either: on a restart an interval trigger counts from the moment the workspace is bound (substrata fired at once when its saved last-fire time was old), a delay trigger whose time passed while the app was closed is switched off and marked `missed` instead of firing, and a watch trigger starts from a fresh baseline so changes made while closed do not fire it. The loop follows the open workspace: triggers belong to a workspace, are loaded when it opens and are not run for a workspace that is not the current one.

### backend/app/services/triggers/manager.py · owner actions and where they are kept

- refers-to: backend/app/routers/triggers.py :: add_trigger, set_enabled, remove_trigger, fire_now, webhook_secret
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Creating, enabling, disabling, deleting, firing by hand and revealing a webhook secret need the window token. The trigger table is not kept inside the workspace (substrata kept `.substrata/triggers.json`): it is `<data folder>/triggers/<hash of the workspace path>.json`. A cloned repository can therefore not ship a trigger that starts running the moment it is opened; recipes, which only run when someone asks, stay in `.subform/recipes`. Limits: an interval is at least 10 seconds (substrata allowed any value), at most 50 triggers per workspace, a trigger whose last run is still running or parked is skipped and the skip is recorded, so an interval cannot pile up runs. Each trigger keeps its last 12 fires (time, source, run id, error or skip reason); the window joins them with the run list. The fire mode (`simulate` or `claude`) is part of the action and is chosen by the owner when the trigger is made.

### backend/app/services/triggers/hooks.py · webhook secrets

- refers-to: backend/app/services/triggers/hooks.py :: create, verify
- kind: rationale
- logged: v0.14.0 · 2026-10-31

A webhook is always signed (substrata signed only when a secret was typed). The secret is typed or generated (32 random bytes, urlsafe) and kept in the system keyring under the service `subform.triggers`, never in the table; the table holds `signed: true`. Creating a webhook without a keyring answers 503. The sender posts the raw body with `X-Subform-Signature: sha256=<hex HMAC-SHA256 of the body>`; a missing or wrong signature answers 401 and nothing fires. The body is capped at 256 KB. POST /api/hooks/{id} is the one trigger route without the window token because it is called by other programs; it is still behind LocalGuard (this computer only) and the signature.

### backend/app/routers/triggers.py · approvals

- refers-to: backend/app/routers/triggers.py :: router
- kind: rationale
- logged: v0.14.0 · 2026-10-31

This router has no approvals routes. The run engine already serves GET /api/runs/approvals and the window-token POST /api/runs/approvals/{run_id}, and a second pair would only drift; the window's approvals panel uses those. A denied approval returns the engine's tool-denied error and the run continues, as in substrata.

### backend/app/services/triggers/hooks.py · replay and weak secrets

- refers-to: backend/app/services/triggers/hooks.py :: verify
- kind: security
- logged: v0.14.0 · 2026-10-31

Security review (8 MED). The signature now covers `timestamp.nonce.body` (HMAC-SHA256 keyed with the secret) and the request must carry `X-Subform-Timestamp` (unix seconds, refused when more than 300 seconds from the engine clock either way) and `X-Subform-Nonce` (8 to 64 of letters, digits, dash, underscore). A signature that checks out is then looked up in a per-trigger nonce cache held for 10 minutes, so a captured request cannot be sent again inside or after the window; the cache holds at most 2000 live nonces per trigger and answers 429 when full, and it is dropped when the trigger is removed. The order is freshness, signature, then nonce, so an unsigned request cannot fill the cache. A typed secret needs at least 24 characters (422 otherwise) and a generated one is `token_urlsafe(32)`, 32 random bytes. The cache is in memory: an engine restart empties it, which is safe because the 5 minute window still bounds a replay. The old body-only signature is refused.

### backend/app/services/triggers/manager.py · trust, hash, data

- refers-to: backend/app/services/triggers/manager.py :: Triggers
- kind: security
- logged: v0.14.0 · 2026-10-31

Security review (4 HIGH trigger part, 8 MED, 11 MED). Trust: the window announces `POST /api/triggers/trust` (window token) with the workspace path and whether the owner trusts it; the engine keeps that set in memory only and ignores a path that is not the open workspace, so a restart fails closed until the window announces again. Trigger and recipe runs pass `trusted` to `runs_bridge.start`, which refuses mode `claude` and graphs with `tool` or `call_graph` nodes when it is false, and the run engine repeats the check. Content hash: a `run_recipe` action stores `recipe_hash` (sha256 of name, doc, task template, inputs and skills) and a `run_graph` action stores `graph_hash` of the file; if the target differs or is gone the trigger does not fire (manual fire included), sets `needs_confirm` and shows one collapsed skipped entry until the owner calls `POST /api/triggers/{id}/confirm` (window token), which stores the current hash. A trigger from before this change has no hash, so it asks to be confirmed once. Resume: `approved` is dropped from any payload and a run parked on an approval is never resumed by a trigger or a webhook; approvals are answered only by the window at `/api/runs/approvals`. Payload data: `inputs_from_payload` values go through `store.as_data` (text, control characters removed, 2000 characters, braces replaced by full-width ones) so a body cannot add a placeholder or an expression to a recipe. Paths: the saved graph is read through `store.safe_path` (workspace resolve, no symlinked part); the watch scan uses `lstat` and skips symlinks. Left as is: the hash is checked just before the run is built, not atomically with it, so an edit in that gap runs the new text once; the owner who can edit the file is the owner who confirms.
