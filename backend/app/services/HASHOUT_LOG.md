# HASHOUT_LOG · terminals and sessions (pty-host, services, routers) · formsubstrate

Living log for Phase F5's engine side: backend/formsubstrate_ptyhost.py, backend/app/services/ptyhost_client.py, backend/app/services/sessions.py, backend/app/routers/terminal.py, sessions.py and skills.py. The protocol they implement is the F5 contract kept in the planning sidecar. Source files stay comment-free; what they would have said lives here. The engine-wide log is backend/HASHOUT_LOG.md.

Current build version: v0.20.0
Last updated: 2026-11-22

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

### F5 engine review fixes (v0.5.1)

- refers-to: backend/app/routers/terminal.py :: Sub.writer, Sub.take, Hub.output, Hub.drop, Hub.detach, find_mcp_config, terminals_ws; backend/app/services/sessions.py :: resume, delete, _start_headless, _load, _set_aside; backend/app/routers/sessions.py :: NewSession.prompt; backend/subform_ptyhost.py :: Pty.sweep, Host.kill, resize
- kind: bug-context
- logged: v0.5.1 · 2026-10-30

From the fresh-context review of 006c86b..v0.5.0, each reproduced before the fix. Flow control is now accounted per socket: a subscriber owes the host only bytes its writer has actually sent, a browser ack is clamped to what that subscriber owes, and on detach whatever it still owes (and anything still queued for it) is acked to the host, so a second tab that attaches, gets the replay and leaves without acking no longer leaves the host paused and the first tab frozen (rerun of the repro: unacked 0, paused False, probe echoed). Bytes no subscriber took are acked at once. A subscriber with more than 8 MiB queued is dropped (close 1013), so a client that never reads cannot grow the engine. WebSocket input over 1 MiB is refused and resize is clamped to 1..1000 by 1..500 in the router and 10..1000 by 4..500 in the host, which stores the size only after the ioctl succeeds. `--mcp-config` is only ever the engine-written file under the session's worktree; a repository's own `.subform/mcp.json` is never passed to claude (a CLI-given config skips claude's project approval). Resume marks the session working before its first await and restores the state on failure, so concurrent resumes get 409 instead of orphaned claude processes. A failed `git worktree remove` leaves the session stopped rather than working with a dead terminal. The headless prompt follows `--` (a prompt starting with `-` was parsed as an option; checked with the fake claude: `... --mcp-config <path> -- --version`) and is capped at 100,000 characters (422 above). The registry loader requires state, mode, title, repo, worktree and branch as strings, maps unknown states to failed, and copies the file aside (`sessions.json.corrupt-<time>`) when it drops an entry; an unreadable file is moved aside instead of being silently overwritten by the next save. After a kill the host sends SIGKILL to the process group once more, so children that ignore SIGHUP do not outlive their terminal.

Known and left for F6: finished terminals stay in the host (with their ring) until killed; and SIGTERM waits on an open SSE stream (`/api/sessions/events`) before the lifespan shutdown runs.

## F6 git, review, rewind and the commit wrapper (v0.6.0)

From the sf-git-engine build (gitops service, git router, session changes) and the carried F5 engine items.

### backend/app/services/gitops.py · module

- refers-to: backend/app/services/gitops.py :: gitops
- kind: explainer
- logged: v0.6.0 · 2026-10-30

All git logic of Phase F6. Written fresh for subform; the idea of one module holding status, diff, log, stage, discard, commit and push, and the plain subprocess-against-the-user's-git approach (credential helpers and config apply unchanged), come from substrata `backend/app/core/gitops.py` (MIT, owner's). The synchronous `subprocess.run` helper there became an async `asyncio.create_subprocess_exec` runner (same shape as sessions.py `_run`), status moved from porcelain v1 to `--porcelain=v2 -z --branch`, and everything else (hunks, review, snapshots, rewind, commit wrapper, identity, sign-and-push) is new. substrata's agent tool trio (git_status, git_diff, git_commit) was not ported.

Every git call runs as `git -c core.quotepath=off ...` with `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, no shell, and with GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE removed from the inherited environment so a stray variable cannot redirect it. Text from git is decoded with `surrogateescape` so a patch built from it re-encodes byte for byte; `_pub` turns it into valid UTF-8 only at the JSON edge.

### backend/app/services/gitops.py · resolve_target

- refers-to: backend/app/services/gitops.py :: resolve_target
- kind: rationale
- logged: v0.6.0 · 2026-10-30

A workspace target must be the top folder of its git repository (409 otherwise). `git status` and `git diff` report repository-relative paths and the contract says paths are relative to the target root, so a workspace opened on a subfolder would make every path wrong. Refusing is cheaper and safer than translating. Session targets are always a worktree top. The sessions module is imported lazily inside the function because sessions.py imports gitops at module level.

### backend/app/services/gitops.py · parse_diff, _hunk_id

- refers-to: backend/app/services/gitops.py :: parse_diff
- kind: rationale
- logged: v0.6.0 · 2026-10-30

Hunks are parsed from `git diff --diff-algorithm=histogram -U3`. The public hunk lines hold only " ", "+" and "-", but each hunk also keeps its raw lines including the "\ No newline at end of file" markers, because those must be in a patch for it to apply exactly. The id is sha1 of path, header and lines as the contract says, so rejecting an earlier hunk shifts the line numbers of later hunks and changes their ids; the response of a hunk action returns the refreshed FileReview so the UI does not hold stale ids.

### backend/app/services/gitops.py · hunks_action

- refers-to: backend/app/services/gitops.py :: hunks_action
- kind: rationale
- logged: v0.6.0 · 2026-10-30

Exactness: the patch is rebuilt from the freshly computed hunks (working tree against HEAD) selected by id; an id that is not in the fresh diff is 409 before anything is touched, then `git apply --check` runs before every real apply. Accept applies with `--cached --unidiff-zero`; if the check fails but the reverse check passes the hunk is already staged and counts as applied. Reject checks `-R` on the working tree first, takes the `before reject <path>` snapshot, applies `-R` to the working tree and, when the reverse check passes, `-R --cached` too. Context lines stay in the patch (-U3), so git apply can find a hunk after offsets caused by other staged hunks; hunks of one file never overlap in context because git merges hunks closer than 6 lines.

Whole-file cases (id `*`, untracked, new, deleted, renamed or binary files) do not go through a patch: accept is `git add -A -- paths`, reject is `git restore --source=HEAD --staged --worktree` (or deleting an untracked file, or `git rm -f --cached` plus deleting a file that is not in HEAD). A partial selection on those kinds is 400. Reviewed hunks carry an extra boolean `staged` (additive to the contract): a hunk is staged when the index-against-HEAD diff contains the same lines. Without it the review could not show accepted hunks, since accepting stages and the working tree still differs from HEAD.

### backend/app/services/gitops.py · snapshot_create, rewind

- refers-to: backend/app/services/gitops.py :: snapshot_create
- kind: rationale
- logged: v0.6.0 · 2026-10-30

Snapshots never touch HEAD, the index or a branch: a throwaway index in a temp folder (`GIT_INDEX_FILE`), `read-tree HEAD`, `add -A` (honours ignore rules, so ignored files are not captured), `write-tree`, `commit-tree -p HEAD` with a fixed subform identity and signing off, then `update-ref refs/subform/snapshots/<key>/<n>`. The commit message is the label, a blank line, and `files: N` (files that differ from HEAD) which list parses back out of `for-each-ref`. At most 50 per key; older refs are deleted. The session's count is mirrored into the session record (`snapshotCount`) through `sessions.note_snapshots` so `public()` stays synchronous.

Rewind takes a safety snapshot first, loads the target commit into another temp index, deletes the files that are in the real working tree (tracked or untracked, not ignored) but not in the snapshot tree, then `checkout-index -a -f` from the temp index. The real index and HEAD are never written. Because the real index is untouched, a file staged as new and then removed by the rewind shows as added-and-deleted until the user unstages it.

### backend/app/services/gitops.py · commit, clean_message, _audit

- refers-to: backend/app/services/gitops.py :: commit
- kind: rationale
- logged: v0.6.0 · 2026-10-30

The wrapper strips every line containing `Generated with [Claude Code]`, then trailing blank or trailer lines matching `^(Co-Authored-By|Claude-Session|Generated with|Signed-off-by: Claude)\b` (case-insensitive). Identity goes in twice, `-c user.name/email` and the four GIT_AUTHOR/COMMITTER variables, and amend uses `--reset-author` so an amended commit takes the identity too. A signing failure comes back as 409 with git's message and no commit exists because git aborts before writing it. The audit asks git for `%G?` with `gpg.ssh.allowedSignersFile` pointing at `<data_dir>/allowed_signers`, a file the engine writes from the stored identity (email plus the `.pub` contents), so the user's own signed commits read `G` instead of `N` or `B` (git cannot verify an ssh signature without such a file).

### backend/app/services/gitops.py · HOOK_SCRIPT, ensure_hooks, configure_worktree

- refers-to: backend/app/services/gitops.py :: HOOK_SCRIPT
- kind: rationale
- logged: v0.6.0 · 2026-10-30

The commit-msg hook is POSIX sh and uses two greps (an ERE for the trailer names, a fixed-string one for the Generated with line) because `\b` is not POSIX. It rewrites the message file in place and always exits 0; an empty result is rejected by git itself. It is rewritten when its text differs and made executable on every session create. `configure_worktree` turns on `extensions.worktreeConfig` in the main repository and then sets `user.name`, `user.email` (only when an identity is stored; the git global values apply otherwise) and `core.hooksPath` with `git config --worktree`, so the main checkout and the user's other worktrees are not affected. A user's global `commit.gpgsign=true` still applies to commits the agent makes; the engine does not override it.

### backend/app/services/gitops.py · sign_and_push

- refers-to: backend/app/services/gitops.py :: sign_and_push
- kind: rationale
- logged: v0.6.0 · 2026-10-30

Follows the dev-rules sequence without ssh-add: stored identity with sign and key, fetch, merge-base must equal the remote tip, N from rev-list, refuse N = 0, `rebase --exec "git commit --amend --no-edit --reset-author -S"` with identity and signing passed as `-c` (the exec'd git inherits them through GIT_CONFIG_PARAMETERS) and as environment. A failed rebase is aborted so the branch is left as it was. "Unsigned" is read from the `gpgsig` header of the raw commit object, not from `%G?`, so it does not depend on a verifiable key. The check line is built from the rewritten commits and a push happens only when it reads zero for the last three counters. An empty commit in the range makes the amend step fail; the rebase is aborted and git's message is returned.

### backend/app/routers/git.py · module

- refers-to: backend/app/routers/git.py :: router
- kind: explainer
- logged: v0.6.0 · 2026-10-30

Thin: every route resolves a target, calls gitops and maps `gitops.Refused` to HTTPException. Ported in layout only from substrata `backend/app/routers/git.py` (MIT, owner's); the routes themselves follow CONTRACT_F6. Bodies are lenient pydantic models with defaults and the real validation lives in gitops so bad input is 400 with a `detail`, not 422. sign-and-push is the one route that returns extra keys on 409 (`ok: false`, `check`, `output`) as the contract asks. The comments route stores the comment first, then tries to deliver it, so a delivery failure still leaves the comment recorded (`sent: stored`).

### backend/app/services/sessions.py · _mcp_arg, _write_settings

- refers-to: backend/app/services/sessions.py :: _mcp_arg
- kind: rationale
- logged: v0.6.0 · 2026-10-30

Both launch paths already build their argv from `_mcp_arg`, so `--settings <worktree>/.subform/settings.json` rides with `--mcp-config`. `claude --help` (2.1.314) lists `--settings <file-or-json>`. The file is written at create and rewritten on demand for sessions created before this release. `.subform/` is already in the repository's info/exclude, so the file is never committed.

### backend/app/services/sessions.py · send_feedback, record_comment

- refers-to: backend/app/services/sessions.py :: send_feedback
- kind: rationale
- logged: v0.6.0 · 2026-10-30

A live interactive session gets the text as one bracketed paste, a short pause, then a lone carriage return in a second write; sending them together makes the Claude Code prompt treat the return as part of the paste. Writes go through the pty-host client `send` with op `write` (the same call the terminal websocket uses). A headless session that is not running and has a claude session id starts `claude -p ... --resume <id> -- <text>` through `_start_headless` and goes back to working; a running headless session or an interactive one without a live terminal only stores the comment. Comments are kept in the session record, newest 200.

### backend/app/services/sessions.py · _on_exit, _snapshot

- refers-to: backend/app/services/sessions.py :: _on_exit
- kind: rationale
- logged: v0.6.0 · 2026-10-30

The old `_on_exit` body moved unchanged into `_finish_exit` because it has several early returns; the new wrapper notes whether the terminal was a headless stream before the stream is dropped and, if it was, schedules the `after run` snapshot as a task. Snapshot failures are swallowed so a snapshot problem never fails a session. The `session start` snapshot is taken before the agent launches, the `at stop` snapshot only for interactive sessions after the process is killed.

### backend/subform_ptyhost.py · Host.reaper, REAP_SECONDS

- refers-to: backend/subform_ptyhost.py :: Host.reaper
- kind: rationale
- logged: v0.5.2 · 2026-10-30

A terminal that has exited, has no subscribers and whose exit is REAP_SECONDS old (default 300, env SUBFORM_PTYHOST_REAP) is popped from `terms`, which frees its 2 MB ring and drops it from `list`. The exit frame is sent to every connection when the process ends, so "delivered" is satisfied by the time. A terminal a browser tab is still attached to is kept until that tab detaches. Closes the F5 leftover and review4 finding 9.

### backend/app/services/sessions.py · _release

- refers-to: backend/app/services/sessions.py :: _release, _on_exit
- kind: rationale
- logged: v0.5.2 · 2026-10-30

After a session terminal's exit has been handled, a headless terminal is killed in the host (the result was already read from its stream, so nothing is lost) and an interactive one is only detached by the sessions client, so the host's reaper can pop it once no browser tab is attached. Failures are ignored: the terminal may already be gone after a stop. The release task is scheduled before the exit handling so it cannot be skipped by an early return. Verified: a headless run's terminal left GET /api/terminals within 1.5 s.

### backend/app/routers/terminal.py · list_terminals

- refers-to: backend/app/routers/terminal.py :: list_terminals
- kind: rationale
- logged: v0.5.2 · 2026-10-30

Window titles kept by the hub for terminals the host no longer lists are dropped on each listing, so the title map does not grow after reaping.

### backend/app/main.py · _end_streams_on_signal

- refers-to: backend/app/main.py :: _end_streams_on_signal; backend/app/services/sessions.py :: close_streams, CLOSE
- kind: rationale
- logged: v0.5.2 · 2026-10-30

uvicorn waits for open connections before it runs the lifespan shutdown, and the sessions SSE stream never ends, so SIGTERM hung. The lifespan start chains a handler onto SIGTERM and SIGINT (uvicorn's own handler is kept and called) that posts `close_streams` to the loop; every subscriber queue gets a close item and the stream generator returns. A client that connects during shutdown gets the close item at once. The previous handlers are restored in the shutdown. Measured: curl -N on the stream, kill -TERM, engine gone in 1.6 s. Closes review4 finding 10.

### F6 engine review fixes (v0.6.1)

- refers-to: backend/app/services/gitops.py :: BRANCH_RE, CONTROL_RE, LINE_TRAILER_RE, lock_for, clean_path, _read_file, discard, clean_message, count_trailers, HOOK_SCRIPT, identity_put, snapshot_create, _remote_and_branch, _push_args, push, sign_and_push; backend/app/routers/git.py :: every mutating route, comments; backend/app/services/sessions.py :: send_feedback
- kind: bug-context
- logged: v0.6.1 · 2026-10-30

From the fresh-context review of 729a361..v0.6.0, each reproduced before the fix. A branch named `+main` was a force push: branch names now match `^[A-Za-z0-9_][A-Za-z0-9._/-]*$`, the remote must be one `git remote` lists, and push sends the explicit refspec `refs/heads/<b>:refs/heads/<b>` with `--no-force-with-lease` and `remote.<r>.push` cleared, so neither the name nor a configured push refspec can force (rerun: `+main` is 400, an unknown remote is 400). Review comments could leave the bracketed paste with `\x1b[201~` and type into the agent's shell: C0, DEL and C1 controls are removed from the comment text in the router and again in `send_feedback`, a path with controls is 400, and text is typed only while the session is `working`; at `needs-input` it is stored, so the Enter cannot answer a permission prompt. Sign-and-push no longer takes over other people's commits: the range is refused before any rewrite when it holds a merge or a commit by another author, and when the post-rebase check fails the branch is put back with `reset --keep` to where it was. A backslash is a name character on POSIX (it was turned into `/`, so discarding `a\b.txt` reverted `a/b.txt`). Discarding an untracked folder that holds its own `.git` is refused before anything is touched. Mutating routes take a per-repository asyncio lock, and snapshot refs are created with a create-only `update-ref` that moves to the next number on a clash (rerun: four parallel snapshots got four distinct numbers). The commit wrapper drops attribution trailer lines anywhere in the message, not only at the end (rerun: `Co-Authored-By` before `Signed-off-by: Bob` and one inside the body are both gone, audit `trailers: 0`), and the commit-msg hook now matches the same lines with their colon, so "Generated with codegen" in a subject is kept. Saving the identity also rewrites `user.name` and `user.email` in every session worktree. `clean_path` refuses a path whose real location is under `.git`, and the diff reader confines the real path and opens with `O_NOFOLLOW`.

Known and left for F7: `git commit --no-verify` inside a worktree skips the hook (plain push now refuses nothing on its own; an audit before plain push and refusing amend of a pushed commit are next); an empty commit in a sign-and-push range makes the amend step fail (the rebase is aborted and git's message returned); diff output size is capped only per file text, not per hunk list.

### backend/app/services/formslot.py · _discovery

- refers-to: backend/app/services/formslot.py :: _discovery
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Reads `<FORMSLOT_DATA_DIR or ~/.formslot>/service.json` and treats the service as running only when the pid is alive (runtime._alive) and the token is a string. The token is used only in the Authorization header of calls to 127.0.0.1:<port> and is never put in a response, a log line or an error.

### backend/app/services/formslot.py · status

- refers-to: backend/app/services/formslot.py :: status
- kind: explainer
- logged: v0.7.0 · 2026-10-30

formslot's route is `/api/corpus` (CONTRACT.md), not `/api/corpora`. `workspaceCorpus` is the corpus with the longest path that holds the open workspace. `pluginInstalled` is true when `<workspace>/.claude/settings.json` has a hooks object mentioning formslot, false when not, null with no workspace open. There is no CLI command that lists corpora, so a stopped service reports an empty list.

### backend/app/services/formslot.py · mcp

- refers-to: backend/app/services/formslot.py :: mcp
- kind: rationale
- logged: v0.7.0 · 2026-10-30

The window gets a forwarder for read tools only. Only `tools/call` with a name in MCP_TOOLS passes; `slot_reindex` (a write) and every other JSON-RPC method are refused with 400, so a page cannot reach the token's full reach. It needs no `initialize` first: formslot answers a bare `tools/call`.

### backend/app/services/formslot.py · drift

- refers-to: backend/app/services/formslot.py :: drift
- kind: explainer
- logged: v0.7.0 · 2026-10-30

`slot drift --repo <ws> --json` prints a list of slots, each with a `files` list of `{path, state, ...}`. The route flattens it to `{path, slot, state}`. A repository with no `slots.lock.json` makes formslot exit non-zero with "no slots.lock.json"; the route then retries with `--infer` (states `identical` and `drifted`). The JSON for 26 slots is over 20 kB, so stdout is not clipped for this command, only error text is.

### backend/app/services/formslot.py · start

- refers-to: backend/app/services/formslot.py :: start
- kind: explainer
- logged: v0.7.0 · 2026-10-30

`formslot serve` is detached (new session on POSIX, DETACHED_PROCESS plus CREATE_NEW_PROCESS_GROUP on Windows), outputs to null, and outlives the engine on purpose: it is a shared per-data-folder service with its own lock. The route waits up to 5 s for a live discovery file.

### backend/app/services/gate_hook.py · SCRIPT

- refers-to: backend/app/services/gate_hook.py :: SCRIPT
- kind: rationale
- logged: v0.7.0 · 2026-10-30

The hook script is kept as a string constant so it ships inside a frozen engine without a data-file entry in the PyInstaller spec; `gates.ensure_script` writes it to `<data>/hooks/sf_gate.py` (0755), rewriting it when the text differs, which happens on every session start and resume. It is stdlib only.

Path mapping: a session runs in a git worktree under the data folder, but formslot's `check` picks the corpus by the repository path holding `cwd`. The script therefore rewrites `cwd` and `tool_input.file_path` from `SUBFORM_WORKTREE` to `SUBFORM_REPO` (normpath and realpath compared) before calling `formslot check`; without it every check in a worktree would print nothing.

The reuse warning has no machine-readable slot list, so the script parses `slot <id> (<status>) at <path>:<line>` and `unit <name> (<path>:<line>)` from the additionalContext text; slots come first, units after, and the first entry is the one the deny names. If formslot's wording changes this needs revisiting.

`tokens` is lines of the matched slot file times 10 (a 36-byte average line at formslot's bytes / 3.6 estimate); 0 for a unit-only match.

Failure policy: any exception exits 0 with no output. Two choices go beyond the contract text: an engine that cannot be reached, a missing session env, or a warning with no parsable slot prints the original warning as additionalContext (so the warning is not lost); a deny from formslot is printed unchanged. `SUBFORM_GATE_TIMEOUT` (seconds, 1 to 120) shortens the wait for the 2 s timeout check.

### backend/app/services/gates.py · create and _close

- refers-to: backend/app/services/gates.py :: create
- kind: explainer
- logged: v0.7.0 · 2026-10-30

A gate moves a `working` session to `needs-input` (message "Existing slot found: <id>", which also raises the existing needs-input notice) and remembers the prior lastMessage. When the last open gate of the session closes, a session still in `needs-input` returns to `working`; a session that was already needs-input for another reason is left alone. `use` and `adapt` add the gate's tokens to the record's `tokensSaved` (persisted in sessions.json, in `public`). It uses sessions.py internals (`_sessions`, `_set_state`, `_changed`, `_publish`) on purpose, to keep the sessions.py edits small.

Closing choices: `use`, `adapt`, `write` come from the owner; the engine adds `timeout` (the hook's long poll ran out, default 120 s) and `abandoned` (the hook's connection dropped, or the session was stopped or deleted). The `gate-closed` SSE payload is the whole Gate with `choice` set to one of those five. Closed gates stay readable for 10 minutes so a hook that polls after a fast answer still gets it; `GET /api/gates` lists only open ones. A new SSE subscriber receives the open gates as `gate` frames after the session snapshot.

### backend/app/services/gates.py · merged_settings

- refers-to: backend/app/services/gates.py :: merged_settings
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Reads the existing `.subform/settings.json`, keeps every key, forces the two attribution keys from SETTINGS_BODY, keeps other PreToolUse entries and replaces any earlier entry whose command names `sf_gate.py`. `_mcp_arg` now rewrites settings on every launch so old sessions gain the hook and a moved Python path is corrected. The hook command is `<python> <data>/hooks/sf_gate.py`; the Python is the engine's own interpreter, or `python3` from PATH when frozen. Hook timeout 135 s covers the 120 s wait.

### backend/app/services/gates.py · session_env

- refers-to: backend/app/services/gates.py :: session_env
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Besides the contract's `SUBFORM_ENGINE` and `SUBFORM_SESSION`, the session gets `SUBFORM_WORKTREE`, `SUBFORM_REPO` (for the path mapping) and `FORMSLOT_BIN`. Sessions started before this change keep their old environment until resumed.

### backend/app/services/sessions.py · _mcp_config

- refers-to: backend/app/services/sessions.py :: _mcp_config
- kind: rationale
- logged: v0.7.0 · 2026-10-30

formslot is now found by `formslot_service.binary()` (FORMSLOT_BIN, then `formslot`, then `formslot-cli` on PATH) so the session's mcp.json carries the same binary the bridge uses.

### backend/app/services/gitops.py · push, _range_check, _range_rows, _is_signed

- refers-to: backend/app/services/gitops.py :: push, _range_check, _range_rows, _is_signed
- kind: rationale
- logged: v0.7.0 · 2026-10-30

Plain push now audits what it is about to send, like sign-and-push does after its rewrite. The range is `refs/heads/<b> --not --remotes=<remote>`, so it works for a new branch and for one that already has an upstream. Counts: commits, unsigned (only when signing is on; shown as `-` otherwise), commits whose author or committer is not the stored identity (skipped when no identity is stored), and trailer lines (same counter as the commit audit). Anything above zero is a 409 that carries `ok:false`, `check` and `output` so the window prints the same check line as sign-and-push, and nothing is pushed or changed. The commit-box wrapper cannot see `git commit --no-verify` or commits made by tools outside it, which is why the audit has to sit on push. A commit made in a terminal with a different global identity is refused too; that is the point.

### backend/app/services/gitops.py · commit (amend)

- refers-to: backend/app/services/gitops.py :: commit
- kind: rationale
- logged: v0.7.0 · 2026-10-30

`amend` is refused when HEAD is contained in any remote-tracking ref (`for-each-ref --contains HEAD refs/remotes`, ignoring `<remote>/HEAD`). Checking only `@{upstream}` would miss a branch with no upstream whose commit was pushed under another name, and `--reset-author` on a pushed commit takes it over. The message names the ref and says to make a new commit.

### backend/app/services/gitops.py · agent_audit, _branch_base

- refers-to: backend/app/services/gitops.py :: agent_audit, _branch_base; backend/app/routers/git.py :: audit
- kind: rationale
- logged: v0.7.0 · 2026-10-30

`GET /api/git/audit?session=` lists commits of a session branch that carry a trailer or an identity other than the stored one, for agent commits made with `--no-verify` (the commit-msg hook is skipped, and the worktree identity can be overridden with `-c` or env). It only reads; nothing is rewritten. The range is the branch's creation point to HEAD: `session.base` is a ref name such as `HEAD` and cannot be used later, so the creation point is the oldest entry of the branch reflog (`reflog show --format=%H`), falling back to `HEAD --not --remotes` when there is no reflog. The workspace target returns an empty list: its commits go through the wrapper, which audits them. The list is capped at 50.

### backend/app/services/gitops.py · sign_and_push

- refers-to: backend/app/services/gitops.py :: sign_and_push
- kind: rationale
- logged: v0.7.0 · 2026-10-30

Changes so that "fix with sign-and-push" really fixes what the audit flags. (1) The rebase runs with `core.hooksPath` set to the engine's hook folder, so `git commit --amend --no-edit` inside the rebase strips trailers through the same commit-msg hook the worktrees use (`-c` configs are inherited by the exec'd git). (2) For a session target the "another author" refusal is skipped: every commit on a session branch since its creation point is the agent's work, and `--reset-author` restores the stored identity; the workspace target keeps the refusal because commits there may be other people's. (3) For a session branch with no upstream yet, the range starts at the branch creation point instead of refusing with "use Push for a new branch", so a brand-new agent branch can be signed and pushed in one go. (4) The exec amend has `--allow-empty`: an empty commit in the range used to fail the rebase with "doing so would make it empty" and git's raw text; it is now kept and signed. (5) Uncommitted changes to tracked files are refused up front with a clear sentence; git's own refusal ("cannot rebase: You have unstaged changes") was passed through raw. (6) The post-rebase check reuses `_range_check`, so the check line has one definition.

### backend/app/services/gitops.py · _push_args

- refers-to: backend/app/services/gitops.py :: _push_args
- kind: warning-context
- logged: v0.7.0 · 2026-10-30

The `-c remote.<r>.push=` clearing from v0.6.1 is removed. On git 2.43 an empty `remote.<r>.push` is parsed as an empty refspec and every push fails with `fatal: invalid refspec ''` (reproduced with plain git, and through the engine for both Push and Sign and Push). The explicit refspec `refs/heads/<b>:refs/heads/<b>` on the command line already takes precedence over any configured push refspec, so the clearing added nothing; the `+` and force protections are unchanged (`--no-force-with-lease`, a refspec without `+`, branch regex).

### backend/app/services/gitops.py · write_worktree_file, _write_atomic, _file_mtime, diff_file

- refers-to: backend/app/services/gitops.py :: write_worktree_file; backend/app/routers/git.py :: worktree_file
- kind: rationale
- logged: v0.7.0 · 2026-10-30

`PUT /api/git/worktree-file` `{session, path, text, expectedMtime}` writes one existing regular file inside that session's worktree so a session diff tab can be saved. Confinement: a session id is required (the workspace has its own route), the path goes through `clean_path` (no absolute, no `..`, nothing under `.git`, real parent inside the root), a final-component symlink is refused, the file must already exist (404, creation is not offered), read-only is 403, text up to 8 MiB. The mtime check is the workspace route's: a number that differs by more than 1e-6 is 409 `file changed on disk`, null skips the check (the window sends null only after the user chose Overwrite). The write is temp file plus fsync plus `os.replace` with the old mode kept, under the target's lock like every other mutation. `GET /api/git/diff` now returns `mtime` (null when staged, missing or a link) so the tab has the value to send; the workspace tab keeps reading it from the file route.

### backend/app/services/gitops.py · _exec

- refers-to: backend/app/services/gitops.py :: _exec
- kind: rationale
- logged: v0.7.0 · 2026-10-30

review5 L5: on timeout only the git process was killed, not ssh or hooks it had started. On POSIX the process starts a new session and the timeout kills the whole group (`killpg` with SIGKILL, falling back to `kill`). Windows has no sessions and keeps `kill`.

### backend/app/services/gitops.py · sign_and_push, _agent_identity

- refers-to: backend/app/services/gitops.py :: sign_and_push; backend/app/services/gitops.py :: _agent_identity
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review H2: for a session the "another author" refusal used to be skipped and the rebase then reset every commit in the range to the stored identity, so commits made by other people (fetched or cherry-picked into the session branch, or made with another `--author`) were taken over and signed, and the post-rebase identity count ran on the already rewritten commits and could never fail. Now the author and the committer of every commit in the range are compared before the rebase. Allowed are the stored identity and, for a session only, the exact `Name <email>` that `configure_worktree` wrote into that worktree's own config (read back with `git config --worktree`, which is what the agent commits as). Anything else refuses with nothing changed. The workspace target keeps its refusal with an allowed set of just the stored identity, and now compares the committer too. The agent identity is read from the worktree rather than remembered because it is what git itself will stamp on the agent's commits; if the worktree has none, only the stored identity passes. The post-rebase check is meaningful now: the tree hash and subject of each commit in the range are recorded before the rebase and must match one to one afterwards (same count, same order), otherwise the branch is put back. Floor: the session branch's first reflog entry, which is the point `git worktree add -b` created it from, is kept as the floor. It already is the session's own start, and a stored tip in the session record would only restate it while adding a field that can drift from the branch; commits by others inside that span are now refused instead of re-signed, which is what the owner's rule needs. When the push step fails after signing, the branch is restored to its original tip exactly like the check-failure path, and the refusal says so. The rule: only the commits the agent session made are re-signed or re-authored; nothing else is rewritten; nothing is force-pushed.

### backend/app/services/gitops.py · write_worktree_file, _write_checked

- refers-to: backend/app/services/gitops.py :: write_worktree_file; backend/app/services/gitops.py :: _write_checked
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review LOW: the encode, the path checks, `fsync` and the replace of up to 8 MiB ran on the event loop while the target lock was held. The encode now runs in `asyncio.to_thread` and the checks plus the write run in `_write_checked`, also in a thread. `WRITE_MAX` is compared to the encoded byte length as well as the character count (the cheap character check stays first, so an obviously huge body is refused before encoding). A `FileNotFoundError` from the mtime stat, the temp-file chmod or the final stat, when the file is deleted between the existence check and the write, is Refused(404) instead of a 500. The symlink-swap race between check and replace is known and accepted: the session itself owns the worktree, and the path stays confined by the realpath check.

### backend/app/services/gitops.py · _exec, _reap

- refers-to: backend/app/services/gitops.py :: _exec; backend/app/services/gitops.py :: _reap
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review LOW: a client disconnect cancels the request task while `communicate` is awaited, and the git child (and any ssh or hook under it) was left running. Timeout and any other exit from the wait (cancellation included) now kill the whole process group through `_reap`; on cancellation the reap runs shielded so the wait for the child is not itself cancelled.

### backend/app/services/gates.py · session token, session_env, verify, verify_gate

- refers-to: backend/app/services/gates.py :: _mint, verify, verify_gate, session_env
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review H1: each session launch mints a random token (`SUBFORM_GATE_TOKEN` in the session env, kept in `_tokens` in memory). `gate_hook.py` sends it as `X-Subform-Session`. `POST /api/gates` requires it to match the session named in the body, and `GET /api/gates/{id}/wait` requires it to match the gate's session. It is not accepted on the answer route, which wants the window token (see core/HASHOUT_LOG.md, local_guard.py). `close_session` forgets the token. A session that survives an engine restart keeps its old token, which no longer matches; its hook then gets a 403, falls back to showing the context without a gate, and the next resume gets a fresh token. The hook matcher stays `Write|Edit|MultiEdit`: `formslot check` judges a `file_path`, a `Bash` command has none, so adding `Bash` would only hand the check an input it does not understand. Writes made through Bash are therefore not gated.

### backend/app/services/gates.py · create, _close, _prune, wait

- refers-to: backend/app/services/gates.py :: create, _close, _prune, wait
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review M2. State: the old code remembered the prior message per gate and only for the gate that flipped the session, so two overlapping gates left the session in needs-input for good. The prior message is now kept per session (`_prior`) when a gate moves a working session to needs-input; when the last open gate of that session closes the entry is popped and a still needs-input session returns to working with that message. A needs-input that did not come from a gate is not touched. Expiry: `_touched` records creation and the end of each wait, `_waiting` counts live waits; an open gate with no waiter whose last touch is older than `WAIT_MAX + ABANDON_MARGIN` (150 s) is closed as `abandoned` by `_prune`, which runs on create and on the open list. That covers a hook that died between the POST and the wait. Caps: 5 open gates per session and 50 in total (429); the body model bounds `message` at 8000 characters (422), `path` 4000, `tool` and `session` 200, and `create` still trims the message to 4000. The hook trims its own message and slot list to those limits so a long check output does not turn into a 422.

### backend/app/services/formslot.py · index, start, mcp

- refers-to: backend/app/services/formslot.py :: index, _allowed_roots, start, mcp
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review M5: an explicit `path` for `/formslot/index` must be the open workspace, inside it, or inside a known session worktree (403 otherwise), so a local caller cannot index `~/.ssh` and read it back through the mcp forwarder. Without a path it still indexes the open workspace. LOW: `start` runs under an asyncio lock so two concurrent starts cannot launch two `serve` processes, and the `Popen` handle is waited on in a daemon thread so the child is reaped. `mcp` answers 400 for an empty list or more than 20 messages, before it checks that formslot is running. `_discovery` still trusts `service.json` on pid liveness alone; unchanged.

### backend/app/services/graph.py · compute

- refers-to: backend/app/services/graph.py :: compute, _walk, _specs_for, _targets
- kind: rationale
- logged: v0.8.0 · 2026-10-30

The file graph behind the graph tab. Nothing in the workspace is executed or imported: files are read as bytes (first 256 KB, binary sniffed by NUL) and scanned with regular expressions for import-like references (JS and TS import, export from, dynamic import, require, `new URL` and `new Worker`; Python import and from-import including relative levels; CSS and SCSS import, use, forward; HTML src and href; Markdown links; Rust `mod`; C include with quotes). Targets resolve only to files in the scan, so a bare package name or an absolute system path can never become an edge or leave the workspace. The walk starts at `workspace_root.real_root()`, skips `HIDDEN_NAMES` and build-output folders, never follows a symlink (file or folder), and reads each file through `workspace_root.resolve(follow=False)`. Bounds: 8000 files, 64 MB read per call, 60000 edges, a 6 second budget; past a bound the reply says `truncated` and is not cached, while the per-file parse memo is kept, so a refresh continues where the last call stopped. Caches: `_specs` keeps the parsed references per file keyed by (mtime_ns, size); `_results` keeps the full reply keyed by a SHA-1 of every (path, mtime_ns, size). A request with `sig` equal to the current signature answers `{unchanged: true}` without rebuilding. Python absolute imports resolve through a suffix index (`app.core.x` also matches `backend/app/core/x.py`); an ambiguous suffix picks the candidate sharing the longest path prefix with the importer, and an importer never links to itself. The route is `GET /api/graph` in routers/graph.py, behind LocalGuard like every other route, and runs in the thread pool so a slow scan does not stall the event loop. Scans are serialised by one lock.

### backend/app/services/mcp_tools.py · call_tool

- refers-to: backend/app/services/mcp_tools.py :: TOOLS, principal, call_tool, _finish, _page, _confined
- kind: rationale
- logged: v0.10.0 · 2026-10-30

The tool layer of the engine's MCP server (protocol and result shapes follow formslot's MCP section in its CONTRACT.md; docs/MCP.md describes the wire). Tools call the engine's own functions in process (gitops.review, workspace `_rg_search`, sessions.record_comment, the pty-host client), so there is no second implementation of search or review. A session token is scoped by `_session_of`: it can only name its own session and every root is that session's worktree; the window token may name any session. `file_read` does its own confinement (`_confined`) instead of `workspace_root.resolve` because that function is bound to the open workspace and a session reads its worktree; it refuses `..`, absolute paths, realpaths outside the root, `.git`, `.subform` and dotenv files, binary and non-UTF-8 files and anything over 2 MiB. `review_comment` calls `record_comment` only: the HTTP route also pastes the comment into the agent's terminal, which an agent commenting on its own work must not do. `terminal_tail` is skipped: the pty-host streams a buffer only to a subscribing connection (attach, then ack), and the engine has one connection shared with the window's terminals, so attaching would change what the window receives. The 25,000-token cap uses ceil(bytes / 3.6); lists stop at 20,000 by dropping trailing items; a result still over the cap is cut at a line boundary. Cursors are 8 hex digits of offset plus 12 of a hash of the tool and its arguments (without limit and cursor). Only the tool name, success and milliseconds are logged. The stdio launcher is `backend/subform_mcp.py`, started by the `mcp` argument of the root `subform` and `subform.bat`; it only forwards lines and starts nothing. The session entry in `sessions._mcp_config` passes the token as `${SUBFORM_GATE_TOKEN}` so it never reaches mcp.json on disk.

### backend/app/services/create.py · clone

- refers-to: backend/app/services/create.py :: clean_url, start_clone, _run_clone, cancel_job
- kind: rationale
- logged: v0.10.0 · 2026-10-30

Clone runs `git` from an argv list, never a shell. The address is checked before anything starts: https or ssh only (a `user@host:path` scp form counts as ssh), a character allow-list (letters, digits and `._~%+@:/-`, so no spaces, quotes, `;`, `?`, `#`), no leading `-`, a host that starts and ends with a letter or digit, no password (credentials are never stored or accepted; git's own credential helper signs in), no `..` in the path. The argv is `git -c protocol.allow=never -c protocol.https.allow=always -c protocol.ssh.allow=always -c core.askPass= clone --progress -- <url> <target>`: `--` ends options so the address can never be read as one (`--upload-pack`, `-o`), and the protocol allow-list shuts `ext::`, `file`, `git` and `fd` even through a config rewrite. `GIT_TERMINAL_PROMPT=0` (from `gitops._env`) and no controlling terminal (new session) make a missing credential fail fast with git's own message instead of hanging; `GIT_SSH_COMMAND` defaults to `ssh -o BatchMode=yes` unless the person set one. The target folder must not exist, is named from the address (or typed, same allow-list as the address folder rule) and sits inside a destination that must be an existing writable absolute folder. Progress is parsed from git's stderr (`Receiving objects` 0 to 0.8, `Resolving deltas` 0.8 to 1). A job has a 15 minute limit, at most 3 run together, and is cancellable: the whole process group is killed and a partial target folder is removed. Finished jobs are kept 10 minutes, at most 20. The window polls every 400 ms and mirrors the job into the status bar jobs list (with its own Stop). It borrows gitops' private `_git_bin`, `_env`, `_reap` and `_clip` on purpose so there is one way to run git. Not verified: ssh clones (no ssh server here); https clone of octocat/Hello-World, a missing repository, cancel and every refused address were run against a real engine.

### backend/app/services/create.py · create_app

- refers-to: backend/app/services/create.py :: create_app, _write_tree, check_block, suggest_block, used_blocks
- kind: rationale
- logged: v0.10.0 · 2026-10-30

Name: `form` plus 1 to 28 lowercase letters or digits. Ports: a block of 10 starting at a multiple of 10 inside 5600 to 5999, refused when it is in `KNOWN_BLOCKS` (formMCP 5620, formskills 5630, formslot 5640, subform 5650; 5600 and 5610 are held back for family services), when a sibling folder of the destination names a port of the block in its CLAUDE.md, README.md or AGENTS.md (at most 60 siblings, 64 KB each), or when any of its 10 ports cannot be bound on 127.0.0.1 now. formvis uses 5190, outside the range. The suggestion is the first block that passes. Steps: write the template tree into the new folder, `git init -b main`, `formslot install <repo>` when `formslot.binary()` finds it (before the commit, so the first commit already holds the hooks, `.mcp.json` and `slots.lock.json` and the tree is clean; failure is reported in the result and is not fatal), `git add -A`, then one commit with `--no-verify`, hooks path disabled and `commit.gpgsign` forced to the stored choice. Identity is the one stored in Preferences, Git and Identity (`gitops._stored_identity`); when none is stored it is `nodemode-ai <mackin@nodemode.ai>`. The computer's global git identity is deliberately not used, because on a machine set up for an agent it would be the agent. The message is a subject and one body line with no trailer. Any failure removes the new folder; the folder never existed before the call (a name clash is 409).

### backend/app/services/mcp_tools.py · _confined, _refuse_parts, _hit_allowed, _search

- refers-to: backend/app/services/mcp_tools.py :: _confined, _refuse_parts, _hit_allowed, _search
- kind: warning-context
- logged: v0.10.0 · 2026-10-30

review M1 and M2. `_confined` checked only the parts the caller typed, so an in-tree symlink `notes.txt -> .env` or `gitlink -> .git` followed by `gitlink/config` returned secrets. It now refuses when the final component or any parent inside the root is a symlink, and after `realpath` it re-runs the `.git`, `.subform` and dotenv checks on the path relative to the root. The dotenv pattern now covers `.env`, `.env.*` and `*.env` and applies to every part. `workspace_search` runs ripgrep with `--hidden --no-ignore`, which returned `.env` contents; the MCP call now passes `SEARCH_EXCLUDES` (`.env*`, `*.env`, `.subform`, `.git`) as extra globs (`workspace._rg_search` gained an optional `excludes` argument; the window's own search is unchanged) and drops every hit whose path fails `_confined`, which also covers the Python search used without ripgrep. Before: `file_read notes.txt` and `file_read gitlink/config` answered with content and a search for a secret returned `.env` and `plain/.env`. After: the reads are refused and the search returns 0 hits.

### backend/app/services/MCP launcher and gate hook · proxy bypass

- refers-to: backend/app/services/gate_hook.py :: SCRIPT (OPENER, call); backend/subform_mcp.py :: OPENER
- kind: warning-context
- logged: v0.10.0 · 2026-10-30

review M4. `urllib.request.urlopen` honours `http_proxy` and sends the bearer or gate token to the proxy. Both the stdio launcher and the hook script now use an opener built with `ProxyHandler({})`, so a call to the engine on 127.0.0.1 never goes through a proxy.

### backend/app/services/create.py · _scan_sibling_blocks, _read_plain, check_block, suggest_block

- refers-to: backend/app/services/create.py :: _scan_sibling_blocks, _read_plain, check_block, suggest_block; backend/app/routers/create.py :: port
- kind: warning-context
- logged: v0.10.0 · 2026-10-30

review M5. The port check opened `CLAUDE.md`, `README.md` and `AGENTS.md` of each sibling folder with a blocking `open`, so a planted symlink to a FIFO blocked the thread forever, and the route ran on the event loop, so the whole engine stopped answering. `_read_plain` opens with `O_RDONLY | O_NONBLOCK | O_NOFOLLOW`, takes `fstat` and accepts regular files only, and reads at most 64 KiB. The `/create/port` route now runs in the threadpool, and `suggest_block` scans the siblings once and passes the result to `check_block` instead of once per candidate block. Before: the call hung and `/api/system/status` timed out. After: the call answers at once.

### backend/app/services/create.py · shutdown, _run_clone, _git_env, _read_progress, create_app

- refers-to: backend/app/services/create.py :: shutdown, _run_clone, _git_env, _read_progress, create_app; backend/app/main.py :: lifespan
- kind: rationale
- logged: v0.10.0 · 2026-10-30

review M6, L2 to L5. `create.shutdown()` runs in the lifespan: it marks running jobs cancelled, kills each process group with the shielded reap, cancels the tasks and waits for them, and the cancelled branch of `_run_clone` reaps shielded and removes the partial folder in a thread. Before: stopping the engine left `git clone` running and the half-cloned folder in place. After: both are gone within the stop. The partial folder is removed only when the clone started on a path that did not exist (`owned`), and `create_app` makes the folder outside its `try`, so a lost race (409) can never delete a folder the engine did not create. `_drop_partial` runs through `asyncio.to_thread`. `_read_progress` keeps at most 64 KiB of an unfinished stderr line. `USER_RE` is anchored to a letter or digit first, so a user part cannot start with `-`. `_git_env` reads `core.sshCommand` (or an existing `GIT_SSH_COMMAND`) and appends `-o BatchMode=yes`, because `GIT_SSH_COMMAND` replaces the user's setting. The formslot install child and `formslot._split` now start in their own session so a timeout kills the whole group.

### backend/app/services/mcp_tools.py · correction: the MCP server is live

- refers-to: backend/app/services/HASHOUT_LOG.md :: sessions mcp.json entry ("left out until F9")
- kind: explainer
- logged: v0.10.0 · 2026-10-30

Correcting an older entry: the sentence "subform's own server is always left out until F9" in the entry on the per-session `mcp.json` is out of date. The server exists (`POST /mcp`, mounted without the `/api` prefix, tools in `mcp_tools.py`) and `_mcp_config` adds the `subform` entry whenever the launcher script sits in the repository folder above the engine. In a packaged app it is not found, the session note says so, and the entry is left out. The older entry is kept as written.

### backend/app/services/sessions.py · _start_headless, create, PERMISSION_MODES

- refers-to: backend/app/services/sessions.py :: _start_headless, create, PERMISSION_MODES, DEFAULT_PERMISSION_MODE
- kind: rationale
- logged: v0.10.0 · 2026-10-30

A release check showed headless sessions could not edit: in an untrusted worktree Claude Code ignores `permissions.allow` from project settings, so every Edit was denied. Each session now stores a `permissionMode` chosen at creation (default `acceptEdits`) and `_start_headless` passes `--permission-mode <mode>`. `acceptEdits` auto-accepts file edits inside the worktree only; Bash and other tools still need approval, which `-p` cannot give, so they are denied. Allowed values are `default`, `acceptEdits` and `plan`; `bypassPermissions` and the other CLI choices are never offered and the API answers 400 for them. The claude 2.1.314 help lists `manual` where older docs say `default`, but `--permission-mode default` is still accepted and behaves as asking, so the stored value stays `default`; revisit if a later CLI drops the alias. A stored value that is not allowed falls back to `acceptEdits` on resume of a headless session. Interactive sessions do not use the flag. Checked live: a headless session with no mode given edited CHANGELOG.md in its worktree and finished without a denial.

### backend/app/services/gitops.py · commit

- refers-to: backend/app/services/gitops.py :: commit
- kind: rationale
- logged: v0.10.0 · 2026-10-30

The wrapper now passes `-c commit.gpgsign=true` or `-c commit.gpgsign=false` explicitly, matching the identity's signing choice, so a global `commit.gpgsign=true` no longer signs (or fails without a key) when signing is off in Preferences. The result carries `identitySource` (`subform` when Preferences hold the identity, `git` when the global git identity was used as the fallback, which is kept). Checked with a `GIT_CONFIG_GLOBAL` file that sets `commit.gpgsign=true` and `gpg.program=/bin/false`: the commit succeeded, unsigned (signature N). `GET /api/git/audit?session=` returning no commits after a wrapper commit is by design: it lists only flagged agent commits (a trailer, or an author or committer that differs from the stored identity), and without a stored identity the identity check is skipped. The panel now says "no flagged commits" for a session instead of showing nothing.

### backend/subform_ptyhost.py · Host.tail, plain_text

- refers-to: backend/subform_ptyhost.py :: Host.tail, plain_text, ANSI_RE, TAIL_LINES, TAIL_BYTES, TAIL_RAW; backend/app/services/ptyhost_client.py :: PtyHostClient.tail; backend/app/services/mcp_tools.py :: terminal_tail, _redact, REDACTIONS
- kind: rationale
- logged: v0.11.0 · 2026-10-30

Supersedes the line in the `mcp_tools.py · call_tool` entry that says `terminal_tail` is skipped. New request `{"op":"tail","id","lines","since"}`, reply `{"op":"tailed","id","text","next","base","from","missed","cut","alive","exitCode"}`. It only reads `term.buf`: no subscription, no `attached` set change, no `unacked` or pause change, no frame to any other connection, so a window attached on the shared engine connection is not disturbed (the reply op `tailed` is also not one any existing waiter or the hub dispatch treats as terminal output). It runs synchronously in the loop on a slice of at most 1 MiB, so it cannot interleave with a feed. Offsets are the same stream byte offsets as `seq`; `next` is `term.total`. With `since` the slice starts there (raised to the ring base, with `missed` saying how many bytes were gone, and to the newest 1 MiB if the gap is bigger); then the last `lines` lines (default 200, cap 2,000) are kept and the text is clipped to the newest 256 KiB; `cut` says lines were dropped. A `since` that lands inside an escape sequence or a multibyte character is handled by the regexes accepting a truncated sequence and by decoding with replacement. Stripping: OSC (to BEL or ST), DCS/SOS/PM/APC, CSI, charset selects and two-byte escapes; then `\r\n` becomes `\n`, a bare `\r` keeps only the last text on the line (progress bars), other control characters go. The engine opens its pty-host request with `start=False`, so a tail never launches a host. Auth is the host's existing one: the unix socket is mode 0600 and the Windows port needs the hello token. The tool: a session token must own the terminal through `meta.sessionId` (read from the host's `list`), and a foreign or unknown id gives the same "no such terminal" so existence is not leaked. No redaction helper existed in `backend/app`, so `REDACTIONS` is a small conservative set (see docs/MCP.md) plus the engine's own live window and session tokens; the MCP result is held to 60,000 bytes keeping the newest lines because the generic 25,000 token cut keeps the oldest. Checked against a real engine and pty-host: with a window websocket attached and acking, 5,000 numbered lines (310,697 bytes) were printed while `./subform mcp` called `terminal_tail` 85 times; the window saw 0 sequence gaps, 310,697 bytes equal to the host total, and `unacked` 0 afterwards; a second run reading with `since` collected lines 1 to 5000 exactly once each; a session token for session A got "no such terminal" for session B's terminal and the reverse. Not checked on Windows.

### backend/app/services/gate_hook.py · SCRIPT (Bash tool, PostToolUse)

- refers-to: backend/app/services/gate_hook.py :: SCRIPT (lex, commands, run_simple, bash_targets, pre_bash, post_bash); backend/app/services/gates.py :: HOOK_MATCHER, POST_MATCHER, merged_settings, add_note, notes_for
- kind: rationale
- logged: v0.11.0 · 2026-10-30

Supersedes the sentence in the `session token, session_env, verify, verify_gate` entry that says writes made through Bash are not gated and that the matcher stays `Write|Edit|MultiEdit`. The PreToolUse matcher is now `Write|Edit|MultiEdit|Bash` and a PostToolUse matcher `Bash` (timeout 5 s) runs the same script; the script tells them apart by `hook_event_name` and `tool_name`. The older entry is kept as written.

Pre, Bash: the command is parsed and never run. The task named shlex; a small lexer is used instead because shlex cannot read heredoc bodies, treats a newline as plain space and gives no redirect with a file descriptor. The lexer is quote aware (single, double, `$'..'`, `$(..)` and backticks make a word dynamic), turns newlines into separators after reading heredoc bodies (`<<`, `<<-`, quoted or plain delimiter), keeps `n>` descriptors, and a quote it cannot close makes the whole command unparseable, which passes. Commands are walked in order with a tracked `cd`, a map of contents already written earlier in the same call, `bash -c` and `eval` recursion (3 deep), and the text of an `echo`, `printf` or `cat` carried across a pipe to `tee`. Targets: `>`, `>>`, `&>`, `tee [-a]`, `touch` of a new file, `cp`/`mv`/`install` (content read from the source), `sed -i` (an Edit with the first `s///` pair, else path only), `python`/`node`/`ruby` with `-c`/`-e` or a heredoc on stdin (`open(lit,'w')` with `.write(lit)`, `Path(lit).write_text`, `writeFileSync`, `File.write`; literals decoded with `ast.literal_eval`, other arguments leave the path only), `git apply` and `patch` (patch text from a heredoc, a pipe or a file in the worktree; `+++` headers cut by `-pN`, a `/dev/null` old side is a Write, else an Edit of the removed and added lines). A path with a variable, glob or `~user` is skipped, as is anything outside the worktree, `.git/` and `.subform/`. At most 8 targets. Each becomes a Write payload (content, or empty for path only) or an Edit payload (an append is an Edit with an empty `old_string`) and goes through the same `judge` as a Write: remap to the repository, `formslot check`, parse slots, open a gate (`tool` is `Bash`, `path` the target) and wait. A formslot deny or an owner Use or Adapt answer denies the whole Bash call and the reason is prefixed with the file; Write-new-anyway lets that target through; timeouts and an unreachable engine fall back to context as for Write. The waits share one 125 s deadline (hook timeout 135 s).

Post, Bash: the Pre run of every Bash call stores `git status --porcelain=v1 -z -uall` with mtime and size per file in `<data>/hooks/bash-snap/<tool_use_id>.json` (0700, files older than a day removed; a missing `tool_use_id` falls back to the session id). The Post run compares a fresh status with it, skips the call when more than 50 files changed, and for each new or changed file within a 1.7 s budget runs `formslot check` with the whole file as Write (untracked) or the `git diff HEAD -U0` lines as Edit (tracked), so a branch that differs from the main checkout is not read as all new code. A match cannot block: the text goes back as PostToolUse `additionalContext`, and the file, first slot or unit and message are posted to `POST /api/gates/notes` (session token). A declined-feature deny is reported as a warning on the same terms. Notes live in memory per session (50 at most, one per path, dropped with the session), are read with `GET /api/gates/notes?session=` and shown by the review pane as the badge text "Bash · slot X" in the existing provenance badge, so the layout does not change. They are lost on an engine restart; the additionalContext the agent saw is not.

Known limits: a script file (`python gen.py`), a build tool or an editor plugin is only caught after the fact; a heredoc through `eval "$(...)"` or a variable is not read; `formslot check` gives one warning per session, path and first slot, so a file already warned about in Pre is quiet in Post.

### backend/app/services/mcp_tools.py · REDACTIONS, _redact, _scrub_partial, terminal_tail

- refers-to: backend/app/services/mcp_tools.py :: REDACTIONS, _redact, _scrub_partial, terminal_tail
- kind: rationale
- logged: v0.11.0 · 2026-10-30

review H1. Two patterns started at every identifier character with an unbounded prefix (`[A-Z0-9_]*` before the keyword, `\s*[^\s"']+` after `authorization`), so `'TOKEN_' * 16000` took 38 s on the event loop; 240 KB never finished. Now `terminal_tail` cuts the raw text to its last 60 KB (bytes) first, drops the first partial line when it cut, and runs `_redact` in `asyncio.to_thread`. Every pattern starts after a lookbehind `(?<![A-Za-z0-9_-])`, so one word gives one start, and each prefix, name and value has an upper bound (name parts 40, values 512 or 2048), which makes the work per start constant. Measured on 1 MB adversarial inputs (repeated `TOKEN_`, `Authorization:`, `SECRET `, `key key `, `eyJ-`, `password="`, `--password `, `://a:`, BEGIN markers, one 1 MB word): 0.02 to 0.42 s each, and 100 KB takes a tenth of that, so the time is linear.
review M4. Coverage: names containing SECRET, TOKEN, PASSWORD, PASSWD, PASS (not passed, passing, passage), PWD, CRED, AUTH (not author) or KEY, with `=` or `:` after an optional quote (so JSON `"password": "x"`), unquoted values up to 512 characters stopping at `&`, quoted values with spaces; `--password x` style flags; Authorization headers with a scheme; X-Api-Key; `scheme://user:pass@`; JWTs; npm_, AIza, glpat-, sk_live_/sk_test_ (and rk_), the earlier sk-, gh*_, AKIA, xox; and a generic pass over 32+ character runs that need a digit, lower and upper case and Shannon entropy of at least 4.2 bits, so lowercase git hashes and paths stay readable. A `since` read starts mid-line, where the first part of a secret was already returned by the previous call; `_scrub_partial` replaces every run of 8 or more token characters in that first partial line. The tool description now says common secret patterns are redacted, not that all secrets are.

### backend/app/services/gate_hook.py · SCRIPT (lex, skip_paren, heredoc_ok, fallback, walk, GIT)

- refers-to: backend/app/services/gate_hook.py :: SCRIPT
- kind: rationale
- logged: v0.11.0 · 2026-10-30

review M2. `$(` scanning counted parentheses without quotes, so `echo $(echo '('); echo hi > a.txt` never closed and the whole command was dropped; `skip_paren` and `skip_dq` now skip single quotes, double quotes with nested `$(` and backslashes, with a depth limit of 40 and a work budget of 12 steps per input character. `<<` starts a heredoc only when the next non-blank character can begin a delimiter (a letter, underscore, quote or backslash) and the word before it is not an assignment ending in a digit or `)`; `(( ... ))` at a command start is read as one opaque arithmetic word unless it holds `;`, `|` or a newline. Before: `x=1<<3` then a newline and `echo hi > a.txt` found nothing, and so did the `(( x = 1 << 3 ))` form. A heredoc with no terminator now makes the lexer fail. When the lexer fails (unterminated quote, unbalanced `$(`, unterminated heredoc, budget) `fallback` finds literal `>`, `>>`, `&>` and `tee` targets with two regular expressions instead of returning nothing.
Not gated before the call, which the PostToolUse check catches by the files it changed afterwards: `dd of=`, `curl -o`, `wget -O`, awk and perl writes, `rsync`, `tar` extraction, variable or computed targets, script files. Listed in CLAUDE.md and the security model reference.
review M3. A command over 64 KB is not analysed (`CMD_CAP`; PostToolUse still runs); at most 2000 simple commands, 512 found writes and 0.6 s are spent; the code of an interpreter call is cut to 64 KB and the `.write(` search after an `open(` stops at the next `open(` or 4096 characters. `lex` takes plain runs with one regular expression and finds operators by lookup in the 3, 2 and 1 character sets instead of scanning an operator table per character. Measured before: 60 KB `python3 -c` with 2500 `open(...).write(...)` took 20.7 s; after: 0.02 s. A 1 MB Bash event through the whole script (interpreter start, git status snapshot) takes 0.11 s to 0.13 s. git runs as `git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null` and the tracked-file diff adds `--no-ext-diff --no-textconv`, so the hook neither takes the index lock nor runs programs the repository configures.

### backend/app/services/gates.py · live_notes

- refers-to: backend/app/services/gates.py :: live_notes
- kind: rationale
- logged: v0.11.0 · 2026-10-30

review L7. `live_notes` is what `GET /api/gates/notes` returns: one `git status --porcelain=v1 -z -- <note paths>` in the session's worktree (fsmonitor and hooks off, optional locks off) and only notes whose path is still modified or untracked are kept; the rest are dropped from memory, so a committed or reverted file loses its badge. If git fails the notes are returned unfiltered.

### backend/app/services/gate_hook.py · SCRIPT (more Bash forms gated before the call)

- refers-to: backend/app/services/gate_hook.py :: SCRIPT (expand, set_var, dd_writes, curl_writes, wget_writes, rsync_writes, zip_items, tar_items, unzip_writes, tar_writes, truncate_writes, awk_writes, git_writes, touch_writes, run_simple)
- kind: rationale
- logged: v0.12.0 · 2026-10-30

Narrows the "not gated before the call" list in the `lex, skip_paren, ...` entry. Still nothing is run: every new form only reads the command text and, for sources and archives, reads files with plain open or the standard `zipfile` and `tarfile` readers (no extraction, no shell, no program started).
New targets. `dd of=` (content from `if=` or the pipe when only `if/of/bs/ibs/obs/status` are given; `conv=notrunc`, `oflag=append` or `seek=` make it an Edit, `/dev/*` skipped). `curl`: `-o`, `--output X`, `--output=X`, `-o=X` and clustered `-sSLo X` (a cluster is read left to right and the first letter that takes an argument takes the rest of the word or the next word), `-O` and `--remote-name-all` pair in order with the URLs, `--output-dir` is honoured, `-o -` and `/dev/*` skipped, the name of `-O` is the last URL path segment without query or fragment. `curl -o=X` is accepted as X although real curl would name the file `=X`; the gate errs on the side of asking. `wget`: `-O`, `--output-document`, `-qO`, `-P`/`--directory-prefix`, plain URLs by basename (`index.html` for a trailing slash, query kept as wget does), `--spider` and `-O -` skipped; `-o`/`-a` log files are not treated as writes. `rsync`: last positional is DEST, a file goes to DEST or DEST/basename when DEST ends with `/`, exists as a directory or there are several sources; a directory source needs `-r` or `-a` and is walked (64 files, `.git` skipped), `SRC/` copies contents and `SRC` copies the directory; `-n`/`--dry-run`, `--files-from` and remote destinations are skipped; a remote source gives a path-only target. `unzip` (archive and `-d DIR`, `-j`, member globs; `-l -t -p -v -z -c -Z` skipped) and `tar -x` (old style `xzf`, `-C`/`--directory`, `--file`, `--strip-components`, member names; create, list, `-O`, `--transform` and stdin archives skipped). Task text said to ask formslot for files under DIR or to name the directory; formslot's `check` only matches a file path against a corpus and gives nothing for a directory, so the archive's member list is read instead (zip central directory, or a tar stream capped at 64 MiB decompressed, 2000 members and the shared 0.6 s budget by `Capped`), members are rejected when they contain `..`, and up to 8 members, code files first, become Write targets under DIR with their text when a code file is at most 64 KiB (32 reads). An archive that does not exist yet (made earlier in the same command), is dynamic, comes from stdin or is over 64 MiB stays with the PostToolUse check. `truncate -s N FILE` (empty content when N is 0), `git checkout [tree] -- PATH` and `git restore [-s X] [-W] PATH` (path-only Write; `--staged` alone, `-p`, `.` and pathspec magic skipped), `patch FILE` with no readable patch text (path-only Edit), and `awk`/`gawk`/`mawk` programs: `print` or `printf` followed within 512 characters and before `;`, `}` or a newline by `> "literal"` or `>> "literal"` that ends the statement (so `> "dir/" $1 ".txt"` is not taken), from the program word, `-e` or a `-f` file. `perl -i`, `python` and `node` stay as before.
Variables. `X=literal`, `export X=literal` (also declare, local, readonly, typeset) set a value in the walk; `$X` and `${X}` in later words, redirect targets and `<` files are replaced when every reference in the word is known. Not resolved, so left to the PostToolUse check: `$(..)`, backticks, `${X:-d}`, `$1`, an unknown name, a value with blank, glob or brace characters, a value from `read`, `for` or `unset` (those remove the name), `X=$(..)` and `X+=..` (remove it). A prefix assignment before a command (`X=a cmd`) does not set the shell variable, as in bash. The scope is the whole walked text including `bash -c` and subshells, so `(X=a); echo > $X` is resolved though bash would not; that can only add a gate. The unquoted-dollar escape `"\$X"` mixed with an expandable name in one word would be replaced wrongly; accepted as rare.
Fixes in the existing lexer. (1) Leading `if`, `then`, `else`, `elif`, `do`, `while`, `until`, `{` and `!` hid the real command, so `if x; then cp a b; fi` and `{ tee f; }` found nothing; they are skipped like wrappers. (2) A wrapper's option argument became the command name: `sudo -u root tee f`, `nice -n 5 cp`, `env -u X cp` found nothing; `sudo`, `env`, `nice` and `time` now take their argument letters. (3) After a `cd` to a dynamic directory every path, absolute ones too, was dropped; absolute paths now still resolve. (4) `touch -d DATE f`, `-t STAMP f`, `-r REF f` treated the date as a file, `touch -c` and `touch -- f` were wrong; fixed. (5) `patch --dry-run`/`--check`/`-C` and `git apply --check`, `--stat`, `--numstat`, `--summary`, `--cached` (without `--index`) wrote nothing yet were gated; skipped. (6) `X+=y` was read as a command name.
Limits kept: commands over 64 KB are not analysed, 2000 simple commands, 512 found writes, 0.6 s, 8 targets per call, the hook takes no lock and calls no shell. Measured: 64,035 byte command of 8,000 `echo` plus a `curl -o` 0.23 s; 60 KB of `print ` in an awk program 0.04 s; 3000 assignments 0.04 s; a 400 MB-of-zeros tar.gz (408 KB on disk) was cut by the decompressed-byte cap in 0.33 s with the members seen so far. `ln` is not parsed (the v0.11.0 text mentions it, the code never had it).

### backend/subform_ptyhost.py · Screen, plain_text, Host.tail

- refers-to: backend/subform_ptyhost.py :: Screen, plain_text, Host.tail, TAIL_RAW
- kind: rationale
- logged: v0.12.0 · 2026-10-30

Found in a real interactive Claude Code session (pty-host, 120x32): `terminal_tail` returned almost nothing useful. Claude Code draws with cursor moves, not text: a space is `ESC[nC` or `ESC[nG`, and a redraw moves up with `ESC[nA` and erases with `ESC[K`. The old plain_text only removed escapes and folded carriage returns, so words ran together ("Welcometo Claude Code") and after the first screen the whole tail was one spinner glyph. `plain_text` now feeds the bytes to `Screen`, a small VT model (cursor moves, CHA/VPA/CUP, erase in line and display, ICH/DCH/ECH, insert and delete line, scroll region, save and restore cursor, alternate screen kept apart from history) sized to the terminal's own cols and rows; lines scrolled off the top become history (20,000 at most) and the result is history plus the screen without trailing blank rows. Wide characters count as one cell. A `since` read renders the buffer to the offset and to the end and returns the lines after their common prefix, so a redrawn screen returns the lines from the first change on. `TAIL_RAW` is 256 KiB (was 1 MiB) because the model costs about 1.5 s per MiB in the host's loop; 194 KB of a real session renders in 0.12 s. Checked on the captured session: the final screen reads as the terminal showed it; checked on a live shell terminal: `printf 'one two\nxxxx\033[1A\033[2K...'` shows the erased line gone and `since` returns only the new lines. Not done here: `mcp_tools._scrub_partial` turns a word such as "shortcuts" or a shell prompt into `[redacted]` on a `since` read (services/mcp_tools.py is not in this scope).

### backend/app/services/mcp_tools.py · _scrub_partial, _partial_secret

- refers-to: backend/app/services/mcp_tools.py :: _scrub_partial, _partial_secret, PARTIAL_RUN
- kind: rationale
- logged: v0.13.0 · 2026-10-30

A `since` read can start in the middle of a line, so the first line may be the tail of a secret whose prefix (`sk-`, `ghp_`, `NAME=`) was cut off and that the full pattern set no longer recognises. The old rule replaced every run of 8 or more characters of `[A-Za-z0-9+/_=.~-]` on that line, which also took ordinary words ("shortcuts") and paths in prompts such as `root@vm:/home/...#`. The rule now looks at runs of 16 or more characters of `[A-Za-z0-9+_=~-]` (no `/` and no `.`, so paths and hostnames split into short pieces) and redacts one only when it has at least two digits, four letters and a Shannon entropy of 3.5 bits per character or more, the same measure `_entropy_secret` uses (which keeps its own 32 character and mixed-case rule for the whole text). `_redact` still runs over the whole text afterwards with every existing shape (keyword, flag, bearer, URL credentials, JWT, known token prefixes, PEM, entropy runs, the engine's own tokens), so real secrets are redacted as before. Checked: a prompt line, "shortcuts" and `claude-code-2-1-314` pass; a 24 character mixed-case and digit run, a 30 character one and a `ghp_` token are replaced. A truncated secret tail shorter than 16 characters, or one with fewer than two digits, can now pass; that is the cost of not hiding words.

### backend/app/services/gate_hook.py · SCRIPT (run_check, judge, trail, skipped, seen)

- refers-to: backend/app/services/gate_hook.py :: SCRIPT (run_check, judge, trail, skipped, seen_has, seen_add, main)
- kind: warning-context
- logged: v0.13.0 · 2026-10-30

Silent fail-open found with evidence. `formslot check` keeps a per-session "warned" list (formslot core/src/hook.rs, `hooks/<session_id>.json`) and answers Allow for a path and slot it already warned about in that session. Run by hand with the same payload twice and `session_id` "sess-A": the first call returned the slot warning, the second returned nothing; with another id, or with an empty id (which formslot does not persist), it warned again. So after an owner answered Use or Adapt, the agent's retry of the same Write was allowed with no gate and no `POST /api/gates`, and a path warned once through the PostToolUse Bash check was silent for a later Write. Inherited session markers made this worse because several runs shared one `session_id`. The Pre check now sends an empty `session_id` to formslot (`run_check(..., keep=False)`) so formslot's cache is not used, and the hook keeps its own cache: `<data>/hooks/gate-seen/<SUBFORM_SESSION>.json` holds `path|slot` keys and a key is added only when the owner answers Write new anyway. Use, Adapt, timeouts and unreachable engines are not remembered, so those retries gate again. The PostToolUse run keeps formslot's cache (`keep=True`) because it only reports. Checked against a live engine and a real worktree session: Write, answer Use, retry the same path: a second gate opened and was denied; Write new anyway, retry: no gate. Other fail-opens were silent too and are now loud: `subprocess.TimeoutExpired` (10 s) and any other exception from `formslot check`, a non-zero exit with empty output, a missing `formslot` binary, an engine that does not answer the gate, a gate that closed as timeout or abandoned, and any exception that reached the top of the script. Each writes one line to `<data>/hooks/sf_gate.log` (rotated at 1 MiB) and to stderr, and posts a note to `POST /api/gates/notes` for the file, which the review pane shows in the provenance badge as "Bash · slot unchecked, gate skipped: <reason>" (the pane's wording is fixed text, so the reason rides in the slot field; the pane's owner may want its own phrase). Checked with a check binary that sleeps 12 s and one that exits 3: both logged and noted, stdout empty, exit 0. The one cause that could not be reproduced is a run with no `POST /api/gates` after `/clear` that had a real match: with the shared inherited id and the warned list above it is the explanation that fits, and the inherited marker is now removed (routers log, terminal_env).

### backend/app/services/gate_hook.py · waived, digest, skipped, flush_notes (replaces seen_has, seen_add)

- refers-to: backend/app/services/gate_hook.py :: SCRIPT (waived, digest, skipped, flush_notes, judge); backend/app/services/gates.py :: _waive, is_waived, _waivers, _digests; backend/app/routers/formslot.py :: gate_waived
- kind: rationale
- logged: v0.13.0 · 2026-10-30

The hook's own seen cache (`<data>/hooks/gate-seen/<session>.json`) was a file the agent could write: it knows SUBFORM_SESSION, the path and the slot id, so it could pre-write the key and skip every gate. The file and `seen_has`, `seen_add` are removed. The engine now holds the state. When the owner answers Write new anyway through `POST /api/gates/{id}/answer` (window token), `gates.answer` records the tuple (gate path, first slot id, content digest) in `_waivers[session]`. The digest is SHA-256 of the tool name and the tool input without `file_path`, computed by the hook and sent when it opens the gate (`digest` field of `POST /api/gates`, kept in `_digests[gate id]`, never shown by `_public`). Before opening a gate the hook asks `GET /api/gates/waived?session&path&slot&digest` with its session gate token; the route is read-only, refuses another session's token (403) and answers `{waived: bool}`. There is no route that writes a waiver other than the owner-only answer. Because the digest covers the content, a waiver for one write does not cover a later write with different content; Use, Adapt, timeouts and abandoned gates record nothing. Each session keeps at most 200 waivers (oldest dropped, `WAIVERS_PER_SESSION`), and `close_session` drops them when the session ends; a restarted engine forgets them, so the next write gates again, which is the safe direction. A Bash write whose content cannot be parsed has digest of empty content, so one waiver covers later unparsed writes to that path and slot in the same session; that is a known limit. Checked against a live engine on port 5654 with a scratch data dir and real PreToolUse JSON: gate, answer write with the window token, same content passes with no gate; different content gates and Use denies; the other session's token gets 403 from the waived route; a session token cannot answer a gate (403); an agent that opens a gate with a chosen digest gets `waived: false` until the owner answers write; a second session with the same content gates.

`skipped` no longer posts the engine note itself. It writes the trail line and queues the note; `flush_notes` runs after the hook result has been written and flushed (end of the script), and posts only while at least 3 seconds remain of the host timeout (135 s for PreToolUse, 5 s for PostToolUse), with the request timeout capped at what is left minus one second. At most 20 notes are queued.

### backend/app/services/mcp_tools.py · _scrub_partial, _partial_secret, PARTIAL_RUN

- refers-to: backend/app/services/mcp_tools.py :: _scrub_partial, _partial_secret, _mixed, PARTIAL_RUN, PARTIAL_SHORT, PATH_PIECE, DOT_WORD, WORD_PIECE
- kind: rationale
- logged: v0.13.0 · 2026-10-30

The previous rule (runs of 16 or more characters, 2 digits, 4 letters, entropy 3.5) let cut-off secret tails of 16 to 24 characters through. Measured with 200 random tails (100 base64 of random bytes, 100 hex, lengths 16 to 24, seed 7): 109 of 200 passed unredacted before (33 base64, 76 hex), 14 of 200 after (8 base64, 6 hex). The run pattern now also allows `/`, `.`, `+` and `=`. Runs of 24 characters or fewer need 1 digit, 3 letters and entropy of 3.0 or more; longer runs keep 2 digits, 4 letters and 3.5. Exempt before counting: a run starting with `/` or `~`; a run with `/` whose pieces are all 10 characters or fewer and none mixes upper case, lower case and a digit; a dotted run whose pieces are all words or plain numbers; a hyphenated run of three or more pieces that are lower-case words or 1 to 3 digit numbers. Checked unredacted: "shortcuts", `root@vm:/home/x/dist#`, `claude-code-2-1-314`, absolute and `~` paths, `src/components/terminal/dock`, dotted host names, kebab-case names. Remaining leaks are tails whose characters repeat enough to fall under 3.0 bits, or with a `/` that splits them into short pieces; a tail under 16 characters is not looked at, and `_redact` still runs afterwards on the whole text.

### backend/app/services/gate_hook.py · skipped, flush_notes, main (note kind and reason)

- refers-to: backend/app/services/gate_hook.py :: SCRIPT (skipped, flush_notes, main, post_bash); backend/app/services/gates.py :: add_note; backend/app/routers/formslot.py :: NoteBody
- kind: rationale
- logged: v0.14.0 · 2026-10-30

Notes posted to `POST /api/gates/notes` now carry `kind` ("slot" for the PostToolUse overlap note, "skipped" for a fail-open) and `reason`. `skipped(why, shown, tool_name, short)` keeps the long `why` for the trail line and the note message (the hover detail) and sends `short` as the reason, a plain sentence such as "formslot did not answer in time", "formslot check failed", "formslot was not found", "the engine did not answer the gate". The old text "unchecked, gate skipped: <why>" in the slot field is gone; skipped notes post an empty slot. A missing formslot binary used to write only the trail line; it now also queues a skipped note when the call has a file path. `gates.add_note` stores `kind` (anything but "skipped" is "slot") and `reason` (300 characters); `NoteBody` accepts both. Notes of the old shape from an older hook still arrive with kind absent and are labelled by the window. Checked on port 5654 with a scratch data dir: hook runs with FORMSLOT_BIN missing, a check script that exits 3 and a check script that sleeps 12 s produced notes of kind skipped with reasons "formslot was not found", "formslot check failed" and "formslot did not answer in time"; a hand-posted old-shape note and a kind slot note were listed unchanged.

### backend/app/services/gate_hook.py · reason_for (Adapt answer, live run)

- refers-to: backend/app/services/gate_hook.py :: reason_for; backend/app/services/gates.py :: answer, _close
- kind: warning-context
- logged: v0.14.0 · 2026-10-30

First end-to-end run of the Adapt answer in an interactive Claude Code 2.1.316 terminal (port 5653, scratch data dir, formslot v0.13.0 binary and store copy, corpora formvis-sf and ws, workspace a scratch git repo). Prompt: Write a NEW src/slider.ts declaring sliderRow. The gate opened 4.4 s after the prompt was sent; the window token answered adapt. Claude received exactly the deny reason from `reason_for`: "PreToolUse:Write hook error: The owner chose to adapt the existing slot ui.control-rows at frontend/src/ui/panels/controls.ts:10. Do not write a parallel copy. Start from that code and change only what this task needs." Run 1 (current text): it read frontend/src/ui/panels/controls.ts in the worktree (absent), called formslot and subform MCP tools, then stopped after about 20 s with a question to the owner and wrote nothing, because the slot lives in another repository (formvis) and the text names no way to read it. Copying the slot was not the failure; having no source and no instruction for that case was. Run 2 (scratch-only text, see below): Claude ran `formslot slot get`, found a checkout by sha256 of the slot file, and then Claude Code auto mode blocked reading it outside the worktree ("Credential Exploration"); it followed step 3, wrote an adaptation from the slot's documented API (header comment says so, keeps Row, fmt, clamp, sliderRow with limits, returns {el, set}) 93 lines, and reported the gap honestly. Two things the text cannot fix: the hook's retry with different content is a new digest, so the adapted Write opened a second gate for the same slot (answered write), and a slot whose source is outside the worktree cannot be read by an auto-mode session. In the real workspace (subform itself holds copies of controls.ts) the first read succeeds. The adapt and use texts live in gate_hook.py (sf-notes), not gates.py, so the proposed text is left for that file: "The owner chose ADAPT: build this file from the existing slot <id> (code at <path>:<line>), not from scratch and not as a parallel copy. This write was held, nothing was written yet, and the owner does not need to be asked again. Do this now: (1) Get the slot code. If <path> exists in this worktree read it there. If it does not, it lives in another family repository: run `formslot slot get <id>` (the origin line names the repository and its copies list other paths) and read that file from a checkout of the repository on this computer. (2) Write the file you were asked for again, as an adaptation of that code: keep its exports, signature, helpers and conventions and change only what this task needs. (3) If you truly cannot read the slot code, say so in one line and write the smallest version you can instead of stopping to ask. The adapted write may open the owner's slot card once more; wait for it." Timings: gate to answer 4.3 s and 24 s (human delay), answer to first Claude tool use under 3 s, run 2 end to end 206 s including a 2 m API retry stall.

### backend/app/services/sessions.py · prepare_worktree, register_target, drop_target, mcp_args, RUN_KIND

- refers-to: backend/app/services/sessions.py :: create, prepare_worktree, register_target, drop_target, mcp_args, _entry, _changed, _notice, _save, list_sessions; backend/app/services/runs/worktree.py
- kind: rationale
- logged: v0.15.0 · 2026-10-30

The worktree part of `create` (repository and base check, `git worktree add -b`, the `.subform/` exclude, `mcp.json`, `settings.json`, identity and the commit-msg hook) moved unchanged into `prepare_worktree(root, base, tag, branch)`, so graph runs build their worktree with the same code; `create` calls it and the order of checks and the error texts are the same as before. `register_target` and `drop_target` add and remove an item in `_sessions` for a graph run (`kind: run`); such items are not listed, not saved to `sessions.json` and not published as session events or notices, and `_entry` asks `runs/worktree.restore` for an unknown id starting with `run`. See runs/HASHOUT_LOG.md for why a run is a session-shaped target.

### backend/app/services/gate_hook.py · reason_for (slot_source first)

- refers-to: backend/app/services/gate_hook.py :: reason_for
- kind: rationale
- logged: v0.15.0 · 2026-10-31

Step 1 of the Use and Adapt texts now names formslot's v0.15.0 tool: call the MCP tool `slot_source` with the slot id (or run `formslot slot source <id>`), which returns the slot's files at the pinned commit from git objects, including for a slot whose code lives in another repository; only if that is unavailable fall back to reading the path in the worktree or `formslot slot get <id>` plus a checkout. The rest of the turn 11 wording (steps 2 and 3, the no-second-ask sentence, the second gate note) is unchanged. Live run, Claude Code 2.1.316 interactive in the pty host (port 5653, scratch data dir, fresh formslot-cli build, copy of store-v140, scratch git workspace registered as corpus ws; prompt: create a new src/slider.ts exporting sliderRow(label, min, max, value, onChange) returning {el, set}): gate at 123.8 s (the first Enter was lost, so that is prompt delay), answer adapt; Claude received the new text, loaded `mcp__formslot__slot_source` through ToolSearch and called it with `{id: "ui.control-rows"}` as its first action, then said the result had metadata but no source text, checked the worktree (file absent), and wrote the smallest version from the slot's API (steps 3), 5742 characters in the tool result. A second gate opened for the adapted write (new content digest, as in turn 11), answered write. Cause of the missing text: the tool answers a text block with the header and a second block with the file envelope, and `structuredContent` with the file texts removed; Claude Code passed the structured content to the model, so the file text never arrived. Called by hand over stdio, the server returns both blocks (2581 and 12683 characters). The fix belongs in formslot (include the file text in `structuredContent`, or send the header and envelopes in `structuredContent.files[].text`); the hook text is right. The window token in this run was fetched from `POST /api/window-token` with a same-origin header because `SUBFORM_WINDOW_TOKEN` shorter than 32 characters is ignored.

### backend/app/services/sessions.py · _start_claude_terminal, _start_headless (setting sources)

- refers-to: backend/app/services/sessions.py :: _start_claude_terminal, _start_headless
- kind: warning-context
- logged: v0.16.0 · 2026-11-01

Live check (Claude Code 2.1.316, port 5653): a worktree holding a committed `.claude/settings.json` with a SessionStart hook ran that hook in an interactive session once the trust prompt was accepted, because the sessions passed only `--settings` and Claude Code still read project settings from the checkout. A committed `.subform/settings.json` never ran (Claude Code does not read that path). Both launches now pass `--setting-sources user`, so only user settings and the engine's own `--settings` file apply, as graph runs already do. The flag sits in the two launch functions and not in `_mcp_arg`, because `runs/worktree._run_args` indexes the `_mcp_arg` list and `runs/agent` adds the flag itself.

### backend/app/services/sessions.py · _sources (project sources for trusted workspaces)

- refers-to: backend/app/services/sessions.py :: _sources, create; backend/app/routers/sessions.py :: NewSession, create; frontend/src/io/sessions.ts :: SessionsClient.create
- kind: rationale
- logged: v0.16.0 · 2026-11-01

Review found, and a `claude -p` probe confirmed, that `--setting-sources user` also drops the project's CLAUDE.md and `.claude/skills` (the probe answered NONE for both; with `user,project` it found the codeword and the skill). Sessions now record `trusted` at creation and pass `user,project` only for a workspace trusted in Preferences, matching how language servers, debug venvs and run tools treat programs found in a workspace; an untrusted workspace keeps `user` only, so its committed hooks do not run and its CLAUDE.md and skills are not loaded. The window sends `trusted` with its token, and the router honours the flag only when the window token is valid, so a local process without the token cannot ask for project sources. A session restored from the registry without the key is untrusted.
- todo: graph runs (`runs/agent.py`) still pass `user` only, so graph agents never see the project's CLAUDE.md or skills.

### backend/app/services/secret_store.py · status from the index, keychain only on use

- refers-to: backend/app/services/secret_store.py :: system_store, status, names, get, put, delete, settle_many, _index, _state, _mark, _write_private, _file_values; backend/app/routers/secrets.py :: present, list_names, put_secret, delete_secret, _names, migrate_keyring, TRACKED_RESERVED
- kind: rationale
- logged: v0.19.0 · 2026-11-22

On a Mac the new bundle id `ai.nodemode.formsubstrate` is a different keychain client, so every `keyring.get_password` made just to answer "is a key saved" opened a keychain prompt when Welcome or Preferences opened. Status is now answered from `secrets-index.json` in the data folder and nothing else; the keychain is read only by `get` (a feature about to use the value, today the Cogentics provider call), and written or deleted only by `put` and `delete`. Ported in idea from formvis `backend/app/services/secrets.py` (Apache-2.0, `summary` answers from `keys.json`, `_store` treats keyring's fail and null backends as no store); the code is new.

Index shape, version 2: `{"version": 2, "secrets": {name: {"store": "keychain" | "file"}}, "unknown": [names] | "*", "absent": [names]}`. It names secrets and their store, never a value or part of one. A name in `secrets` is saved; with `unknown` a list, a name in it is not known yet and any other name is absent; with `unknown` `"*"` every name is not known yet except those in `absent`. `status(name)` returns `{"present": true | false | null, "state": "saved" | "absent" | "unknown", "store": "keychain" | "file" | null}`. When the state is unknown and there is no system store, status looks only in the user-only file and otherwise answers absent without writing that down, so a keychain that comes back later (a Linux Secret Service that starts after login) is still asked on first use.

Which names: the router's own names (`anthropic-api-key` and any other non-reserved name) and `cogentics-api-key`. MCP headers, webhook secrets and plugin secrets keep their own keyring calls in `library/mcp_client.py`, `triggers/hooks.py` and `library/plugins.py`; those read only on use already (connecting, verifying a delivery, running a plugin), are not in the index, and still need a system keyring.

No system store: `system_store()` is false when `keyring.get_keyring()` fails, is keyring's `fail.Keyring` or `null.Keyring`, or has priority 0 or less; `put` also falls back when `set_password` raises `NoKeyringError`. The value then goes to `secrets-local.json` in the data folder as `{"formsubstrate": {name: value}}`. Both that file and the index are written to a temporary sibling opened with `os.open(O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)` (plus `O_BINARY` on Windows), fsynced and moved into place with `os.replace`, so neither is ever readable by other users, not even between create and chmod; the umask can only narrow the mode. On Windows the mode bits do not apply: the file sits in `%APPDATA%\formsubstrate`, whose ACL from the user profile grants only that user, SYSTEM and administrators, and that is the protection. Saving to the keychain later removes the file copy; removing a key deletes it from both stores, and the file is deleted when its last value goes. Any other `KeyringError` (a locked or refusing keychain) is `StoreError`, which the router answers with 503 `the system keychain refused: <ErrorClass>`; no message, log line or error body carries a value.

Upgrade from 0.18.x, decided for the person: keyring has no call that tells whether an entry exists without reading it (`get_password` and `get_credential` both read, and on macOS both can prompt), so the index is never rebuilt from the keychain. (1) A 0.18.x index `{"names": [...]}` is converted on first read, without any keychain call, into version 2 with each listed name saved in the keychain. That list is reliable: since v0.4.0 it was written after every successful save and on every delete through this router. `cogentics-api-key` was saved by Cogentics without the index, so it is put in `unknown`; every other name is absent. (2) No index at all with the migration marker already present (a 0.18.x install that never saved a key through Preferences, or a lost index): every name is unknown. An unknown name is settled on first use (`get` reads once and records saved or absent), on save and on remove. Welcome shows "Not checked yet" and Preferences shows "Not checked yet. Save the key again or remove it to settle this." with Remove enabled; this is honest, costs no prompt, and one save fixes it. For the Cogentics key, unknown counts as configured, so its first real provider call reads the key once and settles it; if nothing is there the call goes without a key and the provider answers with its own error, after which the key is absent and Cogentics shows not configured.

Migration: `migrate_keyring` still reads the old and new keychain entries once, as before, then calls `settle_many(found, complete=True)`: every tracked name it saw in the new service or copied from the old one is saved in the keychain, every tracked name with nothing in either is absent, an existing file entry is kept, and `unknown` becomes empty. A fresh install therefore has a complete index after its first start. If the migration stops on a keychain error it returns before writing, as before, and the next start tries again. When no system keyring exists at all the loop stops at its first read, no marker is written, the index stays as it was, and status answers from the file.

Shapes. Before: `GET /api/secrets/{name}` `{"present": bool}` from `keyring.get_password`, 503 `no system keyring` without a keyring; `PUT` 204 with no body, 503 without a keyring; `DELETE` 204. After: `GET` returns the status above and never 503; `PUT` 200 with the status after saving (so the window can say which store holds it); `DELETE` 204; `GET /api/secrets` `{"names": [...]}` from the index, reserved names left out. Checked from /tmp with TestClient and a made-up data folder: with a test keychain whose `get_password` raises, GET status, list and PUT made no read; a 0.18.x index converted without a read; with the fail backend PUT answered `store: file`, `secrets-local.json` and the index were mode 0600, DELETE removed the file; the migration copied an old-service value and wrote a complete index. Nothing was run against a real system keychain.

### backend/app/routers/secrets.py · removed code (index helpers, keychain status read)

- refers-to: backend/app/routers/secrets.py :: present, _names, _save, _lock, _index_file, put_secret, delete_secret
- kind: removed-code
- logged: v0.19.0 · 2026-11-22

Logged here because `backend/app/routers/HASHOUT_LOG.md` belongs to another worker this turn. The status read that touched the keychain:

```python
@router.get("/secrets/{name}")
def present(name: str) -> dict:
    _check(name)
    try:
        return {"present": keyring.get_password(SERVICE, name) is not None}
    except KeyringError:
        raise _unavailable()
```

The version 1 index helpers, now `secret_store._index` and `_write_private`:

```python
def _save(names: list[str]) -> None:
    target = _index_file()
    temp = target.with_name(target.name + ".tmp")
    temp.write_text(json.dumps({"names": sorted(set(names))}), encoding="utf-8")
    os.replace(temp, target)
```

`_names` read `{"names": [...]}` directly; it now asks `secret_store.names()` and drops reserved names. `put_secret` and `delete_secret` called `keyring.set_password` and `keyring.delete_password` and then `_save` under a module `_lock`; they now call `secret_store.put` and `delete`, which hold the store's own lock. In `migrate_keyring` the block that indexed copied names (`indexed = [...]; _save([*_names(), *indexed])`) is replaced by `settle_many`. `NO_KEYRING` changed from `no system keyring` to `the system keychain refused`, because a missing keyring is no longer an error.

### backend/app/services/cogentics/llm.py · key read on use

- refers-to: backend/app/services/cogentics/llm.py :: Client._load, Client.api_key, Client._key_saved, Client.configured, Client.apply, Client.forget_key, Client.snapshot, Client.headers
- kind: removed-code
- logged: v0.19.0 · 2026-11-22

`_load` ran on every `snapshot`, `configured` and status call (the Cogentics panel and console call them on open) and read the key from the keychain each time a client loaded:

```python
        try:
            self._key = keyring.get_password(KEY_SERVICE, KEY_NAME)
        except KeyringError:
            self._key = None
```

It is gone, with `KEY_SERVICE` and the `keyring` imports. `api_key` now calls `secret_store.get(KEY_NAME)` the first time it is needed and keeps the value in the client; `headers()` uses `api_key`, so the read happens only when a request to the provider is built. `configured` and `snapshot()["has_key"]` come from `secret_store.status`: configured is true unless the index says absent, `has_key` only when it says saved. `apply` saves through `secret_store.put` (so it falls back to the user-only file and keeps the index in step) and `forget_key` through `secret_store.delete`, returning quietly on `StoreError` as it did on `KeyringError`. The provider file `cogentics-provider.json` is unchanged.

### backend/app/services/mcp_tools.py · run_list, run_status, gate_notes, formslot_slot

- refers-to: backend/app/services/mcp_tools.py :: TOOLS, noun_key, HANDLERS, run_list, run_status, gate_notes, formslot_slot, _run_row, _run_rows, _run_shape, _node_row, _event_row, _park_row, _scrubbed, _formslot_call, _formslot_data, _corpus_for, _first_line, _drift_of
- kind: rationale
- logged: v0.21.0 · 2026-11-22

Four read-only tools over data the engine already holds; no accessor was added to another module. `run_list` pages `runs.manager.history(root)` (saved records plus live runs, newest first, capped at 100 by `history`) and `run_status` reads `manager.runs` for a live run whose `root` equals the caller's root, else `manager.read_disk(root, id)`; ids must match the manager's `ID_RE`. The root is `_root`: a session token gets its own worktree, so it sees only runs keyed to that worktree (`runs_dir` hashes the root), and runs started in the window on the open workspace stay out of its reach; a run id from another root answers "no such run" so its existence is not leaked. `run_status` never returns node inputs, outputs, run inputs or the graph document; a park is shown as id, node, label and the type it waits on, because a park's `on` can hold tool arguments and a diff. Task, event notes and node errors are passed through `_redact` on their first 4,000 characters and then clipped (160 characters for a task in the list, 2,000 in status, 300 for notes and errors), so a secret cut by the clip is redacted first. Disk reads run in a thread, as the sync router does. `gate_notes` calls `gates.live_notes`, the same read as `GET /api/gates/notes`: it runs a read-only `git status` on the listed paths and drops notes for files no longer changed, which also trims the stored list exactly as the window's poll does; the window token must name the session. `formslot_slot` repeats the window's FormSlot card (`extensions/formslot` `load` and `paint`): `slot_find` with the workspace-relative path, units whose path equals the file, slots whose `slot_get` files list it, and the drift entry from `formslot slot drift --repo <root> --json` (with the `--infer` retry of `formslot.drift`), run through `formslot._split` with a 30 s limit and parsed by `formslot._drift_files`. Unlike the window, which assumes every hit belongs to the open workspace, it keeps only hits whose `corpus` names the corpus holding the root (or, for a session, the session's repository), so another repository's slots are never shown; hits without a corpus name are counted in `left_out`. The path goes through `_confined`, so `..`, absolute paths, symbolic links, `.git`, `.formsubstrate` and dotenv files are refused. It never starts formslot or indexes; formslot not installed or not running is a tool error. `formslot.Refused` is turned into `ToolError` inside the tool because `call_tool` does not catch it. The window's "turned off in Preferences" switch lives only in the window and is not checked. Language-server problems are not exposed: `routers/lsp.py` forwards `textDocument/publishDiagnostics` from the server to the window's websocket and keeps nothing, so the engine has no store of problems to read.

### backend/app/services/mcp_tools.py · problems

- refers-to: backend/app/services/mcp_tools.py :: TOOLS, noun_key, HANDLERS, problems, _problem_docs, _problem_row, _uri_rel, PROBLEM_CLIP, SEVERITIES, SEVERITY_WORDS
- kind: rationale
- logged: v0.21.0 · 2026-11-22

The read-only tool `problems` replaces the last sentence of the entry above: the relay now records each publish in `core/lsp.py` (see `backend/app/core/HASHOUT_LOG.md`, `record_diagnostics`). Arguments `path`, `severity` (error, warning, info, hint), `limit` (default 50, at most 100), `cursor` and `session`. The root is `_root`, so a session token reads only its own worktree's root and the window reads the open workspace or a named session; a client added in Preferences gets it through the read-only allow list. Language servers run only for the window's open workspace, so a session worktree has problems only while it is the open workspace; when the store has no entry for the root the result says so in plain words, with `reported: false`, instead of an empty list that reads as "no problems". With a path (through `_confined`, a folder refused) it pages that file's problems: line and column from 1, severity as a word, message through `_scrubbed` (redacted, then clipped to 300 characters), source and code, plus `version`, `reported_at`, `sent` and `kept`; a file whose last publish was empty answers zero problems with `reported: true`. Without a path it pages files with problems, newest publish first: path, errors, warnings, problems and reported_at; with severity only files holding one of that severity. Clip and page size were set so a full page of the longest messages stays under the 25,000 token cap with its text: at 500 characters and 200 per page `_finish` dropped the structured result and the cursor with it. URIs are mapped to paths at read time by `_uri_rel` in a worker thread: only `file` URIs with an empty or `localhost` host and no query or fragment, strict percent-decoding (`%00` and broken UTF-8 refused), the leading slash before a Windows drive removed, then `realpath`, which resolves `..` (also `..%2F`) and symbolic links, and the result must be strictly inside the root and pass `_refuse_parts` (no `.git`, `.formsubstrate`, dotenv files). Anything else is skipped, so no path outside the root ever appears; two URIs that resolve to one file show the newest. Verified with TestClient from a script under /tmp, never in the tree.

### backend/app/services/sessions.py · _mcp_config (a packaged engine offers itself to sessions)

- refers-to: backend/app/services/sessions.py :: _mcp_config; backend/formsubstrate_engine.py :: main (--mcp)
- kind: rationale
- logged: v0.21.0 · 2026-11-22

The `formsubstrate` entry of a session's `mcp.json` was written only when `./formsubstrate` (or `formsubstrate.bat`) sat in the repository folder above the engine, so every session of a packaged app ran without Substrate's own MCP server, and the session note said so. A frozen engine (`sys.frozen`) now names itself: `command` is `sys.executable` (the `formsubstrate-engine` program) with `args` `["--mcp"]`; from a checkout it is the launcher with `["mcp"]` as before. The `env` is the same in both (`FORMSUBSTRATE_GATE_TOKEN` and `FORMSUBSTRATE_ENGINE` expanded by Claude Code, and the data folder), so the frozen `--mcp` mode finds the running engine the way the launcher does. Removed: `if launcher.is_file():` and `"command": str(launcher), "args": ["mcp"],`. Checked by calling `_mcp_config` with and without `sys.frozen` set in a throwaway script; not run in a built app.

### backend/app/services/mcp_tools.py · gate_notes (the refusal a client reads)

- refers-to: backend/app/services/mcp_tools.py :: gate_notes
- kind: rationale
- logged: v0.21.0 · 2026-11-22

A client added in Preferences may not name a session (the rule at the top of `call_tool`), so `gate_notes` always refused it with the window's message, "session is required for the app window". A client now reads "gate notes belong to one agent session; an MCP client added in Preferences cannot read them". The window and session tokens get the same answers as before.
