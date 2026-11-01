# HASHOUT_LOG · frontend/src/io (engine clients) · subform

Living log for the window's engine clients added or changed in F6 to F8: io/formslot.ts, io/sessions.ts (gates), io/debug.ts and io/git.ts. Source files stay comment-free; what they would have said lives here. The window-wide log is frontend/HASHOUT_LOG.md.

Current build version: v0.7.0
Last updated: 2026-10-30 · Phases F6 carries, F7 and F8

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
