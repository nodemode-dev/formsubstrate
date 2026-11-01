# HASHOUT_LOG · triggers (services, router) · subform

Living log for backend/app/services/triggers/ and backend/app/routers/triggers.py. Source files stay comment-free.

Current build version: v0.14.0
Last updated: 2026-10-31

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
