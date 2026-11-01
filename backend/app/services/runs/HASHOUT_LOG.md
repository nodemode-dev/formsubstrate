# HASHOUT_LOG · backend/app/services/runs

Rationale for the graph run engine, ported from substrata (MIT, the owner's) `backend/app/core/runner*.py`, `agent.py`, `llm.py` and `routers/run.py`, `runs.py`, `presets.py`.

### backend/app/services/runs/manager.py · RunManager, Run

- refers-to: backend/app/services/runs/manager.py :: RunManager, Run; ref2 backend/app/core/runner.py, runner_recover.py
- kind: explainer
- logged: v0.14.0 · 2026-10-30

Ported from substrata `runner.py` and `runner_recover.py`. A run is a managed object (id, status, event log, live queues) that executes in the background; no client holds a connection. Statuses are running, parked, done, failed, cancelled (cancelled is new). History lives in `<workspace>/.subform/runs/<id>.json` (was `.substrata/runs`), written atomically on every transition and after every node visit; the harness export already counts this folder as the `runs` group. Each run records `nodes`: for every node id a list of visits with the full input, output, error and the event seq range, which is what the node inspector shows. Parked runs are re-armed per workspace the first time the run list is read for that workspace (`sync`), because the engine starts before any workspace is open. Delay parks resume with `call_later`, watch parks poll a glob once a second (3000 file cap, `.git`, `.subform` and `node_modules` skipped). `start(doc, task, inputs, mode)` accepts a plain dict so `services/recipes/runs_bridge.py` can start runs unchanged; an empty mode picks claude when found, else the simulator.

### backend/app/services/runs/agent.py · run_claude, run_simulated

- refers-to: backend/app/services/runs/agent.py :: run_claude, build_argv, run_simulated; backend/app/services/sessions.py :: _start_headless, _on_line
- kind: rationale
- logged: v0.14.0 · 2026-10-30

substrata called an OpenAI-compatible endpoint with an API key. subform never keeps a key: each agent or evaluator node runs the user's own `claude` program (found with `find_bin`, the way sessions do) as `claude -p --output-format stream-json --verbose --include-partial-messages --no-session-persistence`, with the prompt on stdin (no argv size limit) and the working directory the workspace root. The stream-json line shapes are the ones `sessions._on_line` already reads (`assistant`, `result`, plus `stream_event` text deltas for token streaming). Per-node settings: `model` (`--model`), `permission` (`read` = `--tools Read,Grep,Glob` with the default permission mode, `edit` = acceptEdits plus Edit and Write, `plan`, `none`) and `timeout_s`. The default is read only, so a graph that was not set up to write cannot write. Token deltas are emitted as `delta` events with seq -1 (live tails only, never stored), as in substrata. The simulator streams a deterministic sentence word by word, reports usage under the model name `simulator`, and makes the first evaluator visit answer revise when the evaluator has a `revise` edge, so loops are exercised without a model.

### backend/app/services/runs/agent.py · gates not attached

- refers-to: backend/app/services/runs/agent.py :: run_claude; backend/app/services/gates.py
- kind: warning-context
- logged: v0.14.0 · 2026-10-30

Graph agents run in the workspace itself, not in a session worktree, and the formslot PreToolUse gate is installed per session, so an agent given `permission: edit` writes without the existing-slot prompt. The default `read` permission and the owner-only start (window token) are the guard. Moving graph runs into worktrees was left out; it needs a decision on where results land.

### backend/app/services/runs/safe_expr.py · evaluate

- refers-to: backend/app/services/runs/safe_expr.py :: evaluate; ref2 backend/app/core/runner_rt.py :: eval_expr
- kind: rationale
- logged: v0.14.0 · 2026-10-30

substrata evaluated branch conditions, transform expressions and foreach item lists with `eval` and a trimmed `__builtins__`, which is escapable through attribute walks. A graph can arrive from a cloned repository or a harness import, so expressions are now parsed with `ast` and walked by a small evaluator: constants, names (task, context, item, inputs, steps, json), subscripts and slices, comparisons, boolean and arithmetic operators, if-expressions, list, tuple, dict, set, f-strings and comprehensions, calls only to a fixed set of builtins, `json.loads` and `json.dumps`, and a method allow-list on str, dict, list. Underscore attributes, lambdas, star arguments, power and imports are refused. Size caps on node count, repeats, ranges and comprehension steps. Behaviour for the documented examples (`inputs['files']`, `json.loads(context)`, `len(context) > 100`) is unchanged.

### backend/app/services/runs/engine.py · walk, join_gate, exec_foreach

- refers-to: backend/app/services/runs/engine.py :: Engine; ref2 backend/app/core/runner_walk.py, runner_exec.py, runner_foreach.py
- kind: explainer
- logged: v0.14.0 · 2026-10-30

The walker, node handlers (agent, evaluator, tool, yield, transform, branch, call_graph, foreach), retry with doubling backoff, on_error policy (halt, continue, route), fan-out with join barriers and the loop budget (200 steps) are substrata's, merged into one class. Two changes: the join gate is skipped when a node is entered through an evaluator verdict edge, because the re-entry after `revise` belongs to the loop and not to a new fan-in (in substrata the second visit to a join node waited for arrivals that never came and the run ended silently); `call_graph` reads `.subform/graphs/<name>.json`, the folder the studio saves to. Tool nodes run the four built-ins in `tools.py` (list_files, read_file, write_file, run_shell) and fall through to the shared tool registry (`services/library`), so plugin and MCP tools work in tool nodes too. `run_shell` always parks for approval; any tool does when the node has `approve`. In simulator mode write_file, run_shell and registry tools are not executed (they report what they would do) but approval still parks, so the approval path is testable without side effects.

### backend/app/routers/runs.py · routes

- refers-to: backend/app/routers/runs.py; ref2 backend/app/routers/run.py, runs.py, harness.py, presets.py
- kind: explainer
- logged: v0.14.0 · 2026-10-30

`run.py` and `runs.py` are merged under `/api/runs`: start, list, detail (events plus per-node visits), events after seq, per-node view, an ndjson stream (replay then live, with token deltas), rerun, resume, cancel, delete, and `/api/runs/approvals` with its decision route (the approvals extension reads these). The old simulate-only `POST /run` and the inline `/run/stream` are gone: the simulator is a run mode. Every state change needs the window token. `harness.py` is not here: `routers/harness.py` already carries export, import and summary for `.subform`. `presets.py` is reduced to graph presets (`/api/presets/graphs`, copied from substrata into `backend/presets/graphs`); the studio router serves its own preset list from `app/templates/graphs`, and the plugin and skill presets belong to the plugin and skill ports. The frozen build must bundle `backend/presets` (see the report).
