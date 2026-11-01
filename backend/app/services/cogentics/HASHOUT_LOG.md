# HASHOUT_LOG · cogentics and insight (engine) · subform

Living log for backend/app/services/cogentics/ and backend/app/routers/cogentics.py and insight.py. Source files stay comment-free; what they would have said lives here. The engine-wide log is backend/HASHOUT_LOG.md.

Current build version: v0.14.0
Last updated: 2026-10-31

### backend/app/services/cogentics/ · module map

- refers-to: backend/app/services/cogentics/model.py, store.py, roster.py, route.py, compose.py, group.py, tools.py, turns.py, hub.py :: CodexHub
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Ported from substrata `backend/app/core/cogentics*.py` (MIT, the owner's): `cogentics_model.py` to `model.py`, `cogentics_store.py` to `store.py`, `cogentics_roster.py` to `roster.py`, `cogentics_route.py` to `route.py`, `cogentics_compose.py` to `compose.py`, `cogentics_group.py` to `group.py`, `cogentics_tools.py` to `tools.py`, `cogentics_turns.py` to `turns.py`, `cogentics.py` to `hub.py`. The behaviour is the same: a channel is one chronological ledger, a message that @mentions an agent member delivers to it, an untagged reply from a human goes to the latest agent that finished, two or more mentioned agents run as a group round with a barrier and the bundled results become the next round's context, `<ACK_OK>` is an exact acknowledgement, a turn brake holds an agent-to-agent chain after N turns until a human releases it, and a turn that was still running when newer messages landed finalises as a continuation row. Member kinds are `agent` (an OpenAI compatible provider with workspace tools) and `claude` (the `claude -p` command found on the system, never bundled). State lives in `<workspace>/.subform/cogentics/` (substrata used `.substrata/collective_codex/` then `.substrata/cogentics/`; the rename path is dropped because subform has no older data). The hub clears its caches when the open workspace changes. Channel names and file reads are checked against `NAME_RE`; the log and metadata files are written through a temp file and `os.replace`.

### backend/app/services/cogentics/agent.py · run_agent, Tools, _simulate

- refers-to: backend/app/services/cogentics/agent.py :: run_agent, Tools, _simulate
- kind: rationale
- logged: v0.14.0 · 2026-10-31

substrata's `agent.py`, `substrate.py` and `llm.py` carried a graph runner, skill selection and a plugin registry that subform does not have. Only the loop is ported: stream a completion, run the tool calls through `tool_exec` (which asks a human first for gated tools), record usage, compact the head when the estimate passes 24000 tokens, stop at 24 iterations. Skill selection and `lean` meta-tools are left out. The workspace tools (`list_files`, `read_file`, `write_file`, `run_shell`) go through `workspace_root.resolve`, so absolute paths, `..` and the `.git` folder are refused; `write_file` records a pre-image in the active checkpoint scope before it writes. substrata ran tools in `run_in_executor`, which does not copy context variables, so the checkpoint scope was lost inside tools; `asyncio.to_thread` copies the context and is used instead. Simulator: when no provider is configured the loop returns a deterministic reply instead of failing (substrata's `run_agent` did this, but its cogentics turn refused to start first). The simulated reply never contains an `@mention` (a tool result echoing the request would otherwise start another group round forever) and records a small usage row with model `simulator`. Directives in the request text (`simulate:write PATH`, `simulate:search TEXT`, `simulate:shell COMMAND`) make it call that tool through `tool_exec`, so approvals, checkpoints and usage can be exercised without a model. A real provider run was not made in this build.

### backend/app/services/cogentics/turns.py and routers/cogentics.py · trust and approvals

- refers-to: backend/app/services/cogentics/turns.py :: TurnsMixin._turn; backend/app/routers/cogentics.py :: post_message, decide
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Every route that changes state needs the window token (`require_window`): creating and deleting channels, posting, adding members, pausing, releasing, the turn brake and gated-tools setting, the provider, and approving a gated tool call. Reads and the SSE stream need LocalGuard only. An agent member can write files and run commands, so a turn starts only when the window says the workspace is trusted: the window sends `trusted` with each post, pause toggle and release, the hub keeps the last value, and an untrusted turn posts a system line and finalises with an error instead of running. `run_shell` is gated by default (channel config `approval_tools`, default `["run_shell"]`); a gated call opens an approval card on the ledger and waits up to an hour for Allow or Deny. The `claude` member runs with `acceptEdits` (or `bypassPermissions` with the explicit full-access box), as in substrata.

### backend/app/services/cogentics/llm.py · Client

- refers-to: backend/app/services/cogentics/llm.py :: Client; backend/app/services/cogentics/catalog.py
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Ported from substrata `core/llm.py` and `core/model_catalog.py`. The provider settings (provider, base URL, model) live in `<data dir>/cogentics-provider.json`; the API key lives only in the keyring under the name `cogentics-api-key` in the `subform` service, never in a file. substrata kept the key in `~/.substrata_llm.json`. The live model price list is cached in `<data dir>/cogentics-models.json`. The curated catalog and the six roster presets are copied from substrata (verified there on 2026-07-19) and were not re-verified here.

### backend/app/routers/insight.py · routes and scopes

- refers-to: backend/app/routers/insight.py :: scopes, changes, diff, revert; backend/app/services/cogentics/checkpoints.py, usage.py
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Ported from substrata `routers/insight.py`, `core/usage.py` and `core/checkpoints.py`.

### Security review fixes (channel policy, checkpoints, paths)

- refers-to: backend/app/services/cogentics/paths.py, store.py, checkpoints.py, tools.py, hub.py, roster.py, turns.py, agent.py, compose.py; backend/app/routers/insight.py
- kind: rationale
- logged: v0.14.0 · 2026-10-31

State no longer lives in the workspace. `paths.state_dir` now returns `<data dir>/cogentics-state/<sha256 of the real workspace root, 24 hex>`, and channels (members, kind, full_access, model, session_ref, role_prompt, approval_tools, groups, message logs), checkpoints and usage all sit under it. A cloned repository can therefore no longer carry a channel file that turns on bypassPermissions, empties the run_shell gate, resumes an attacker-chosen session or pre-writes routing history, and a checkpoint manifest from a repository can no longer make revert overwrite or delete workspace files. The same keying by workspace and channel is what the review asked for; it is done by directory instead of per-field so there is one trust boundary and nothing to merge. Cost: the history is not readable inside the workspace by a Claude CLI member, so the briefing now says the recent ledger is included and the member can ask in the channel; API agents keep channel_search. Old `.subform/cogentics` data in a workspace is ignored, not migrated.

Member model and session_ref must match `^(?!-)[A-Za-z0-9._:/@-]{1,120}$` (`paths.valid_ref`); add_member rejects a bad model, `_claude_cmd` drops a bad value, and a session id printed by the CLI is stored only if it matches, so a value can never become a flag. Approval cards now carry the full JSON arguments with no length cut (write_file shows its content length and the diff). write_file through the agent uses `paths.safe_target`: `ws.resolve(write=True)` plus a refusal of any symlinked component. Writes under `.subform/plugins`, `.subform/cogentics`, `.claude`, `.mcp.json` and `.git` (resolved real path, case-insensitive, or a symlinked path) are gated regardless of `approval_tools`; `.git` is still refused outright by `ws.resolve`. `hub.trusted` is a property bound to the real workspace root: it is true only for the root it was set for, so switching workspace resets it until the window reports trust again. Checkpoint record and revert refuse symlinked paths and require a regular pre-image file; `GET /insight/scopes/{scope}/file` needs the window token. The routes move from `/api/usage/*` and `/api/runs/{id}/changes*` to `/api/insight/usage/*` and `/api/insight/scopes/{scope}/*` so they cannot collide with a runs router; a scope id is the checkpoint scope itself (`run-<id>` for a graph run, `cog-<channel>-<seq>` for a cogentics turn). `GET /api/insight/scopes` is new (substrata had no list): it reads every manifest under `.subform/checkpoints`. `/api/session` (the substrata token) is not ported; the window token replaces it. Revert needs the window token, and both the diff and revert paths go through `workspace_root.resolve` first. Coverage is the same as substrata: shell side changes bypass the pre-image layer, the git panel is the net for those.
