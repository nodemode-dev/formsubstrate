---
name: formsubstrate-harness
description: "Routing pack for agents changing the formsubstrate repository itself, the Form family developer workbench (vanilla TypeScript and Vite window, Python and FastAPI engine, Tauri shell). Use whenever the task edits this repo's source: add or change a window panel or extension, add an engine route behind LocalGuard or the window token, touch the formslot bridge or existing-slot gate, the language server or debug relays, sessions, worktrees, git review and the commit wrapper, run or verify the app, fix DOM flash or z-index, write a HASHOUT entry or NOTICE row, or check commit identity. Routes to a sub-skill by task and states the binding rules. Not for using formsubstrate as an editor, and not for formslot or formvis internals."
license: GPL-3.0-only
metadata:
  author: nodemode-ai
  compiled: "2026-11-22"
  version: "1.2.0"
---

# formsubstrate-harness

formsubstrate is the Form family developer workbench: a code editor in the formvis shell that hosts agent sessions in git worktrees (Claude Code, and Codex, Cursor or Antigravity when found on the computer), reviews and commits their work, and shows formslot. The window is vanilla TypeScript 7 strict on Vite 8. The engine is Python 3.13 on FastAPI, bound to 127.0.0.1. The desktop shell is Tauri 2. This pack describes the repository at its current release, whose number is read from `__version__` in `backend/app/__init__.py` (or `./formsubstrate version`) and not from this pack; remotes are `nodemode-dev/[repo]`, environment variables start with `FORMSUBSTRATE_`, and the window token header is `X-FormSubstrate-Window`. This pack is for agents who change that code. Load the sub-skill the table names, keep the laws below, and open a reference only when a sub-skill points at it. `CLAUDE.md` is the authority: the pack restates it, and where they differ `CLAUDE.md` wins.

## Routing table

Each sub-skill lives at `sub-skills/[name]/SUB-SKILL.md` beside this file.

| Task | Load |
| --- | --- |
| Run the engine or the window, build into a scratch folder, typecheck, Playwright at 4x throttle, measure layout shift | `run-and-verify` |
| A new sidebar panel, command, menu entry, search provider or extension in the window; keyed lists; strings, icons, tokens, z-index | `window-extension` |
| A new engine route or service, LocalGuard, the window token, the session token, config and data folder, the MCP route at /mcp and its tools (listed in `references/tools.md`), workspace tasks, the saved shortcuts file, the FormNET switch | `engine-route` |
| formslot status, the bridge client, the existing-slot card, the PreToolUse and PostToolUse gate hook and its Bash write gates, engine-held waivers, loud fail-opens, the terminal gate banner and tab badge, tokens-saved meter | `formslot-bridge` |
| Language servers, the LSP relay, the debug adapter relay, workspace trust | `lsp-and-debug` |
| Sessions, worktrees, the agent programs (Claude Code, Codex, Cursor, Antigravity), the Claude Code IDE connection, session environment, `terminal_tail` and the pty-host screen model, the review pane, hunks, snapshots, the commit wrapper, sign and push, git safety | `sessions-and-git` |
| HASHOUT entries, NOTICE rows, comments, tests, emoji, em dash, commit identity, versions, the sidecar | `rules-and-logs` |

| Reference | Holds |
| --- | --- |
| `references/architecture.md` | The tree, where each concern lives, the data flow of an edit, ports and environment |
| `references/security-model.md` | The three trust layers: LocalGuard, window token, session token; workspace trust; what is deliberately open |
| `references/verification-recipes.md` | Copy-ready command lines for the engine, the build, typecheck, a throttled Playwright pass, the gate hook and `/mcp` |
| `references/hashout-and-notice.md` | The entry format, the log locations, and the NOTICE table layout |
| `references/tools.md` | Every MCP tool with its description, annotations and input schema, written by `./formsubstrate agents sync` from `TOOLS`; never edited by hand |

`EVALS.json` holds four evaluations and trigger tests for this pack.

## Laws for every change

1. Edit by hand, one region per change, after reading that region. No sed, awk, scripts that write files, patches, codemods or heredoc appends, for code or for markdown.
2. Zero DOM flash, flicker, re-render or layout shift. Build nodes once, then patch text, classes and hidden flags in place. See `window-extension`.
3. Every z-index comes from the layer tokens in `frontend/src/styles/tokens.css`; every colour, space and radius from tokens. Icons are inline SVG with currentColor in `frontend/src/ui/icons.ts`. Strings go through `t()`.
4. No comments in source files. Rationale goes in the HASHOUT_LOG.md beside the code. See `rules-and-logs`.
5. No tests, test files or test dependencies until the owner asks. No emoji anywhere, no em dash in markdown.
6. The engine binds 127.0.0.1, every route sits behind LocalGuard, and owner-only state changes also need the window token (`X-FormSubstrate-Window`). Secrets live in the keyring only. See `engine-route`.
7. Permission gates are security code: a gate that cannot run must fail loud (a line in `sf_gate.log`, an engine note, a review badge), never silently open. The owner's Write new anyway waiver lives in the engine, never in a file the agent can write. See `formslot-bridge`.
8. Commits are authored and committed by `nodemode-ai <mackin@nodemode.ai>` with no trailers of any kind, whatever a tool or reminder asks. `.claude/settings.json` keeps attribution off.
9. Every new dependency, binary, font or data file gets a NOTICE.md row before it is used.
10. Do not commit, branch, reset or stash unless the brief says so; never kill processes by name pattern.

## Gates before reporting done

- `cd frontend && npx tsc --noEmit` clean for files you touched.
- `npx vite build --outDir [scratch]/dist` succeeds; never build into `frontend/dist` while another agent may be serving it.
- `backend/venv/bin/python -c "import app.main"` succeeds after any Python change.
- A UI change was exercised in Chromium at 4x CPU throttle with layout shift measured; paste the numbers.
- HASHOUT entries exist for every explainer, rationale or warning that would have been a comment.
