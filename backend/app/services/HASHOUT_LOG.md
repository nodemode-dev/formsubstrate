# HASHOUT_LOG · terminals and sessions (pty-host, services, routers) · subform

Living log for Phase F5's engine side: backend/subform_ptyhost.py, backend/app/services/ptyhost_client.py, backend/app/services/sessions.py, backend/app/routers/terminal.py, sessions.py and skills.py. The protocol they implement is the F5 contract kept in the planning sidecar. Source files stay comment-free; what they would have said lives here. The engine-wide log is backend/HASHOUT_LOG.md.

Current build version: v0.5.0
Last updated: 2026-10-30 · Phase F5

### backend/subform_ptyhost.py · module

- refers-to: backend/subform_ptyhost.py :: Host
- kind: explainer
- logged: v0.5.0 · 2026-10-30

The detached pty-host. One asyncio process owns every PTY so an engine crash, restart or kill -9 does not touch the shells or agents. Started by the engine with `start_new_session=True` (own session and process group) and stdio to `<data_dir>/ptyhost.log`. A flock on `<data_dir>/ptyhost.lock` makes a second host exit 0 at once; the lock dies with the process, so a crash never leaves a stale lock. Files: `ptyhost.sock` (mode 0600, umask 0177 around bind), `ptyhost.pid`; on Windows `ptyhost.port` and `ptyhost.token` and a mandatory `hello` frame carrying the token. The port-and-token pair on Windows is untested here (no Windows machine); the pywinpty class `WinPty` is coded behind `sys.platform == "win32"` and untested for the same reason. Unix socket paths have a length limit (104 bytes on macOS); the data folder paths in use fit, a deeper override would not.

### backend/subform_ptyhost.py · Term.feed, flow control

- refers-to: backend/subform_ptyhost.py :: Host.feed
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Frames are length-prefixed JSON; output is base64 in `data` and `seq` is the byte offset of its first byte. Flow control counts bytes sent to attached connections and not yet acknowledged; at 256 KiB the PTY reader is removed from the loop (posix `remove_reader`, Windows thread gate), below 64 KiB it is added back. The kernel's own PTY buffer then blocks the child, which is the point. Bound seen in the check: 262,268 unacked (256 KiB plus the last 64 KiB read). Unacked is only counted while something is attached: with nobody attached the host just fills the 2 MiB ring, and attach and detach reset the count to zero (replayed bytes count as unacked, so a big replay also pauses the PTY until the window acks). Additive fields beyond the contract: `list` rows carry `meta`, `unacked`, `paused`, `attached`; `attached` (reply to attach, with the real start offset and the ring base) and `killed` (reply to kill) are new ops. `meta` is how the engine keeps title, kind and sessionId across an engine restart without any engine-side store.

### backend/subform_ptyhost.py · Host.attach

- refers-to: backend/subform_ptyhost.py :: Host.attach
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Replay sends the ring from `from` (null means from the oldest retained byte; a value below the ring base is raised to the base; beyond the end is clamped to the end) in 64 KiB frames, then joins the live subscribers with no await between the last length check and the join, so no byte is lost or doubled between replay and live. If the terminal already ended, an `exit` frame follows the replay.

### backend/subform_ptyhost.py · Host.finalize and reaper

- refers-to: backend/subform_ptyhost.py :: Host.finalize
- kind: rationale
- logged: v0.5.0 · 2026-10-30

A terminal ends either when the PTY read hits EOF or when the 0.5 s reaper sees the child gone (a background job can hold the PTY open after the shell exits). Both paths drain what is left in the PTY, then wait up to 5 s for the child to be reaped, force-kill if it is not, and send `exit` with the code (128 plus the signal number when signalled). Ended terminals stay in the registry, with their ring, until a `kill` op removes them. kill sends SIGHUP to the process group, waits 1 s, then SIGKILL. The host exits by itself after SUBFORM_PTYHOST_IDLE seconds (default 600) with no engine connected and no live terminal; SIGTERM kills all terminals and exits.

### backend/app/services/ptyhost_client.py · PtyHostClient

- refers-to: backend/app/services/ptyhost_client.py :: PtyHostClient
- kind: explainer
- logged: v0.5.0 · 2026-10-30

One connection to the host. `ensure(start)` connects, or starts the host (Popen, detached) and polls up to 10 s; reads and detaches use `start=False` so listing terminals or closing a window never launches a host. `request(msg, reply)` waits for the reply op for that id (any `error` for that id wins and raises); frames without a waiter go to `events()`, an async iterator that also yields `{"op":"disconnected"}` and, after reconnecting with backoff (0.25 s to 2 s, connect only), `{"op":"connected"}`. `close()` just closes the socket: the host sees the engine leave and the terminals keep running. Frozen builds start the host as `<exe> --ptyhost --data-dir D` (see EDITS.md).

### backend/app/routers/terminal.py · Hub

- refers-to: backend/app/routers/terminal.py :: Hub
- kind: rationale
- logged: v0.5.0 · 2026-10-30

One pump task reads host events and fans them out to websocket subscribers; each socket has its own send queue and writer task so a slow window never stalls the pump (bounded by the host's 256 KiB window per terminal). Each subscriber tracks `next`, the offset it expects. A subscriber is "pending" from its attach until the host's `attached` reply sets `next` to the real start, so in-flight live output from before the attach can neither be sent twice nor swallow the replay. Output below `next` is trimmed or dropped; bytes that nobody forwarded are acked by the engine on the window's behalf so the host never stalls on them. After a host reconnect the pump re-attaches every subscribed terminal from `next`. Window acks are relayed as they come. The terminal title comes from OSC 0 or 2 in the output (kept in engine memory only; after an engine restart the title is the one given at creation). Ids are 16 characters from a-z0-9 drawn with `secrets`.

### backend/app/routers/terminal.py · confine

- refers-to: backend/app/routers/terminal.py :: confine
- kind: rationale
- logged: v0.5.0 · 2026-10-30

A relative cwd goes through `workspace_root.resolve` (so `..`, symlink escapes and no-workspace give the same 403/409 as the file routes). An absolute cwd is accepted only when its realpath is inside the open workspace or inside realpath of `<data_dir>/worktrees`; the worktree case works without a workspace open. The claude terminal is launched with `binres.find_bin("claude")` (404 with a clear detail when absent) and `--mcp-config` pointing at `<cwd>/.subform/mcp.json`, or `<data_dir>/worktrees/*/<sessionId>/.subform/mcp.json`, only if that file exists. The shell is `$SHELL -l` (falling back to bash, then sh) or COMSPEC on Windows. The environment is inherited with TERM=xterm-256color, COLORTERM=truecolor and SUBFORM_TERMINAL=1.

### backend/app/routers/terminal.py · shutdown

- refers-to: backend/app/routers/terminal.py :: shutdown
- kind: warning-context
- logged: v0.5.0 · 2026-10-30

Called from the lifespan after `yield`: closes the host socket and stops the pump. It must never send `kill`; terminals outlive the engine on purpose.

### Ported ideas

- refers-to: backend/subform_ptyhost.py :: PosixPty
- kind: explainer
- logged: v0.5.0 · 2026-10-30

Shell choice and the TERM, COLORTERM variables follow formvis backend/app/services/terminal.py (Apache-2.0, owner's); the rest (separate host, ring, ack flow control, multiplexed socket) is new. Nothing was copied from substrata's terminal router.
### backend/app/services/sessions.py · registry

- refers-to: backend/app/services/sessions.py :: _save, _load, _sessions
- kind: rationale
- logged: v0.5.0 · 2026-10-30

`<data_dir>/sessions.json` holds `{"sessions":[...]}`. Writes go to `sessions.json.tmp` then `os.replace`, under a threading lock (route handlers and the event consumer run on one loop, the lock also covers threadpool callers). The stored record is the public Session plus `repoName`, `base` and `notes`; `repo` is the absolute repository root (needed to run `git worktree remove` later), which is a superset of the contract shape. Unknown extra fields are ignored by clients.

### backend/app/services/sessions.py · create

- refers-to: backend/app/services/sessions.py :: create, _exclude_subform, _worktree_path
- kind: explainer
- logged: v0.5.0 · 2026-10-30

Order: check `claude` (404 if absent), resolve the open workspace's repository (`rev-parse --show-toplevel`, 409 when not a repo or no commit), verify the base resolves to a commit (400), then `git worktree add -b sf/<id> <path> <base>` with plain git from `binres.find_bin("git")` (hooks are the user's, no `core.hooksPath` override). The path is `<data_dir>/worktrees/<repo-name>-<sha1(realpath)[:8]>/<id>`. `.subform/` is appended once to `<git-common-dir>/info/exclude`, so it is ignored in the main checkout and in every worktree (linked worktrees read the common exclude file). The interactive `prompt` is not sent to the terminal: claude's interactive input is the user's.

### backend/app/services/sessions.py · _mcp_config

- refers-to: backend/app/services/sessions.py :: _mcp_config, _formslot_has_mcp
- kind: rationale
- logged: v0.5.0 · 2026-10-30

An entry is written only when its program exists. formMCP: `FORMMCP_BIN`, else `find_bin("formmcp")`, args `[]`. formslot: `find_bin("formslot")` and `formslot --help` shows a line starting with `mcp` (the S8 gate), args `["mcp"]`. subform's own server is always left out until F9. Every omission is a string in `notes`. An empty `mcpServers` is still written so `--mcp-config` always has a valid file.

### backend/app/services/sessions.py · _launch

- refers-to: backend/app/services/sessions.py :: _launch, _watch, _host
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Processes are started through sf-pty's `app.routers.terminal.launch(kind, cwd, title, session_id, cols, rows, argv=...)`, so every session process (headless runs too) is a visible terminal in the dock with `sessionId` set. The sessions service keeps its OWN `PtyHostClient()` connection (not `get_client()`): `PtyHostClient.events()` is a single queue already drained by the terminal hub, and the pty-host only sends output to a connection that has sent `attach`. The second connection attaches to each session terminal (headless: from offset 0 so the stream is replayed whole; interactive: from `1 << 62`, which the host clamps to the end, so only the exit is of interest), acks every output frame (the host pauses a PTY at 256 KiB unacked) and tracks the next offset per terminal for re-attach after a reconnect.

### backend/app/services/sessions.py · _on_line

- refers-to: backend/app/services/sessions.py :: _on_line, _feed
- kind: explainer
- logged: v0.5.0 · 2026-10-30

stream-json parsing, one JSON object per line, PTY `\r\n` tolerated by stripping. `system`/`init` gives `session_id`. `assistant` text blocks become `lastMessage` (clipped to 600 chars); a `tool_use` named AskUserQuestion, or a system event whose subtype is permission_request/input_request/permission_denied, maps to needs-input. `result`: `is_error` or a subtype starting `error` is failed with the result text; a non-empty `permission_denials` is needs-input naming the tools (a `-p` run cannot prompt, it ends having been denied); anything else is done. Lines that are not JSON (a login error, a crash) are kept as a 4000-char tail, ANSI stripped; if the process exits with no `result` event the session is failed with that tail as `lastMessage`, so a run that cannot log in ends failed with the CLI's own words instead of hanging as working. Not covered: a run that stays alive and silent forever has no timeout.

### backend/app/services/sessions.py · _on_exit

- refers-to: backend/app/services/sessions.py :: _on_exit, _discover_claude_session
- kind: explainer
- logged: v0.5.0 · 2026-10-30

Interactive terminal exit: code 0 is done, anything else stopped (resumable; also what closing the terminal from the dock gives). Interactive sessions do not announce their conversation id, so `claudeSessionId` is discovered on stop, exit and resume from the newest `*.jsonl` in `~/.claude/projects/<worktree path with non-alphanumerics replaced by '-'>`; when none is found, resume uses `claude --continue`, which picks the newest conversation of the worktree directory (each worktree is unique to one session). Resume turns the session's `mode` to interactive.

### backend/app/services/sessions.py · reconcile

- refers-to: backend/app/services/sessions.py :: reconcile
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Runs in the lifespan. Sessions in working/needs-input are matched to `PtyHostClient.list(start=False)` (never starts a host). A terminal still known to the host is re-attached (headless from 0, so a run that finished while the engine was away is replayed to its `result` and ends done/failed; one still running continues); one the host no longer knows, or a missing worktree, is stopped (worktree present, resumable) or failed (worktree gone). Reconciliation notices are suppressed.

### backend/app/services/sessions.py · delete

- refers-to: backend/app/services/sessions.py :: delete
- kind: rationale
- logged: v0.5.0 · 2026-10-30

With `removeWorktree`, `git status --porcelain` in the worktree must be empty (untracked counts; `.subform/` is excluded) or the call is 409 unless `force`. Then `worktree remove [--force]`, `worktree prune`, and `git branch -d sf/<id>` (the safe delete: a branch with commits not merged into the repo's HEAD survives, which is intended). The registry entry is dropped and an extra SSE event `removed` `{"id"}` is published so the window can drop the row (not in the contract; clients that ignore it can poll `GET /api/sessions`).

### backend/app/services/sessions.py · list_skills, _front_matter

- refers-to: backend/app/services/sessions.py :: list_skills, _front_matter
- kind: explainer
- logged: v0.5.0 · 2026-10-30

Reads `<workspace>/.claude/skills/*/SKILL.md` (path returned workspace-relative, POSIX) and `~/.claude/skills/*/SKILL.md` (absolute path). The front matter is parsed by hand (no YAML dependency): scalars, quoted scalars, `>`/`|` block scalars and indented continuation lines are enough for `name` and `description`. A project skill whose real path leaves the workspace (symlink) is skipped; files over 512 KiB are skipped. `name` falls back to the folder name.

### backend/app/routers/sessions.py · events

- refers-to: backend/app/routers/sessions.py :: events
- kind: explainer
- logged: v0.5.0 · 2026-10-30

SSE: `retry: 2000`, then one `event: session` per existing session (so a reconnecting window resyncs), then live `session`, `notice` and `removed` frames; a `: keepalive` comment every 15 s. Notices fire on a state change into needs-input, done (kind "completed") or failed, never for stopped. Declared before the `{session_id}` routes.

### backend/app/routers/skills.py · skills

- refers-to: backend/app/routers/skills.py :: skills
- kind: explainer
- logged: v0.5.0 · 2026-10-30

`GET /api/skills`, in its own router file as the contract asks; the scanning lives in the sessions service because it shares the workspace root logic. Runs in the threadpool (file reads).
