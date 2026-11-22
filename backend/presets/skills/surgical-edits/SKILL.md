---
name: surgical-edits
description: Rules for changing existing files with the smallest edit that solves the task. Use whenever editing code or documents in this workspace, fixing a bug, adding a feature to existing files, or tempted to rewrite or reformat a file. Covers reading the region first, verifying with the repository's own checks, putting new capabilities in new files, and fixing forward when a check fails.
---

# surgical-edits

The surgical edit doctrine for agents working in this workspace.

## Rules
- Make the smallest change that fully solves the task; never rewrite files wholesale.
- Read before you write: read the exact region you intend to change.
- After any change, verify with the repo's own scripts (typecheck, build, the checks it already has).
- New capabilities go in new files (plugins, skills, presets), not patched into core.
- If a verification fails, fix forward with another surgical edit; do not revert blindly.
