---
name: formslot-bridge
description: "Work on subform's formslot bridge: the discovery-file client, status bar state, slot browser panel, the existing-slot card, the PreToolUse gate hook and its session token, and the tokens-saved meter. Use for files named formslot or gates in the engine, io and extensions."
---

# formslot-bridge

formslot is the Form family slot index. subform finds it on the system and never bundles it; the engine talks to it, the window talks only to the engine.

## Pieces

| Piece | File |
| --- | --- |
| Engine client: binary lookup (`FORMSLOT_BIN`, then `find_bin`), data folder (`FORMSLOT_DATA_DIR`, default `~/.formslot`), `service.json` discovery (pid, port, token, version; ignored when the pid is dead), start, index, install, confirm, drift, MCP passthrough | `backend/app/services/formslot.py` |
| Routes: `GET /api/formslot/status` (open), start, index, install, mcp, confirm, drift (window token), `POST /api/window-token` | `backend/app/routers/formslot.py` |
| Gate store: create, long-poll wait, answer, per-session tokens, settings merge that adds the PreToolUse hook | `backend/app/services/gates.py` |
| Hook script written into the worktree (`sf_gate.py`), maps worktree paths to the repository, runs `formslot check`, long-polls the engine | `backend/app/services/gate_hook.py` |
| Window client and state: `formslot`, `gates`, `formslotState`, `compact`, events `FORMSLOT_OPEN` and `SESSION_SELECTED` | `frontend/src/io/formslot.ts` |
| Panel, gate cards, install offer | `frontend/src/extensions/formslot/index.ts` |
| Status bar slot | `frontend/src/ui/status-formslot.ts` |
| Gate cards in the shell | `frontend/src/ui/gate-cards.ts` |

## Gate flow

1. A session launches with `SUBFORM_ENGINE`, `SUBFORM_SESSION`, `SUBFORM_WORKTREE`, `SUBFORM_REPO`, `SUBFORM_GATE_TOKEN` (minted per session) and `FORMSLOT_BIN` in its environment, and a `--settings` file whose `hooks.PreToolUse` matcher is `Write|Edit|MultiEdit`.
2. The hook asks formslot whether a slot exists for the write. On a hit it posts `POST /api/gates` with header `X-Subform-Session`, then waits on `GET /api/gates/[id]/wait` (up to 120 s).
3. The window shows the card (Use, Adapt, Write new anyway) and answers with `POST /api/gates/[id]/answer`, which needs the window token. The session token cannot answer its own gate.
4. Gates are capped per session and in total; closed ones are kept briefly (`KEEP_SECONDS`).

## Rules

- The window never reaches formslot directly; everything goes through the engine, and every state change from the window uses the owner wrapper with the window token.
- Do not write the session token or the window token into logs, files or error bodies.
- Slot ids are validated by `ID_RE`; bodies are length-capped. Keep both when adding fields.
- If formslot is absent the panel degrades to a status note; never throw at boot.
- The MCP passthrough allows only the names in `MCP_TOOLS`; extend that tuple deliberately.

## Gate

Exercise with a fake formslot or a store copy, never the owner's live store. Check the card appears without layout shift at 4x throttle and that answering unblocks the hook.
