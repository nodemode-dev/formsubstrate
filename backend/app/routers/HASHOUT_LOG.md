# HASHOUT_LOG · backend/app/routers (workspace and secrets) · subform

Living log for the F3 and F4 engine routes and their helpers: routers/workspace.py, routers/secrets.py, core/workspace_root.py, core/binres.py. Source files stay comment-free; what they would have said lives here. The engine-wide log is backend/HASHOUT_LOG.md.

Current build version: v0.4.0
Last updated: 2026-10-30 · Phases F3 and F4

### backend/app/routers/workspace.py · search flags

- refers-to: backend/app/routers/workspace.py :: search
- kind: rationale
- logged: v0.4.0 · 2026-10-30

`regex` and `case` are booleans, so FastAPI accepts `true`/`false` as the window sends them and `1`/`0` as curl does. As ints the window's `case=false` was a 422 and the search panel showed nothing (found by the F4 exit check).

### backend/app/core/binres.py · find_bin
- refers-to: backend/app/core/binres.py :: find_bin
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Ported from substrata backend/app/core/binres.py (MIT, owner's). One choke point for every program the engine shells out to. Order: the folder named by SUBFORM_BIN_DIR (renamed from SUBSTRATA_BIN_DIR), then a `bin` folder inside the PyInstaller unpack folder (`sys._MEIPASS`) so a frozen build with a vendored ripgrep needs no setting, then PATH. A candidate must be a file with the execute bit; on Windows the `.exe` spelling is tried too.

### backend/app/core/workspace_root.py · module
- refers-to: backend/app/core/workspace_root.py :: _root
- kind: explainer
- logged: v0.4.0 · 2026-10-30

The workspace root is a process-wide singleton (current root or None), not persisted: the window reopens its last folder from the recent list. The stored root is `normpath` of what the window sent; every use goes through `realpath` (`real_root`). recent.json lives in the data folder, 12 entries, newest first, `{path, name, opened}` with a UTC ISO time; it is rewritten through a temp file and `os.replace` under a lock. An unreadable or malformed file reads as an empty list.

### backend/app/core/workspace_root.py · resolve
- refers-to: backend/app/core/workspace_root.py :: resolve
- kind: rationale
- logged: v0.4.0 · 2026-10-30

The one confinement helper every workspace route calls. Refuses (403) an absolute path (posix, backslash, or drive-letter form), any part equal to `..`, and any path whose `realpath` is not equal to or under `realpath(root)`; a NUL or non-string is 400; no open workspace is 409. Parts are split on both slashes and `.` parts dropped, so `a/./b` and `a\b` behave the same on every platform. With `write=True` it also refuses (403) when any part of the request, or of the resolved path relative to the root, is `.git`: the second check stops a symlink inside the workspace pointing into a `.git` folder. `follow=False` (rename source and destination, delete) resolves only the parent and keeps the last name, so a symlink can be renamed or removed as a link without being followed; the parent still has to be inside the root. Reads of `.git` stay allowed (only the tree listing hides it).

### backend/app/core/workspace_root.py · HIDDEN_NAMES
- refers-to: backend/app/core/workspace_root.py :: HIDDEN_NAMES
- kind: explainer
- logged: v0.4.0 · 2026-10-30

`.git, node_modules, __pycache__, .venv, venv, target, dist`: hidden from the tree listing and skipped by search (both engines). Listing-only: a path inside them can still be read by name (except writes into `.git`). Edit the tuple to change it.

### backend/app/routers/workspace.py · isFormRepo and branch
- refers-to: backend/app/routers/workspace.py :: _is_form_repo
- kind: explainer
- logged: v0.4.0 · 2026-10-30

True when CLAUDE.md or AGENTS.md (first 64 KiB) names one of formvis, formcut, formwav, formslot, formhub, formnodal, formbend, formai, subform as a whole word, or package.json `name`, or Cargo.toml `[package] name`, starts with `form` or is `subform`. The guide-file words are an explicit list, not a `form*` pattern, because "format" and "formal" would match. Branch is `git rev-parse --abbrev-ref HEAD` in the root; a folder inside a bigger repo reports that repo's branch; a repo with no commit, or no git on PATH, gives null; a detached HEAD gives "HEAD".

### backend/app/routers/workspace.py · read and write
- refers-to: backend/app/routers/workspace.py :: read_file, write_file, _atomic_write
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Read: 415 with `{"detail"}` for over 4 MiB, a NUL in the first 8 KiB, or bytes that are not UTF-8. Write: expectedMtime compares with a 1e-6 s tolerance (a JSON round trip of a Python float is exact; the tolerance only forgives other clients); a missing file with an expectedMtime is 409 (deleted behind the editor's back). The temp file (`.sf-*.tmp`) is made in the target's folder so `os.replace` is atomic on one volume; it is fsynced, takes the old file's mode (or `0666 & ~umask` for a new file, because `mkstemp` makes 0600), and is removed on any failure. Writing through a symlink inside the workspace replaces the real target file. Text is encoded as given: line endings are never changed.

### backend/app/routers/workspace.py · delete, rename, mkdir
- refers-to: backend/app/routers/workspace.py :: delete, rename, mkdir
- kind: explainer
- logged: v0.4.0 · 2026-10-30

Replies are `{"path"}`, `{"from","to"}`, `{"path"}`. delete: a file or symlink is unlinked, an empty folder removed, a non-empty folder 409, the root 400. rename: destination existing is 409 (never overwrites), destination parent must exist (404). mkdir: creates intermediate folders, 409 if it exists. Substrata's recursive `rmtree` delete is deliberately not ported.

### backend/app/routers/workspace.py · search
- refers-to: backend/app/routers/workspace.py :: search, _rg_search, _py_search
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Ported from substrata routers/workspace.py (MIT, owner's), reshaped to the contract. ripgrep runs with `--hidden --no-ignore` plus `--glob !name` for each hidden name so it agrees with the Python fallback, which has no .gitignore support; `case=0` is `--ignore-case`, `regex=0` is `--fixed-strings`. Output is streamed and the process killed once limit+1 hits exist, which is what sets `truncated`; a 15 s timer kills a runaway search. Column is converted from rg's byte offset to a character count. The Python fallback skips symlinks, files over 4 MiB, binary files and non-UTF-8 files, and its glob matches the relative path or the bare name. Limit is clamped to 1..1000; an invalid regex is 400 (rg's first stderr line, or the Python `re` error); results are not sorted (rg is parallel). Text is stripped and cut to 240 characters.

### backend/app/routers/secrets.py · keyring store
- refers-to: backend/app/routers/secrets.py :: router
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Values live only in the system keyring under service "subform". `secrets-index.json` in the data folder holds names only, because keyring cannot list. The PUT body is parsed by hand (not a pydantic model) so a malformed body can never be echoed back in a 422 that contains the submitted input. Any KeyringError (including NoKeyringError, which is what a container without a backend raises) becomes 503 `{"detail":"no system keyring"}`; the index is changed only after the keyring call succeeded. DELETE of a name the keyring does not hold is still 204 and drops the name from the index. A value is 1 to 65536 characters.

### backend/app/main.py · routers
- refers-to: backend/app/main.py :: include_router
- kind: explainer
- logged: v0.4.0 · 2026-10-30

workspace and secrets routers mounted under /api, behind the existing LocalGuard like every route. Version bumped to 0.4.0 in app/__init__.py.

### backend/app/routers/workspace.py · removed-code
- refers-to: backend/app/routers/workspace.py :: browse, locate, configure, upload
- kind: removed-code
- logged: v0.4.0 · 2026-10-30

Substrata's /browse, /locate, /upload and the plugin and skill loading in /configure are not ported: the folder picker is the desktop shell's, there are no plugins here, and upload is not in the contract.

## Review fixes (v0.4.1)

### backend/app/routers/workspace.py · hardening

- refers-to: backend/app/routers/workspace.py :: open_workspace, write_file, rename, search, _regular
- kind: rationale
- logged: v0.4.1 · 2026-10-30

From the fresh-context review, each reproduced first. The Form-repo probe reads CLAUDE.md, AGENTS.md, package.json and Cargo.toml only when they are regular files of at most 1 MiB, and runs in the thread pool: a FIFO named CLAUDE.md used to block the whole engine. Writes over 8 MiB are 413 (checked on Content-Length and on the text). `create: true` refuses an existing path with 409 so New File never truncates a file; null `expectedMtime` without `create` still means overwrite (the editor's Overwrite after a conflict). A read-only file is 403 instead of being replaced. Rename into itself or under itself is 409, and other OS errors from rename are 409, not 500. Malformed JSON is 400 on every route. A NUL in the query or glob is 400. ripgrep skips files over 4 MiB (`--max-filesize 4M`), matching the read limit. Without ripgrep a regular-expression search is refused with 400, because Python's `re` has no timeout and a hostile pattern could pin the engine; plain-text search still works.

### backend/app/routers/secrets.py · names

- refers-to: backend/app/routers/secrets.py :: _check
- kind: rationale
- logged: v0.4.1 · 2026-10-30

Names are checked with `fullmatch`: `$` in `match` accepts a trailing newline.

### backend/app/core/workspace_root.py · case of .git

- refers-to: backend/app/core/workspace_root.py :: resolve
- kind: rationale
- logged: v0.4.1 · 2026-10-30

On a case-insensitive file system (macOS default, Windows) a write to `.GIT/config` reaches the git folder, so the protected-name check compares lowercased parts. On Linux `.GIT` is a different folder and is refused too, which costs nothing.

### backend/app/routers/debug.py · relay

- refers-to: backend/app/routers/debug.py :: debug_ws
- kind: explainer
- logged: v0.7.0 · 2026-10-30

GET /api/debug/adapters reports root, and per adapter: available, python (the debuggee's), adapterPython, debugpy version, source (workspace venv or system), the probed candidates and, when missing, the exact install command for the python that would run the program. WS /api/debug/ws: one session at a time (a second connection gets the event subform/busy and close code 4409), no open workspace or no debugpy gets subform/unavailable with the install hint and close 4404. Messages are DAP JSON as text frames, framed with Content-Length towards the adapter and unframed back. Engine shutdown calls core.debug.shutdown from the lifespan, after terminals. The route sits behind LocalGuard like every other.

### backend/app/routers/lsp.py · _answer

- refers-to: backend/app/routers/lsp.py :: _answer
- kind: warning-context
- logged: v0.7.0 · 2026-10-30

The relay answers three server-to-client requests itself (client/registerCapability, client/unregisterCapability, window/workDoneProgress/create get a null result; workspace/configuration gets a list of nulls). @codemirror/lsp-client answers every server request with MethodNotFound, which makes the native TypeScript server and pyright log failures. Everything else passes through untouched.

### backend/app/routers/git.py · CommentBody.hunk

- refers-to: backend/app/routers/git.py :: CommentBody
- kind: rationale
- logged: v0.7.0 · 2026-10-30

review5 L4: `hunk` was unbounded and is stored in sessions.json (200 kept). It is capped at 200000 characters. The size of whole diff output is still capped only per file text; not done.

### backend/app/routers/git.py · push

- refers-to: backend/app/routers/git.py :: push
- kind: rationale
- logged: v0.7.0 · 2026-10-30

A refused plain push answers like a refused sign-and-push: `detail` plus `ok`, `check`, `output` in the body, so the window can show the check line.

### backend/app/routers/git.py · WorktreeFileBody

- refers-to: backend/app/routers/git.py :: WorktreeFileBody
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review LOW: `text` had no length limit, so a very large body was parsed and held before the engine's own 8 MiB refusal. It now has `max_length` of 8 * 1024 * 1024 characters, so the model rejects an oversized body with a 422 first; the byte-length check in `write_worktree_file` still covers multi-byte text. Sign and Push: a refusal because the range holds a commit by someone other than the stored identity or the session's agent identity uses the same `detail` plus `ok`, `check`, `output` body as before.

### backend/app/routers/lsp.py · lsp_ws

- refers-to: backend/app/routers/lsp.py :: lsp_ws
- kind: warning-context
- logged: v0.7.1 · 2026-10-30

review M1: the `serverStarted` send was outside the try/finally, so a client that dropped right after the upgrade left the spawned server running. Everything after spawn is now inside the try, and the finally stops the process (shielded from cancellation). Verified: a reset right after accept leaves no process and `running` stays 0. A server refused by the cap or for being unavailable gets a close code (4409 for the cap) with the reason text. `?trust=1` on the socket lets a workspace-local server run; without it only system servers do.

### backend/app/routers/debug.py · debug_ws, relay

- refers-to: backend/app/routers/debug.py :: debug_ws
- kind: rationale
- logged: v0.7.1 · 2026-10-30

review M3, M4, M6 and LOW: `?trust=1` on the debug socket lets the workspace venv python run (probe, adapter, debuggee); `GET /api/debug/adapters` never runs it. The unavailable answer reuses the resolved result instead of calling `describe` again on the event loop (a 2 s python no longer stalls other requests: worst concurrent poll 0.03 s). The relay uses the `ALLOWED` list, clears the debuggee on exited and terminated, and closes with 4500 after an `adapterError` event if the adapter sends an over-long header line.

### backend/app/routers/media.py · media_raw, media_info

- refers-to: backend/app/routers/media.py :: media_raw, media_info, _file
- kind: warning-context
- logged: v0.8.0 · 2026-10-30

Read-only bytes for the preview tabs. The path goes through `workspace_root.resolve` (no `..`, no absolute path, realpath must stay inside the open workspace, so a symlink out is refused) and only an allowlist of image, video, audio and PDF extensions is served; anything else is 415, so this route cannot be used to read source or secrets. Starlette's FileResponse supplies Range (206, 416), ETag and Last-Modified, which video seeking needs; the route answers GET and HEAD behind LocalGuard like every route. Every response is `nosniff`; all but PDF also carry a sandbox Content-Security-Policy so an svg opened directly in the webview cannot run script (it is only ever used through an img tag). A PDF cannot carry sandbox because the viewer would not load. `Cache-Control: no-cache` makes the browser revalidate, and the window adds `v=mtime` to its URLs.

### backend/app/routers/graph.py · graph

- refers-to: backend/app/routers/graph.py :: graph
- kind: explainer
- logged: v0.8.0 · 2026-10-30

`GET /api/graph?sig=` returns the workspace file graph (nodes as path, size, mtime; edges as index pairs importer to imported) or `{unchanged: true, sig}` when `sig` matches. No open workspace is 409 through `workspace_root.Refused`. The computation and its bounds are described in backend/app/services/HASHOUT_LOG.md under services/graph.py.

### backend/app/routers/workspace.py · browse, get_recent, _state

- refers-to: backend/app/routers/workspace.py :: browse, get_recent, _recent_row, _git_summary, _local_tools, _state
- kind: rationale
- logged: v0.8.0 · 2026-10-30

`GET /api/workspace/browse` lists any absolute directory for the window's own folder and file picker (the browser build has no native dialog). It only scandirs: nothing is opened, read or run, symlinks are followed only to decide folder or file, dot names are left out unless `hidden=true`, files are left out unless `files=true`, and the answer is capped at 5000 entries. It sits beside the workspace routes but does not use the workspace guard on purpose, because choosing a workspace has to reach outside the current one. `get_recent` now adds `branch`, `changed` (tracked files with changes, from one `git status --porcelain -b -uno` with a 2 s limit, four at a time), `formRepo` and `missing` per row, so Home can show branch and status without opening each folder. `_state` carries `localTools`: names of workspace-local language servers and the workspace venv python that exist on disk. It only looks at files; the window asks the person before the engine is told `trust=1`.

### backend/app/routers/mcp.py · mcp_post

- refers-to: backend/app/routers/mcp.py :: mcp_post, mcp_other, _token
- kind: rationale
- logged: v0.10.0 · 2026-10-30

`POST /mcp` (no `/api` prefix, so MCP clients use the plain path; GET and DELETE are 405) is Streamable HTTP with JSON replies, the shape formslot uses. LocalGuard already runs for it. Auth is a second layer: no token is 401, an unknown token 403. A token is the window token or a live session gate token (`mcp_tools.principal`); the token is read from `Authorization: Bearer`, `X-Subform-Session` (what the gate hook sends) or `X-Subform-Window`. It is deliberately not the CORS-origin route that hands out the window token: the stdio launcher has no window origin and must not be able to get one, so an agent only ever holds its own session token. Body is capped at 1 MiB, batches at 20. The `initialize` answer issues an `Mcp-Session-Id` that is never required back.

### backend/app/routers/create.py · router

- refers-to: backend/app/routers/create.py :: router, clone, job, cancel, options, port, app
- kind: rationale
- logged: v0.10.0 · 2026-10-30

Every route of the Create actions sits behind `require_window`, so a local agent or script without the window token cannot clone, scaffold or probe ports; the window gets the token from `POST /api/window-token` like the formslot actions. `POST /api/create/clone` starts a job and returns it, `GET /api/create/jobs/{id}` is the poll, `POST /api/create/jobs/{id}/cancel` stops it. `GET /api/create/options?dest=` gives the kinds, a suggested free port block, whether formslot was found and the identity the first commit will use; `GET /api/create/port?base=&dest=` checks one block; `POST /api/create/app` scaffolds. Failures are `Refused` from the service mapped to HTTP status codes.

### backend/app/routers/workspace.py · _rg_search excludes

- refers-to: backend/app/routers/workspace.py :: _rg_search
- kind: rationale
- logged: v0.10.0 · 2026-10-30

`_rg_search` takes an optional `excludes` tuple of extra `--glob '!x'` patterns. The window's search passes none and behaves as before; the MCP search passes dotenv and metadata patterns (see the services log, M2).

### backend/app/routers/create.py · port

- refers-to: backend/app/routers/create.py :: port
- kind: rationale
- logged: v0.10.0 · 2026-10-30

The port route resolves the destination and checks the block in the threadpool, because both touch the disk and the sibling scan could block (see the services log, M5). The `/create/*` routes still depend on `require_window`, so they are behind the window token like the formslot actions.

### backend/app/routers/formslot.py · add_gate_note, list_gate_notes

- refers-to: backend/app/routers/formslot.py :: add_gate_note, list_gate_notes
- kind: rationale
- logged: v0.11.0 · 2026-10-30

`POST /api/gates/notes` takes the per-session token like `POST /api/gates` (the Bash PostToolUse hook records a file written by Bash that overlaps a slot). `GET /api/gates/notes?session=` has LocalGuard only, like `GET /api/gates`, and returns repository-relative paths, slot ids and the formslot text; nothing owner-only changes state. See the services log, gate_hook.py (Bash tool, PostToolUse).

### backend/app/routers/formslot.py · list_gate_notes

- refers-to: backend/app/routers/formslot.py :: list_gate_notes
- kind: rationale
- logged: v0.11.0 · 2026-10-30

review L7. `GET /api/gates/notes` now needs the window token (`require_window`) and answers `gates.live_notes`, which drops notes whose file is clean or committed. The earlier entry above that says it has LocalGuard only is superseded. Caller change needed outside this scope: `bashNotes` in frontend/src/io/sessions.ts must use the `owner` helper from io/window-token.ts instead of `request`, or the badge text reads as none.

### backend/app/routers/terminal.py · terminal_env, inherited_env

- refers-to: backend/app/routers/terminal.py :: terminal_env, inherited_env, PARENT_DROP, PARENT_KEEP
- kind: rationale
- logged: v0.13.0 · 2026-10-30

A Claude Code session started from a terminal tab inherited the engine's environment, and when the engine itself ran under Claude Code that carried the parent's markers (`CLAUDE_CODE_SESSION_ID`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` and the rest of `CLAUDE_CODE_*`, `CCR_*`, `AI_AGENT`, a few `CLAUDE_*` helpers). The child then reported the parent's session id in hook payloads until `/clear` and said "Transcript saving is off". `inherited_env` drops every key with those prefixes and keeps `CLAUDE_CONFIG_DIR` plus a short list of configuration and provider keys (`CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`, `_VERTEX`, `_FOUNDRY`, the skip-auth switches, git-bash path, client certificate keys, a few size and model settings). `CLAUDE_SESSION_*` is not dropped on purpose: `CLAUDE_SESSION_INGRESS_TOKEN_FILE` is how this machine's Claude Code authenticates, and a session id marker is not named that way. Checked with a real interactive session: the child's environment had no `CLAUDE_CODE_*`, `CLAUDECODE`, `CCR_*` or `AI_AGENT` key, its transcript was written under its own id (602287d0-..., not the parent's 5075d72d-...), and the parent's id appears nowhere in it. Shell tabs get the same environment, so a `claude` started by hand in one is also its own session. A user who needs another inherited key must set it in the terminal.

### backend/app/routers/terminal.py · inherited_env, _parent_marker, PARENT_DROP_EXACT, PARENT_DROP_GLOB, PARENT_DROP_PREFIX, PARENT_KEEP

- refers-to: backend/app/routers/terminal.py :: inherited_env, _parent_marker, PARENT_DROP_PREFIX, PARENT_DROP_EXACT, PARENT_DROP_GLOB, PARENT_KEEP
- kind: rationale
- logged: v0.13.0 · 2026-10-30

The whole `CLAUDE_CODE_` prefix was dropped, which also removed the user's own configuration (telemetry, compaction window, extra body, provider switches, OAuth token). Now only session and IPC markers are dropped: `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CONTAINER_ID`, `CLAUDE_CODE_WORKER_EPOCH`; the prefixes `CCR_`, `AI_AGENT` and the older `CLAUDE_AUTO`, `CLAUDE_AFTER_`, `CLAUDE_EFFORT`, `CLAUDE_PID`, `CLAUDE_PROJECT_`, `CLAUDE_INTERNAL_`, `CLAUDE_ENABLE_`, `CLAUDE_CHROME_`, `CLAUDE_CLIENT_`, `CLAUDE_ADDITIONAL_`; and, for names starting with `CLAUDE`, the patterns `*_SSE_PORT`, `*_SESSION_*`, `*_SESSION`, `*_WEBSOCKET_*`, `*_REMOTE*`, `*_CCR_*`, `*_MESSAGING_*` (the last three cover the remote-control and messaging socket and token markers; the patterns are limited to `CLAUDE*` names so `XDG_SESSION_ID` and `DBUS_SESSION_BUS_ADDRESS` stay). Intentionally forwarded: `CLAUDE_CODE_OAUTH_TOKEN` (the user's own login for the child `claude`, same user and machine as the shell it was typed in), `CLAUDE_CODE_USE_*` and the Bedrock, Vertex and Foundry skip-auth switches, `CLAUDE_CODE_CLIENT_CERT`/`KEY`/`KEY_PASSPHRASE`, `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`, `CLAUDE_CODE_DISABLE_*`, `CLAUDE_CODE_ENABLE_TELEMETRY`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `CLAUDE_CODE_EXTRA_BODY`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_SHELL`, `CLAUDE_CONFIG_DIR`, and `CLAUDE_SESSION_INGRESS_TOKEN_FILE` (listed in `PARENT_KEEP` because `*_SESSION_*` would match it and it is how this machine's Claude Code authenticates). They are forwarded because a user who set them wants the sessions and shells subform starts to behave the same way; the cost is that a secret in those variables reaches the child process and anything the child runs, which is already true of the shell the user would have used. A variable set by the host that is not on the drop list (feature flags such as `CLAUDE_CODE_ARTIFACT_*`, account and organization ids) is forwarded too; the child session id check still holds because the id and entrypoint markers are gone. Checked on this machine's real environment: every session, remote, CCR and messaging marker present is dropped, 68 other `CLAUDE_CODE_*` keys are kept, and a set of sample user variables (telemetry, compaction window, extra body, disable, use-bedrock, OAuth token) survives.

### backend/app/routers/formslot.py · onboard

- refers-to: backend/app/services/formslot.py :: onboard, _connected, _version
- kind: rationale
- logged: v0.14.0 · 2026-10-31

GET /api/formslot/onboard is read-only (LocalGuard only). It reports the binary (the existing resolver), its version (`--version`, cached by path and mtime), the service (existing discovery), the data folder and whether it exists, corpus names, and for the open workspace `indexed` (a corpus path contains it, false while the service is down) and `connected`. Connected is not read from `formslot install --dry-run` alone: v0.13.0 prints "would change" for the hooks of an already connected repository, and exits 1 ("the merge would change the existing value of hooks") when the installed hooks differ from what it would write (a different binary path after setup), so the exit code and the hooks lines mean nothing here. Connected needs the repository's `.claude/settings.json` to hold formslot hooks, `.mcp.json` to list the formslot server, and the dry run not to report the `.mcp.json` as created. The dry run writes nothing.

### backend/app/routers/formslot.py · onboard token and cache

- refers-to: backend/app/routers/formslot.py :: onboard; backend/app/services/formslot.py :: onboard, _onboard
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Review follow-up. The route now needs the window token (require_window; the window calls it through `owner`), because each call can spawn `formslot --version` and `formslot install --dry-run`. The answer is cached for 2 s per (binary, workspace, data folder) behind a lock, so a burst of Home refreshes runs the subprocesses once. 2 s is short enough that the refresh after a launched terminal exits sees the new state.

### backend/app/routers/harness.py · harness export and import

- refers-to: backend/app/routers/harness.py :: export, import_harness, summary
- kind: rationale
- logged: v0.14.0 · 2026-10-30

Ported from substrata `backend/app/routers/harness.py` (MIT, the owner's) with the folder renamed from `.substrata` to `.subform`. Differences: the substrata router read and wrote through its workspace object; this one walks `<workspace>/.subform` with os.walk, skips symlinked files and folders, reads text only (a file over 400,000 bytes or not valid UTF-8 is reported in `skipped`, not sent), and stops at 500 files. Import is an owner-only state change, so it depends on `require_window` (the window token); export and the new `summary` (file counts per group, used by the System dialog) are read only. Every import path must start with `.subform/` and goes through `workspace_root.resolve(write=True)`, so parent references, absolute paths, symlink escapes and the `.git` folder are refused; the whole plan is validated (including a 4,000,000 byte total) before the first file is written, and each file is written through a temp file and `os.replace`. Substrata reloaded its skills after an import; subform has no in-engine skill registry, so the window raises `subform:harness-imported` and the extensions that read `.subform` refresh on it.

### backend/app/routers/runs.py · routes

- refers-to: backend/app/routers/runs.py :: router; backend/app/services/runs/HASHOUT_LOG.md
- kind: explainer
- logged: v0.14.0 · 2026-10-30

Merges substrata's `run.py` and `runs.py` under `/api/runs` and adds `/api/presets/graphs` from `presets.py`. Reads are open to the local window and agents; every change (start, rerun, resume, cancel, delete, approve or deny, preset install) needs the window token, because starting a run spends the user's claude quota and may write files. The reasoning for the engine, the model call and the expression evaluator is in `backend/app/services/runs/HASHOUT_LOG.md`.

### backend/app/routers/harness.py · import preview and group rules

- refers-to: backend/app/routers/harness.py :: _plan, preview, import_harness
- kind: warning-context
- logged: v0.14.0 · 2026-10-30

Review finding: the first import wrote anything under `.subform/`, but other features execute or trust parts of that tree (plugins run code, runs and cogentics hold records the engine trusts as its own). Import is now two steps over one planner `_plan`: `POST /api/harness/preview` returns the manifest (path, group, bytes, action write, overwrite, skip or refuse, reason) and writes nothing; the window shows it in a dialog and only a click on Import sends `POST /api/harness/import`, which recomputes the same plan and writes it, so a stale preview cannot widen what is written. Groups `runs` and `cogentics` are skipped always. Group `plugins` is refused unless the request carries `trust=1`; trust is a window preference (`io/trust.ts`), not engine state, so the window passes it the way the plugins and cogentics routes already take it. Entries outside `.subform/` are listed as skipped. Path confinement, size limits and atomic validation before the first write are unchanged.

- refers-to: backend/app/routers/runs.py :: StartRun, RerunBody, Decision, _begin, decide, approvals
- kind: warning-context
- logged: v0.14.0 · 2026-10-30

Security review changes to `/api/runs`: the start and rerun bodies carry `trusted`, and claude mode or any graph with a tool node answers 403 without it (checked in `_begin`, server side). `GET /api/runs/approvals` lists every pending park (id, run_id, node, tool, arguments, diff); `POST /api/runs/approvals/{run_id}` needs `{approval: <park id>, approved}` and answers 404 for an unknown park; a body without `approval` is a 422, which breaks the older callers in `extensions/approvals` and the recipes bridge until they send the id. `POST /runs/{id}/resume` takes an optional `park`. Graph errors from path checks answer 403. History is read from the data directory, not the workspace; the earlier note about `.subform/runs` is superseded.

### backend/app/routers/terminal.py · create_owned_terminal

- refers-to: backend/app/routers/terminal.py :: TerminalOwned, owned_argv, create_owned_terminal; frontend/src/io/terminals.ts :: createOwnedTerminal
- kind: rationale
- logged: v0.15.0 · 2026-10-30

`POST /api/terminals/owned` starts a terminal for the owner's own commands (the Home formslot card) with no workspace open. It needs the window token (`require_window`), which a page without the token, and so an agent session, does not have. The folder is always the user's home folder (`~`), never a body field, so `confine()` and its workspace rule are untouched for every other route. The body is an argv list, not a typed line: the first element must be an absolute path of an existing executable file (a `.bat` or `.cmd` on Windows is wrapped in `%COMSPEC% /c`), no element may hold a control character or exceed 2048 characters, and at most 16 elements. The program is spawned directly with that argv, so nothing is parsed by a shell and the old timing hack (wait for the socket, then type) is gone. The terminal is an ordinary shell-kind terminal for listing, attaching, resizing and killing, and it ends when the program ends. This is as powerful as the owner already is (the shell terminal runs anything), so the window token is the whole gate.

### backend/app/routers/terminal.py · window token on terminal routes

- refers-to: backend/app/routers/terminal.py :: create_terminal, delete_terminal, terminals_ws; frontend/src/io/terminals.ts :: createTerminal, deleteTerminal, TerminalSocket.connect
- kind: warning-context
- logged: v0.15.0 · 2026-10-30

Review finding: LocalGuard lets a request with no Origin through, so an agent session holding only its gate token could open a shell in the workspace (skipping the Bash gate), attach to and type into the owner's terminals, or delete them. `POST /terminals` and `DELETE /terminals/{id}` now carry `require_window`. The WebSocket honours nothing until its first message is `{t: "auth", token}` with the window token (constant-time compare); a wrong token, or any other message first, closes it with code 4403. The window client sends the auth message on open before it attaches or sets the socket up, and forgets its cached token when a socket closes without ever coming up so a rotated token is refetched. Listing (GET) stays open. The engine's own session launches call `launch()` directly and never use these routes, so interactive and headless agent sessions are unchanged.

### backend/app/routers/presets.py · unified presets and the aliases

- refers-to: backend/app/routers/presets.py :: router; backend/app/routers/graphs.py :: _preset, presets; backend/app/routers/runs.py :: graph_presets, graph_preset, install_preset; backend/app/main.py :: presets_router
- kind: rationale
- logged: v0.16.0 · 2026-10-30

`/api/presets`, `/api/presets/{group}`, `/api/presets/{group}/{name}` and `POST /api/presets/{group}/{name}/install` (window token; `trust` and `replace` query flags) are the one presets service; see `services/presets/HASHOUT_LOG.md`. The router is included before the graphs and runs routers. `/api/graphs/presets` and its install stay in `graphs.py` as aliases whose reads now go through the service (the saved-graph install keeps its response shape for the Studio). The three `/presets/graphs` routes still defined in `runs.py` are now shadowed by the unified router because it is registered first; they are dead code to delete when `runs.py` is next edited (sf-runs3 owned it this turn). The Studio list now reads `/api/presets/graphs` (`frontend/src/io/studio.ts`, one line); its install still posts to the alias.
