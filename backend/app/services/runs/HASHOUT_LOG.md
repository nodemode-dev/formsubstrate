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

### backend/app/services/runs · security review round (supersedes recovery, `.subform/runs` and one approval per run above)

- refers-to: backend/app/services/runs/manager.py :: RunManager, Run, runs_dir; backend/app/services/runs/park.py :: Park; backend/app/services/runs/engine.py :: park, exec_tool, node_yield
- kind: warning-context
- logged: v0.14.0 · 2026-10-30

Run history is no longer read from the workspace. It lives in `config.data_dir()/runs/<sha1 of the real workspace path, 16 hex>/<id>.json`, so a committed `.subform/runs/*.json` is never listed, resumed or turned into an approval card. There is no recovery and no checkpoint: a run found on disk as running or parked (the engine stopped) is shown as `interrupted` and can only be read, rerun or deleted; `shutdown` writes that state for live runs. Run ids must match `^[a-f0-9]{10}$` before any file is opened. Every park is its own `Park` (id, future, node, label, the `on` built by the engine from the node's own config, never from stored data), so parallel branches no longer share one approval; the approval list names each park id, and `decide` and `resume` settle exactly that park. Resume only settles non-approval parks and decide only approval parks. The shown tool, arguments and full diff are the ones the park resumes with. Claude mode and any node set that includes a tool node are refused when the request is not `trusted` (the window passes the Preferences flag, the way the language server routes take it; it is a client flag, not engine state). Child `claude` processes get `--setting-sources user --strict-mcp-config --disable-slash-commands`, so repo hooks, project settings, `.mcp.json` and project slash commands do not apply.

- refers-to: backend/app/services/runs/tools.py :: needs_approval, protected_target, preview_diff, check_args; backend/app/services/runs/rt.py :: plain_path, glob_regex
- kind: warning-context
- logged: v0.14.0 · 2026-10-30

Every tool except list_files and read_file waits for approval whatever the node says; the node `approve` setting no longer matters. write_file refuses `.git`, `.subform`, `.claude`, `.mcp.json`, `package.json`, `.husky`, `.gitmodules` and `.envrc`, checked case-insensitively against both the requested path and the resolved real path (so a symlink into a protected folder is refused), and it refuses instead of parking when the content, the existing file or the diff is too large to show in full or the arguments exceed 8000 characters. Paths under `.subform` (saved graphs, installed presets) go through `rt.plain_path`, which resolves with the workspace resolver and refuses any symlinked component. The watch glob walks with `followlinks=False`, skips symlinked directories and `.git`/`node_modules`, and matches relative paths only, so it cannot leave the workspace.

- refers-to: backend/app/services/runs/safe_expr.py :: _Eval, guard_call, charge
- kind: warning-context
- logged: v0.14.0 · 2026-10-30

`format` is removed from the allowed string methods: `'{0.__globals__}'.format(json.loads)` walked attributes outside the evaluator's rules and could read the environment, including the window token. Result sizes are capped at 1 MB each and 8 MB per evaluation (replace, join, `%` with huge or starred widths, repeats), and an evaluation has a 2 second deadline and a step limit.

### backend/app/services/runs/worktree.py · ensure, prepare, restore, sweep

- refers-to: backend/app/services/runs/worktree.py :: ensure, prepare, restore, discard, sweep; backend/app/services/sessions.py :: prepare_worktree, register_target, drop_target, RUN_KIND; backend/app/services/runs/agent.py :: run_claude
- kind: rationale
- logged: v0.15.0 · 2026-10-30

Supersedes "gates not attached" above. A graph run with any agent or evaluator node whose `permission` is `edit` or `plan` runs all its agent nodes in its own git worktree on branch `sf/run-<id>`, created the first time an agent node starts (the run record is already on disk by then). The worktree comes from `sessions.prepare_worktree`, the function `sessions.create` now uses too, so it carries the same extras: the `.subform/` exclude, the session `mcp.json`, the generated `settings.json` (attribution off, the PreToolUse and PostToolUse gate hooks), the commit-msg trailer strip and the stored commit identity. A read-only run, and the simulator, keep using the workspace root. The worktree starts from `HEAD`, so uncommitted changes in the workspace are not in it. A workspace that is not a git repository, or has no commit, makes such a node fail with the git message instead of falling back to the workspace root, because the root has no gate.
The run is registered as a reviewable target: an item with `kind: run` in `sessions._sessions` and the deterministic session id `run<runId>000` (16 characters, so it passes `SESSION_RE`). Because it is a normal item, `gitops.resolve_target`, the review, diff, log, audit, snapshot and comment routes, `gates.create` (a gate from the run opens a card in the window) and the formslot index root check work on it unchanged. `list_sessions`, `_save` and the session events skip `kind: run` items, so a run never appears in the session list and never lands in `sessions.json`, and `_changed` and `_notice` do not publish for it. The registry `run-worktrees.json` in the data folder remembers run id, repo, worktree path and branch; `sessions._entry` calls `worktree.restore` for an unknown id that starts with `run`, so a run from before an engine restart is reviewable again while its folder exists.
One gate token per run: `gates.session_env` is called once and the same env goes to every agent node of the run (a second call would mint a new token and the first node's hook would get a 403). The child env drops `SUBFORM_WINDOW_TOKEN` (graph agents inherited it before; sessions never did) and adds `SUBFORM_SESSION`, `SUBFORM_GATE_TOKEN`, `SUBFORM_ENGINE`, `FORMSLOT_BIN`. The argv gains `--mcp-config` and `--settings` from the worktree. A gate answered `write` is waived for that path and content digest, as for sessions.

### backend/app/services/runs/worktree.py · sweep, discard

- refers-to: backend/app/services/runs/worktree.py :: sweep, discard, _loop; backend/app/services/runs/manager.py :: RunManager.delete
- kind: rationale
- logged: v0.15.0 · 2026-10-30

The worktree is kept while the run is in history and removed when the run is deleted. `manager.delete` and the delete route belong to another change, so the module does not wait to be called: a sweep every 3 seconds (started when the first run worktree is made or restored) looks at each registered run, and when the run is not in memory and its history file is gone it runs `git worktree remove --force`, `worktree prune` and `branch -d` (the branch is kept when it holds commits that are not merged, so no work is lost), closes the gate token, drops the target and the registry entry. A call to `worktree.discard(run_id)` from `manager.delete` would make it immediate; the sweep stays as the fallback. The sweep also moves the target item from working to done, failed or stopped when the run ends, and closes its gates and token. The sweep only starts once a run has used a worktree in this engine process; a registry entry left by an earlier process is swept the next time a run worktree is made or a run target is restored.

### backend/app/services/runs/manager.py · delete

- refers-to: backend/app/services/runs/manager.py :: RunManager.delete, RunManager._discard_worktree; backend/app/routers/runs.py :: delete_run
- kind: rationale
- logged: v0.15.0 · 2026-10-31

After the history file is unlinked, `worktree.discard(run_id)` is scheduled on the running loop, so the worktree, its branch and the registry entry go at once instead of at the next sweep. The delete route became `async def` because a threadpool route has no running loop to schedule on. Verified: a real Claude run left a linked worktree and branch, DELETE removed both within three seconds. Run summaries carry `review`, true when `worktree.needs(doc)`; runs read back from disk do not, so the window probes the git status route instead.

### backend/app/services/sessions.py · _write_settings; runs/worktree.py · _run_args, discard, start_sweeper

- refers-to: backend/app/services/sessions.py :: _settings_path, _write_settings, _mcp_arg, reconcile; backend/app/services/runs/worktree.py :: _run_args, discard, start_sweeper; backend/app/services/gate_hook.py :: reason_for
- kind: warning-context
- logged: v0.15.0 · 2026-10-30

Review fixes. (1) The generated Claude settings (attribution off, the gate hooks) are built from an empty object and written outside the worktree, to `<data>/session-settings/<sha1 of the worktree path>.json`, and passed with `--settings`. The checked-out `.subform/settings.json` is never read, so a repository that commits hooks, `statusLine`, `apiKeyHelper` or `env` there gets nothing run: checked with a repo that commits such a file (the generated file holds only attribution and the two gate hook lists, the marker file was not created, the worktree stayed clean). Applies to sessions and runs. (2) `discard` runs `git status --porcelain` in the worktree first and keeps the worktree, target and registry entry when it is non-empty (remembered in `KEPT` so the sweep does not retry every 3 seconds); `git worktree remove` no longer uses `--force`; no git call is made when the repository folder is gone. (3) `sessions.reconcile`, which the lifespan calls at startup, starts the sweeper. (4) Run agents get a filtered MCP config (`<data>/session-settings/run-<id>-mcp.json`) with only the `subform` and `formslot` servers: no formMCP and no user-added servers; the subform server is limited by the run's gate token like a session's. If the filter fails the run gets no MCP config at all. (5) `gate_hook.reason_for` restricts the slot id to `[A-Za-z0-9._-]{1,200}` (anything else becomes `unknown-id`) and quotes it in the `slot_source`, `slot source` and `slot get` text.
