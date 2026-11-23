# HASHOUT_LOG · recipes (services, router) · formsubstrate

Living log for the recipes engine side: backend/app/services/recipes/ and backend/app/routers/recipes.py. Source files stay comment-free; what they would have said lives here.

Current build version: v0.25.1
Last updated: 2026-11-22

### backend/app/services/recipes/store.py · module

- refers-to: backend/app/services/recipes/store.py :: list_recipes, save_recipe, render_task, install_preset
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Ported from substrata backend/app/core/recipes.py and backend/app/routers/recipes.py (MIT, owner's). A recipe is a graph doc, a task template with {name} placeholders and declared inputs. It lives in `<workspace>/.subform/recipes/<name>.json` (substrata used `.substrata/`), is written atomically (temp file and rename) and is shipped as presets under `presets/`. Differences from substrata: the name allows up to 64 characters; the graph is checked (nodes with ids and kinds, a start node, edges that point at real nodes) instead of being validated only when it runs; inputs are cleaned to the six known keys and capped; a recipe larger than 1 MB is refused; installing a preset that is already installed answers 409 instead of overwriting a recipe the owner may have edited; input values are capped at 20000 characters. Unknown placeholders survive literally, a required input without a value or default is a 400.

### backend/app/services/recipes/presets · five presets

- refers-to: backend/app/services/recipes/presets/code-review-gate.json :: code-review-gate
- kind: rationale
- logged: v0.14.0 · 2026-10-31

The five shipped presets are substrata's (benchmark-review, build-and-verify, code-review-gate, skill-builder, watch-and-react). skill-builder now writes into `.subform/skills/`. code-review-gate keeps its `run_shell` tool node and no longer needs the old SUBSTRATA_APPROVAL_TOOLS switch: the run engine always holds `run_shell` for approval, so the gate is the engine's own. An extra explicit approval yield node in front of it was tried and removed because it asked twice.

### backend/app/services/recipes/runs_bridge.py · start, resume, status

- refers-to: backend/app/services/recipes/runs_bridge.py :: start
- kind: rationale
- logged: v0.14.0 · 2026-10-31

The only file that touches the run engine (backend/app/services/runs, ported by the runs agent). It builds the graph with `rt.build_doc`, checks the mode with `agent.mode_available`, syncs the manager and calls `manager.start(doc, task, inputs=, mode=)`; the keywords matter because the manager's parameter order changed while this was written. A recipe run is therefore an ordinary run: it appears in GET /api/runs, streams, parks and is cancelled like any other. The recipe name is not stored on the run (the run record has no field for it); the task text and the graph name identify it.

### backend/app/routers/recipes.py · routes

- refers-to: backend/app/routers/recipes.py :: save, delete, run, install_preset
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Reads (list, get) need LocalGuard only. Save, delete, run and preset install need the window token (`require_window`): running a recipe starts an agent that can write files and ask to run commands, so only the window may start it. The run body takes `mode` (`simulate` or `claude`, default `simulate`) so the owner chooses between the built-in simulator and Claude Code on each run. The `run_recipe` agent tool substrata registered for its own agents is not ported: the tool registry belongs to the run engine.

### backend/app/services/recipes/store.py · workspace paths and trust

- refers-to: backend/app/services/recipes/store.py :: safe_path
- kind: security
- logged: v0.14.0 · 2026-10-31

Security review (11 MED, 4 HIGH recipe part). Every recipe path goes through `ws.resolve(..., write=True)` for writes and rejects a symbolic link in any component below the workspace root (`safe_path`), so `.subform/recipes` pointing outside the workspace is refused for list, get, save and delete; a recipe file that is a link reads as missing, and the temp file is made with O_EXCL and O_NOFOLLOW under a per-process name before `os.replace`. `content_hash` is the fingerprint triggers store. `as_data` turns a value from outside (a webhook body) into inert text. The run body takes `trust` (the window's workspace trust) and `runs_bridge.start` refuses mode `claude` and `tool` or `call_graph` nodes without it. `runs_bridge` now builds the document first and passes `trusted` to the run engine's `manager.start`, matching the run router; the earlier `manager.sync()` call went away with the engine rewrite.
