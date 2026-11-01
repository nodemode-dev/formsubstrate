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
