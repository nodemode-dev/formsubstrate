# HASHOUT_LOG · backend/app/templates · formsubstrate

Data the engine carries for the New Form app action (services/create.py). Current build version: v0.20.0
Last updated: 2026-11-22

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

### backend/app/templates/common/src-tauri · compiled shell

- refers-to: backend/app/templates/common/src-tauri/tauri.conf.json :: app.security.csp
- kind: rationale
- logged: v0.11.0 · 2026-10-30

Supersedes the "not compiled" warning above: both scaffolded shells were built with `cargo build` (Tauri 2, debug) and run under xvfb; a window appeared for each. The CSP is `default-src 'self'` with `connect-src` limited to `ipc:`, `http://ipc.localhost` and the engine port on 127.0.0.1 and localhost, no `unsafe-eval`, and `style-src 'unsafe-inline'` only because the placeholder page has one inline style block. subform's own tauri.conf.json has `csp: null` (its window is a remote origin served by the engine, which Tauri's CSP does not govern), so there was nothing to copy; the Python kind instead sends the same policy as a header from the engine (`app/main.py :: security_headers`). `devUrl` was removed because nothing serves the window dev port and a debug build otherwise tried localhost and showed a connection error.

### backend/app/templates/common/src-tauri/icons · placeholder mark

- refers-to: backend/app/templates/common/src-tauri/icons/icon.svg
- kind: explainer
- logged: v0.11.0 · 2026-10-30

An original letter F (every Form app name starts with `form`) drawn as three rounded bars in the family paint gradient on a dark rounded square, not subform's artwork. The PNG, ICO and ICNS files were produced from `icon.svg` by `npx tauri icon` (tauri-cli from subform's frontend) and only the files the bundle list names plus icon.png are kept. Binary files cannot carry a name initial because they are copied byte for byte: `create.py :: RAW_SUFFIXES` (.png, .ico, .icns) joins `RAW_FILES` so they are never decoded or rendered.

### backend/app/templates/{rust,python}/src-tauri/src/main.rs · minimal shells

- refers-to: backend/app/templates/rust/src-tauri/src/main.rs :: cli_banner; backend/app/templates/python/src-tauri/src/main.rs :: spawn_engine
- kind: explainer
- logged: v0.11.0 · 2026-10-30

`main.rs` moved from `common/` into each kind folder. Rust kind: runs the built `{{name}}-cli version` from `../target` and uses its output as the window title; the window shows `frontend/`. Python kind: spawns `backend/venv` python (else python3) with uvicorn on the engine port using std::process only (no shell plugin, so no extra permissions), polls the port, navigates the window to the engine and kills the child on exit. Subform's token handshake, port 0 discovery, splash and packaged engine are deliberately left out; the engine is not yet LocalGuard-protected in the Python template. Dev paths come from `CARGO_MANIFEST_DIR`, so the shell runs from the scaffolded tree only.

### backend/app/templates/python · main.py LocalGuard, src-tauri/src/main.rs spawn_engine

- refers-to: backend/app/templates/python/backend/app/main.py :: LocalGuard; backend/app/templates/python/src-tauri/src/main.rs :: spawn_engine
- kind: rationale
- logged: v0.11.0 · 2026-10-30

review L6. The Python template's engine now has a small LocalGuard-style ASGI middleware outside CORS: the Host header must be a loopback name (127.0.0.1, localhost, ::1) with one of the three ports of the app's block, and an Origin header, when present, must be one of the app's own window origins; a request without Origin is refused when the browser marks it cross-site. A rebinding page (Host evil.com) and a foreign Origin answer 403; checked on a rendered copy: Host 127.0.0.1:6611 and localhost:6611 200, evil.com:6611 and 127.0.0.1:9999 403, Origin http://evil.com 403, own origin 200. The shell no longer falls back to a system `python3`: without `backend/venv` it fails setup with a message naming the missing environment, so a foreign interpreter is never run with the app's engine module. The earlier sentence above about the template engine not being LocalGuard-protected is superseded; there is still no window token handshake in this template.
