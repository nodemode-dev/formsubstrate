# HASHOUT_LOG · frontend/src/io (engine clients) · formsubstrate

Living log for the window's engine clients added or changed in F6 to F8: io/formslot.ts, io/sessions.ts (gates), io/debug.ts and io/git.ts. Source files stay comment-free; what they would have said lives here. The window-wide log is frontend/HASHOUT_LOG.md.

Current build version: v0.20.0
Last updated: 2026-11-22

### frontend/src/io/formslot.ts · formslotState

- refers-to: frontend/src/io/formslot.ts :: formslotState
- kind: rationale
- logged: v0.7.0 · 2026-10-30

One shared state object owns the formslot status poll (5 s, skipped while the tab is hidden or formslot is disabled in Preferences), the drift cache (20 s max age, one request in flight) and the active session id used by the status figure. The status bar, panel, install offer and review badges all read it, so the engine is asked once. `refresh(true)` waits for a poll in flight and then runs a new one; the install offer uses it so a status fetched for the previous workspace is never judged for the new one.

### frontend/src/io/formslot.ts · tool

- refers-to: frontend/src/io/formslot.ts :: tool
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Wraps `POST /api/formslot/mcp` as JSON-RPC tools/call and returns structuredContent, else the text parsed as JSON. isError and JSON-RPC errors become FormslotError.

### frontend/src/io/formslot.ts · asGate

- refers-to: frontend/src/io/formslot.ts :: asGate
- kind: warning-context
- logged: v0.7.0 · 2026-10-30

The contract left the SSE payload open; asGate accepts a bare Gate or `{gate}` and fills missing fields. `gate-closed` carries the full Gate with choice set (use, adapt, write, timeout, abandoned), so only its id is read.

### frontend/src/io/sessions.ts · gates

- refers-to: frontend/src/io/sessions.ts :: SessionsClient
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Open gates live in the client (`gates`, events gate, gateClosed, gates). On every SSE open the client reloads GET /api/gates and drops gates no longer open, covering frames missed while disconnected. Replayed `gate` frames are idempotent by id.

### frontend/src/io/debug.ts · DapConnection

- refers-to: frontend/src/io/debug.ts :: DapConnection
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Minimal DAP client over the relay socket: seq numbered requests with a 20 s timeout, responses matched by request_seq, events fanned out. Pending requests fail with Disconnected when the socket closes, so no promise is left hanging. The close handlers get a reason word (busy, unavailable, closed) from the engine's close codes.

### frontend/src/io/git.ts · refusable, push, signAndPush, audit, writeWorktreeFile

- refers-to: frontend/src/io/git.ts :: refusable, git.push, git.signAndPush, git.audit, git.writeWorktreeFile
- kind: rationale
- logged: v0.7.0 · 2026-10-30

Push and Sign and Push share one function that reads the refusal body (`check`, `output`) from a 409; the old signAndPush body moved into it unchanged. `git.push` now returns `{ok, check, output}`. `audit` and `writeWorktreeFile` wrap the two new routes. `FileDiff` gains `mtime`.

### frontend/src/io/formslot.ts · owner, ensureToken

- refers-to: frontend/src/io/formslot.ts :: owner, ensureToken, formslot, gates
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review H1: the owner calls (start, index, install, confirm, drift, the mcp forwarder and the gate answer) go through `owner`, which sends the engine's window token as `X-Subform-Window`. The token comes from `POST /api/window-token`, is fetched once and cached as a promise (a failed fetch clears the cache), and on a 403 is dropped and fetched again once before the call is retried. Status polling and the gate list do not need it.

### frontend/src/io/formslot.ts · FormslotState fixes

- refers-to: frontend/src/io/formslot.ts :: FormslotState.phase, start, ensureDrift, forgetDrift, asGate
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review LOW 7: `phase` is `unreachable` whenever the last poll failed, not only before the first status, so the status bar stops claiming formslot is running while the engine is down. LOW 9: `start` returns the shared in-flight promise, so a second caller waits for the real start. LOW 8: a generation counter is bumped by `forgetDrift`; a drift answer from the previous workspace is ignored and cannot set the 20 s freshness stamp, and `ensureDrift(true)` during a fetch waits for it and then fetches again. LOW 11: `asGate` keeps only slots with a string id and path and coerces `line` to a non-negative number.

### frontend/src/io/sessions.ts · gate event

- refers-to: frontend/src/io/sessions.ts :: SessionsClient.connect (gate listener)
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review LOW 12: a repeated `gate` event for an id already open updates the stored gate and no longer re-emits, so reconnects do not repeat desktop notifications; a `gate` event that already carries a choice closes that gate.

### frontend/src/io/window-token.ts · owner, windowToken

- refers-to: frontend/src/io/window-token.ts :: owner, windowToken, forgetWindowToken
- kind: rationale
- logged: v0.10.0 · 2026-10-30

review M3. One token helper replaces the two copies in `formslot.ts` and `create.ts`. `windowToken()` asks the Tauri shell (`invoke('window_token')`) first and falls back to `POST /api/window-token`, which only the browser development build answers; the promise is cached and a failed fetch clears it. `owner()` sets `X-Subform-Window` and, on an `ApiError` whose status is 403, drops the cache and retries once. `formslot.ts` wraps it to keep its `FormslotError` mapping; `create.ts` uses it directly.

### frontend/src/io/git.ts, workspace.ts, sessions.ts · owner on guarded routes

- refers-to: frontend/src/io/git.ts :: held, refusable, git.hunks, git.stage, git.unstage, git.discard, git.commit, git.setIdentity, git.snapshot, git.rewind, git.comment, git.writeWorktreeFile; frontend/src/io/workspace.ts :: openWorkspace, forgetRecent, writeFile, makeDir, renamePath, deletePath; frontend/src/io/sessions.ts :: SessionsClient.resume, SessionsClient.stopSession, SessionsClient.remove
- kind: rationale
- logged: v0.19.0 · 2026-11-22

The engine now asks for the window token on every git, workspace and session change (see `backend/app/routers/HASHOUT_LOG.md`, entry of v0.19.0). These callers send through `owner()` from `window-token.ts` instead of `request()`. In `git.ts` the helper `held` wraps `owner` the way `call` wraps `request`, so callers still get a `GitError`; `refusable` (push and sign-and-push) calls `owner` and keeps its 409 mapping. `SessionsClient.create` already used `owner`. No other file in `frontend/src` calls these routes.

### frontend/src/io/workspace.ts · listFiles, WorkspaceFiles

- refers-to: frontend/src/io/workspace.ts :: listFiles, WorkspaceFiles; frontend/src/ui/palette/files.ts :: FileIndex.run
- kind: rationale
- logged: v0.22.0 · 2026-11-22

`listFiles(hide, signal)` calls `GET /api/workspace/files` with one `hide` parameter per hidden-folder name and answers `{files, truncated}`. It uses `request()`, not `owner()`, because the route is a read and takes no window key, like `listDir`. The type is named `WorkspaceFiles` because `FileList` is a DOM type. Its only caller is Go to File (see frontend/src/ui/palette/HASHOUT_LOG.md).

### frontend/src/io/git.ts · git.fileLog, git.show, git.log (skip), FileCommit, FileLog, CommitDiff

- refers-to: frontend/src/io/git.ts :: git.fileLog, git.show, git.log, FileCommit, FileLog, CommitDiff; frontend/src/extensions/git/history.ts :: FileHistory; frontend/src/ui/review/diff-view.ts :: DiffTab.load
- kind: rationale
- logged: v0.23.0 · 2026-11-22

`fileLog(path, {session, limit, skip})` is `GET /api/git/log` with `path`, kept apart from `log()` because it answers the whole object (`commits`, `path`, `folder`, `more`) and its rows carry `status`, `path` and `oldPath`; `log()` keeps its `Commit[]` answer and gained `skip`. `show(sha, path, session)` is `GET /api/git/show`; `CommitDiff` extends `FileDiff`, so the diff tab draws it with the code it uses for a working-tree diff. Both use `call()`, not `owner()`: the routes are reads and take no window key.

### frontend/src/io/lsp.ts · customLsp, CUSTOM_LSP_EVENT, syncTrust, trustSynced, forgetTrustSync, lspSocketUrl, LspLang
- refers-to: frontend/src/io/lsp.ts :: LspLang, CUSTOM_LSP_EVENT, CustomServerFields, CustomServer, CustomPreset, CustomListing, customLsp, trustKey, trustSynced, forgetTrustSync, syncTrust, LspServers, lspSocketUrl, SymbolHub.search
- kind: rationale
- logged: v0.24.0 · 2026-11-22

`LspLang` is a built-in name or `custom:<id>`. `customLsp` is the client for `/api/lsp/custom`; add, change and remove go through `owner()` (the window key) and dispatch `formsubstrate:lsp-custom-changed` on success. `syncTrust()` tells the engine whether the open workspace is trusted (`POST /api/lsp/trust`), once per pair of workspace path and trust; `trustSynced()` says whether that pair has been answered, and `forgetTrustSync()` makes the next call send again (Restart Language Servers uses it after an engine restart). The engine no longer believes `trust=1`, so `lspSocketUrl` no longer adds it, and the lang is URL-encoded because a custom lang has a colon. Workspace symbol search awaits `syncTrust()` before its sockets open. Removed: the import of `trustQuery` and `${trustQuery('&')}` at the end of the socket URL.

### frontend/src/io/tasks.ts, frontend/src/io/keybindings.ts · clients

- refers-to: frontend/src/io/tasks.ts :: listTasks, taskState, runTask, stopTask, createTaskFile, OWN_TASK_FILE, VSCODE_TASK_FILE; frontend/src/io/keybindings.ts :: adoptSavedKeys, commitKeys, keysLoaded, KEYS_EVENT
- kind: rationale
- logged: v0.25.0 · 2026-11-22

`io/tasks.ts` is the typed client of the five task routes; reads go through `request`, changes through `owner` (the window key, one retry after a 403). `io/keybindings.ts` holds the load and save of the shortcut file and the `loaded` flag the Keys page asks about; it imports the `Commands` type from `ui`, as `io/trust.ts` imports from `ui/prefs`. Anything in the answer that is not a list of text is dropped before `Commands.adopt` sees it.

### frontend/src/io/agents.ts · agents, formnet, AGENT_PROGRAMS, AGENT_MODES

- refers-to: frontend/src/io/agents.ts :: AgentInfo, FormnetStatus, AGENT_PROGRAMS, AGENT_MODES, agentTitle, agents, formnet; frontend/src/io/sessions.ts :: Session.agent, NewSessionBody.agent
- kind: rationale
- logged: v0.25.0 · 2026-11-22

`agents.list()` reads `GET /api/agents` and keeps the last answer (`cached()`), so New Session and Preferences paint what is known at once and patch when the fresh answer comes; concurrent callers share one request. `setPath` and `formnet.save` go through `owner` (the window key). `AGENT_PROGRAMS` and `AGENT_MODES` repeat the engine's order and `CAPS` modes so the dialog is complete before any answer; the engine still refuses what it does not allow.
