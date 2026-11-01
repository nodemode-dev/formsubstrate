# HASHOUT_LOG · backend/app/templates · subform

Data the engine carries for the New Form app action (services/create.py). Current build version: v0.10.0
Last updated: 2026-10-30

### backend/app/templates · layout

- refers-to: backend/app/services/create.py :: _write_tree, _target_rel, _render
- kind: explainer
- logged: v0.10.0 · 2026-10-30

`common/` is copied first, then the kind folder (`rust/` or `python/`) on top. Placeholders are `{{name}}` style and only known keys are replaced (`name`, `date`, `kind_label`, `purpose`, `stack`, `quickstart`, `notice_rows`, `shell_note`, `port_base`, `port_frontend`, `port_preview`, `port_engine`, `port_end`); any other `{{x}}` stays as written. A path segment `dot_x` becomes `.x` (so `.gitignore` and `.claude` do not act inside this repository), and a file named `__name__` becomes the app name and gets the execute bit (the launcher script). `LICENSE` is copied byte for byte, never rendered; it is a copy of this repository's own LICENSE (GPL-3.0-only text with the NodeAgentc copyright line).

### backend/app/templates · Tauri shell

- refers-to: backend/app/templates/common/src-tauri/Cargo.toml :: workspace
- kind: warning-context
- logged: v0.10.0 · 2026-10-30

The shell is a bare Tauri 2 window over `frontend/`. Its Cargo.toml carries its own empty `[workspace]` and the Rust kind's root workspace excludes it, so `cargo build` at the root never fetches Tauri. No icons are shipped: `cargo tauri build` needs them added first (the new repository's src-tauri HASHOUT says so). This part was not compiled during the F9 check; only `core` and `cli` (Rust kind) and the FastAPI engine (Python kind) were built and run.

### backend/app/templates · formslot slots

- refers-to: backend/app/services/create.py :: create_app
- kind: todo
- logged: v0.10.0 · 2026-10-30

The plan says the template comes from formslot slots once S5 has them. Until then the files here are the template. Moving them to slots changes only `_write_tree`'s source, not the placeholders or the steps after it.

### backend/app/templates/common/CLAUDE.md · Commits wording

- refers-to: backend/app/templates/common/CLAUDE.md :: Commits; backend/app/templates/common/AGENTS.md
- kind: rationale
- logged: v0.10.0 · 2026-10-30

review L8. The new app's rules said every commit is by `nodemode-ai`, but the first commit uses the identity stored in Preferences when there is one and `nodemode-ai` only as the fallback. Both files now say "the owner's identity or nodemode-ai".
