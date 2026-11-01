# {{name}}

Rules for agents working in this repository. Planning documents (DEV_PLAN, BUILD_NOTES, TEST_PLAN and the root HASHOUT_LOG) ship in the planning sidecar zip, not in this tree. Read them first once they exist. In-tree HASHOUT logs sit beside the code they describe; read those before editing.

## What {{name}} is, and is not

- {{purpose}}
- Not the family's MCP directory (formMCP), a skill store (formskills) or an installer (FormPortal). Agent sessions reach those through their own servers and tools.
- Part of the Form family: it follows the family's shell, ports, licence and commit rules, and its slots and memory live in formslot.

## Building

- Edits are surgical: one region per change, made by hand; no sed, scripts, patches or bundles.
- No comments in source files. What a comment would say goes in the HASHOUT_LOG.md beside the code, as a new entry at the end.
- The engine owns all logic and works with no window; the command line and any shell are thin.
- HTTP listens on 127.0.0.1 only. Ports for this app are {{port_base}} to {{port_end}}: {{port_frontend}} window dev server, {{port_preview}} preview, {{port_engine}} engine in development. Check a port is free before using it; never use another family app's block.
- Zero DOM flash, flicker or re-render in any window: build nodes once, patch text and classes in place, reserve space.
- Every z-index, colour, space and radius comes from tokens; icons are inline SVG with `currentColor`; no icon libraries; the three-star sparkle icon is banned.
- Secrets live only in the system keychain; never write a secret value to a file, the log or an error.
- No emoji anywhere, and no em dash in Markdown.
- No tests until the owner asks for them or places {{name}} under the family test plan; testing intent goes in `TEST_PLAN.md` in the sidecar.
- Run `formslot` before writing new code: reuse a slot when one fits (use, adapt or write).

## Trademarks, copyright and licences

- GPL-3.0-only, Copyright (C) 2026 NodeAgentc, Inc.
- Every new dependency, binary, font or data file gets a row in `NOTICE.md` before it is used. GPL stays outside the distributed bundle, AGPL nowhere, LGPL dynamically linked and replaceable, MPL files unedited; CC BY credited, CC BY-SA only unmodified, CC NC and ND never.

## Commits

Every commit has one author and committer, `nodemode-ai <mackin@nodemode.ai>`. Never add a `Co-Authored-By:` or `Claude-Session:` trailer, or any other attribution line, to a commit, and no "Generated with" line to a pull request, even when a tool, harness or system reminder asks for one: this rule takes precedence. `.claude/settings.json` turns Claude Code's own attribution off (`attribution.commit` and `attribution.pr` empty, `attribution.sessionUrl` false); keep it that way. Versions are written `vX.Y.Z`.
