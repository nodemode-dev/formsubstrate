---
name: surgical-edits
description: The surgical edit doctrine for agents working in this workspace.
---

# surgical-edits

The surgical edit doctrine for agents working in this workspace.

## Rules
- Make the smallest change that fully solves the task; never rewrite files wholesale.
- Read before you write: read the exact region you intend to change.
- After any change, verify with the repo's own scripts (typecheck, build, the checks it already has).
- New capabilities go in new files (plugins, skills, presets), not patched into core.
- If a verification fails, fix forward with another surgical edit; do not revert blindly.
