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
