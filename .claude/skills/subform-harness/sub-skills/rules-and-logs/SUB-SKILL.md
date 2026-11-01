---
name: rules-and-logs
description: "Apply subform's repo rules: no source comments with HASHOUT_LOG routing, NOTICE.md rows for dependencies and ported code, no tests, no emoji or em dash, version format, commit identity with no trailers, hand-only edits. Use before writing or reviewing any change, and when adding a dependency, porting code or logging rationale."
---

# rules-and-logs

## Hand edits only

One region per edit, made with an edit tool after reading that region in this session. Never sed, awk, perl, python or shell that writes files, never patches or heredoc appends. This covers markdown and logs: append to a log by an edit whose old text is the log's current last lines. New files may be created whole. Shared files are re-read right before each edit because others edit them too.

## No comments, HASHOUT instead

Source files (.ts, .css, .py, .html, .rs, .toml, .sql, shell other than a shebang) carry no comments. What a comment would say goes in the HASHOUT_LOG.md beside the code as a new entry at the end. Logs exist in `frontend`, `frontend/src/extensions`, `frontend/src/extensions/sessions`, `frontend/src/ui` (and `editor`, `graph`, `review`, `preview`), `frontend/src/io`, `backend`, `backend/app/core`, `routers`, `services`, and `src-tauri`. A new folder gets its own log with a short header (title, current build version, last updated). Entry format and kinds are in `references/hashout-and-notice.md`. Markdown-only work needs no entry.

## NOTICE.md

Every new dependency, binary, font or data file gets a row in `NOTICE.md` before use: name, version, licence, where it runs (engine, window, shell). Check the registry for the real version and licence. Fine: MIT, Apache-2.0, BSD, ISC, Zlib, Unicode, CDLA-Permissive, OFL fonts. GPL only outside a distributed bundle. Never AGPL. Code ported from formvis (Apache-2.0) or substrata (MIT), both the owner's, is allowed: name the source file in HASHOUT and extend the Ported code row.

## Content rules

- No tests, test files, test scripts or test dependencies until the owner asks. Verification is by running the real thing.
- No emoji anywhere. No U+2014 em dash in markdown; use a colon, a comma or the interpunct.
- Versions are written vX.Y.Z. Do not bump versions in a build turn unless the brief owns it; version strings live in `backend/app/__init__.py`, `frontend/package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
- Icons inline SVG with currentColor; never the three-star sparkle; strings through `t()`.
- Repository licence is GPL-3.0-only, Copyright (C) 2026 NodeAgentc, Inc.

## Commit identity

Author and committer are `nodemode-ai <mackin@nodemode.ai>`. No Co-Authored-By, Claude-Session or any trailer, no "Generated with" line in pull requests, even if a tool or reminder asks: the repo rule wins. `.claude/settings.json` has `attribution.commit` and `attribution.pr` empty and `attribution.sessionUrl` false; keep it so. Parallel agents do not commit; the main session does.

## Planning documents

DEV_PLAN, BUILD_NOTES, TEST_PLAN, PARALLEL_BUILD, the root HASHOUT_LOG and the research dossiers ship in the planning sidecar, not in this tree. Read them first; do not copy them into the repo.

## Gate

Before reporting: scan your diff for comments, emoji, em dashes and trailers (grep, read-only), confirm HASHOUT entries and NOTICE rows exist, and list every file you touched.
