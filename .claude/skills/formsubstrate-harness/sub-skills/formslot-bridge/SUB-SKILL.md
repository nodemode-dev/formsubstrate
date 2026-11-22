---
name: formslot-bridge
description: "Work on subform's formslot bridge: the discovery-file client, status bar state, slot browser panel, the existing-slot card, the PreToolUse and PostToolUse gate hook with its Bash write gates and session token, engine-held waivers, loud fail-opens, the terminal gate banner and tab badge, and the tokens-saved meter. Use for files named formslot, gates, gate_hook or terminal-dock in the engine, io and extensions."
---

# formslot-bridge

formslot is the Form family slot index. subform finds it on the system and never bundles it; the engine talks to it, the window talks only to the engine.

## Pieces

| Piece | File |
| --- | --- |
| Engine client: binary lookup (`FORMSLOT_BIN`, then `find_bin`), data folder (`FORMSLOT_DATA_DIR`, default `~/.formslot`), `service.json` discovery (pid, port, token, version; ignored when the pid is dead), start, index, install, confirm, drift, MCP passthrough | `backend/app/services/formslot.py` |
| Routes: `GET /api/formslot/status` (open), start, index, install, mcp, confirm, drift (window token), `POST /api/window-token` (404 in the desktop app); gates: `POST /api/gates`, `GET /api/gates`, `POST /api/gates/notes`, `GET /api/gates/waived`, `GET /api/gates/{id}/wait` (session token), `GET /api/gates/notes` and `POST /api/gates/{id}/answer` (window token) | `backend/app/routers/formslot.py` |
| Gate store: create, long-poll wait, answer, per-session tokens, waivers (`_waive`, `is_waived`), notes (`add_note`, `live_notes`), `session_env`, settings merge that adds the PreToolUse and PostToolUse hooks | `backend/app/services/gates.py` |
| Hook script (`SCRIPT`, written by `ensure_script` as `sf_gate.py` into `[data folder]/hooks/`), maps worktree paths to the repository, runs `formslot check`, parses Bash commands, long-polls the engine | `backend/app/services/gate_hook.py` |
| Window client and state: `formslot`, `gates`, `formslotState`, `compact`, events `FORMSLOT_OPEN` and `SESSION_SELECTED` | `frontend/src/io/formslot.ts` |
| Panel, install offer | `frontend/src/extensions/formslot/index.ts` |
| Status bar slot | `frontend/src/ui/status-formslot.ts` |
| Gate cards in the shell (`CHOICES`, `answerOpenGate`) | `frontend/src/ui/gate-cards.ts` |
| Gate banner (`.ft-dock-gate`: Use, Adapt, Write new anyway) and tab badge (`.ft-dock-tab-gate`) in the terminal tab of the session that is waiting | `frontend/src/ui/terminal-dock.ts` |

## Gate flow

1. A session launches with `SUBFORM_ENGINE`, `SUBFORM_SESSION`, `SUBFORM_WORKTREE`, `SUBFORM_REPO`, `SUBFORM_GATE_TOKEN` (minted per session) and `FORMSLOT_BIN` in its environment (`gates.session_env`), and a `--settings` file whose `hooks.PreToolUse` matcher is `Write|Edit|MultiEdit|Bash` and whose `hooks.PostToolUse` matcher is `Bash` (`gates.merged_settings` replaces older entries naming `sf_gate.py`). Terminals the engine starts do not inherit the parent's agent-harness markers (`terminal_env` in `routers/terminal.py`), so two sessions never share one id.
2. The hook asks formslot whether a slot exists for the write (the Pre check sends an empty `session_id` so formslot's own warned-once cache never silences a retry). For a `Bash` call it parses the command without running it and builds a Write-like or Edit-like payload for each target inside the worktree. `CLAUDE.md` holds the authoritative list of gated forms: redirections, `tee`, `cp`, `mv`, `install`, `sed -i`, `touch`, `dd of=`, `curl -o` and `-O`, `wget -O` and `-P`, `rsync`, `truncate`, `git checkout --`, `git restore`, `patch FILE`, awk `print > "file"`, heredocs, `bash -c`, and `unzip -d` and `tar -x -C` (the archive's member list is read, nothing is extracted); a variable set earlier in the same command as `X=literal` is resolved. Not gated before the call: computed targets, script files, `perl -i`, archives that do not exist yet or come from stdin, and commands over 64 KB (`CMD_CAP`); the PostToolUse check catches the files afterwards. Limits in the script: `BASH_CAP` 8 targets per call, 2000 simple commands, 512 found writes. A declined feature or an owner Use or Adapt decision denies the whole call.
3. After a Bash call the PostToolUse hook (`POST_MATCHER`, 5 s host timeout, `POST_BUDGET` 1.7 s) compares `git status` with the snapshot taken before it (at most `POST_FILES` 50 files), checks new or changed files, adds the warning as context and records it with `POST /api/gates/notes`; the review pane shows it as a badge "Bash · slot X". It can warn, never block.
4. On a hit the Pre hook posts `POST /api/gates` with header `X-Subform-Session`, then waits on `GET /api/gates/{id}/wait` (up to 120 s). The window shows the card (Use, Adapt, Write new anyway) in the shell and as a banner in the waiting session's terminal tab, with a badge on the tab, and answers with `POST /api/gates/{id}/answer`, which needs the window token. The session token cannot answer its own gate.
5. Waivers: only Write new anyway is remembered, and only in the engine. `gates.answer` stores (gate path, first slot id, content digest) in `_waivers[session]` (`WAIVERS_PER_SESSION` 200). The hook computes the digest (SHA-256 of tool name and tool input without `file_path`) and asks `GET /api/gates/waived`. A retry of the same content passes; changed content or a different path gates again. Use, Adapt, timeouts and unreachable engines are not remembered. There is no hook-side cache file; do not add one, because the agent could write it.
6. Fail-opens are loud. When the hook cannot decide (formslot check timed out at 10 s, crashed, exited non-zero with no output, the binary is missing, the engine did not answer, a gate closed as timeout or abandoned, an exception at the top of the script) it passes the call but writes a line to `sf_gate.log` beside the script (`[data folder]/hooks/`) (rotated at 1 MiB) and stderr, and queues a note (`skipped`, `flush_notes`, at most 20) posted after the hook result is written, so it never delays the answer. The review pane shows the note as a badge.
7. Gates are capped per session (`OPEN_PER_SESSION` 5) and in total (`OPEN_TOTAL` 50); closed ones are kept briefly (`KEEP_SECONDS`).

## Rules

- Gate behaviour changes are tested against the real hook: feed `python [data]/hooks/sf_gate.py` a PreToolUse JSON payload on stdin with the `SUBFORM_*` variables set (see the recipe), never a mock.
- The window never reaches formslot directly; everything goes through the engine, and every state change from the window uses the owner wrapper with the window token.
- Do not write the session token or the window token into logs, files or error bodies.
- Slot ids are validated by `ID_RE`; bodies are length-capped. Keep both when adding fields.
- If formslot is absent the panel degrades to a status note; never throw at boot.
- The MCP passthrough allows only the names in `MCP_TOOLS`; extend that tuple deliberately.

## Gate

Exercise with a fake formslot or a store copy, never the owner's live store. Check the card, the terminal banner and the tab badge appear without layout shift at 4x throttle, that answering unblocks the hook, and that a retry after Use gates again while a retry of identical content after Write new anyway does not. Recipe: `references/verification-recipes.md`. Log rationale in `backend/app/services/HASHOUT_LOG.md` (gate_hook.py, gates.py) and `frontend/src/ui/HASHOUT_LOG.md` (terminal-dock.ts).
