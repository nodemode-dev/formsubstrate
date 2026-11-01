<h1 align="center">{{name}}</h1>

<p align="center"><b>{{purpose}}</b></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.1.0-f97316" alt="version v0.1.0" />
  <img src="https://img.shields.io/badge/status-building-8b5cf6" alt="status building" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-555555" alt="license GPL 3.0" />
</p>

{{name}} is a Form family app: {{stack}}. This repository was scaffolded by subform on {{date}}.

## Quick start

{{quickstart}}

| Port | Use |
| --- | --- |
| {{port_frontend}} | window dev server (localhost only) |
| {{port_preview}} | preview |
| {{port_engine}} | engine in development |

The block {{port_base}} to {{port_end}} belongs to {{name}}. Keep every port of this app inside it.

## Desktop shell

The Tauri 2 shell lives in `src-tauri` with its own Cargo workspace (Tauri needs the system webview libraries: WebKitGTK 4.1 on Linux). Run it from there:

```bash
cd src-tauri
cargo run
```

Rust kind: the shell opens `frontend/index.html` and titles the window with the output of `{{name}}-cli version`; run `cargo build --release` at the root first so the cli exists. Python kind: the shell starts the FastAPI engine on 127.0.0.1:{{port_engine}} from `backend/` (using `backend/venv` when present, run `./{{name}}` once to create it) and shows the engine's window when it answers; it stops the engine when the window closes. The window's content policy is the `csp` in `src-tauri/tauri.conf.json`. Icons are in `src-tauri/icons`: replace `icon.svg` with your own mark and run `npx tauri icon src-tauri/icons/icon.svg -o src-tauri/icons`, then delete the extra sizes it writes.

## Licence

GPL-3.0-only. Copyright (C) 2026 NodeAgentc, Inc. See `LICENSE`. Dependencies and their licences are listed in `NOTICE.md`.
