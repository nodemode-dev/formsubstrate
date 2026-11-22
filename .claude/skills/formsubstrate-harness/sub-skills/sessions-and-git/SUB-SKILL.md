---
name: sessions-and-git
description: Work on subform's agent sessions, worktrees, review pane, hunks, snapshots, rewind, commit wrapper and sign-and-push, plus git safety rules for agents in this repo. Use for services/sessions.py, services/gitops.py, routers/git.py, routers/sessions.py, routers/terminal.py, ptyhost and the review UI.
---

# sessions-and-git

## Sessions

- `backend/app/services/sessions.py` keeps a registry (`sessions.json` in the data folder; a corrupt file is set aside, not deleted). States: working, needs-input, done, failed, stopped. Modes: interactive (a Claude Code tab in the terminal dock) and headless (`claude -p --output-format stream-json`, prompt after `--` so a leading dash is safe).
- Creating a session adds a worktree on branch `sf/[session id]` under the data folder's `worktrees` folder, writes the per-session `mcp.json` (formMCP, formslot and subform's own server; the last only when the `subform` launcher sits beside the engine's repository folder, so a packaged app leaves it out and says so in the session notes) and a `settings.json` with attribution off plus the gate hook, then configures worktree identity and the commit-msg hook.
- PTYs live in a separate process (`backend/subform_ptyhost.py`, client `services/ptyhost_client.py`) so killing the engine leaves terminals alive; the window reconnects and replays scrollback by offset. Resume uses `claude --resume [id]` in the recorded worktree.
- Session and terminal environment: `gates.session_env` adds `SUBFORM_ENGINE`, `SUBFORM_SESSION`, `SUBFORM_WORKTREE`, `SUBFORM_REPO`, `SUBFORM_GATE_TOKEN` and `FORMSLOT_BIN`; `terminal_env` in `routers/terminal.py` starts from `inherited_env`, which drops the parent agent harness's session markers (`PARENT_DROP_PREFIX`, `PARENT_DROP_EXACT`, `PARENT_DROP_GLOB`, with `PARENT_KEEP` exceptions) so a nested Claude Code never shares an id with its parent, and sets `TERM`, `COLORTERM` and `SUBFORM_TERMINAL=1`. Add to the drop lists by editing those tuples, deliberately.
- The MCP tool `terminal_tail` reads scrollback through the pty-host's read-only `tail` request (`Host.tail` in `backend/subform_ptyhost.py`): no attach, no ack, a VT screen model (`Screen`, `plain_text`) that applies cursor moves and erases so Claude Code's redraws come out as readable text, a window of the newest 256 KiB (`TAIL_RAW`) of the ring, at most 2000 lines, secrets redacted in `services/mcp_tools.py` (`_redact`, `_scrub_partial`); a session token sees only its own terminals. Never attach the engine connection to read a terminal.
- Window side: `extensions/sessions/`, `io/sessions.ts` (SSE from `GET /api/sessions/events`), `ui/terminal-dock.ts`, `ui/chat-pane.ts`, `ui/new-session.ts`.

## Git and review

- `services/gitops.py` is the only place that runs git. Every call goes through `run` or `must` with a timeout, output clipping and a cleaned environment (GIT_DIR and related variables removed, `LC_ALL=C`, no terminal prompts, no optional locks); mutations hold `lock_for(target)`. Paths pass `clean_path`; branch and remote names pass `BRANCH_RE` and `REMOTE_RE`.
- Diffs use `--diff-algorithm=histogram`. Review hunks carry ids and a staged flag; renamed, deleted, new, untracked and binary files are accepted or rejected whole. A stale file answers "the file changed; reload the review".
- A workspace opened on a subfolder of a repository is refused for git.
- Snapshots are refs under `refs/subform/snapshots/[key]/[n]`, 50 per key, committed with the fixed identity `subform <subform@localhost>`. Rewind is refused while a session is working.
- Commit wrapper: `POST /api/git/commit` runs with the stored identity (`identity.json`: name, email, sign, signing key). Preferences, Git and Identity edits it. The message is cleaned of trailers (`Co-Authored-By`, `Claude-Session`, `Generated with`, `Signed-off-by: Claude`), and a commit the agent makes itself inside its worktree gets the same identity and loses the same lines through the worktree commit-msg hook (`HOOK_SCRIPT`).
- Sign-and-push refuses ranges with merge commits or other authors, restores the branch if its own check fails, and reports `New`, `Unsigned`, `Other identity`, `Trailers` counts. The owner pushes; never push on your own.

## Git safety for agents working on this repo

- Do not commit, checkout, reset, stash, rebase, branch or force anything unless the brief says so; the main session commits as `nodemode-ai <mackin@nodemode.ai>` with no trailers.
- Never `git add -A` over other agents' files; stage named paths only when told to commit.
- Never run `git clean` or `git checkout -- .` in the live tree: other agents have uncommitted work there.
- Never write to `frontend/dist` or `src-tauri/target`.
- Use only the ports and data folders in your brief; kill only pids you recorded.

## Gate

For gitops changes, run against a scratch repo created under your scratch folder, not this repo. Show `git log --format='%an <%ae> | %cn <%ce>'` and a trailer scan when touching the commit path.
