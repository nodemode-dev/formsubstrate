# NOTICE · subform

subform is GPL-3.0-only, Copyright (C) 2026 NodeAgentc, Inc. Every dependency, binary, font, model or data file gets a row here before it is used.

## Ported code

| Source | Licence | What came over |
| --- | --- | --- |
| formvis v1.98.4 (`nodemode-ai/formvis`, owner's code) | Apache-2.0 | root scripts and `setup/`, `backend/subform_engine.py` and `backend/app/core/` (config, runtime, local_guard), `backend/app/main.py` (reduced), `frontend/index.html` (critical style, theme boot), `frontend/public/splash.html`, `frontend/src/ui/dom.ts`, `frontend/vite.config.ts`, `src-tauri/src/` (main, reveal, traffic_lights, text_edit, packaged, window_state), `src-tauri` config and entitlements |

The file-by-file map from formvis paths to subform paths is kept in the HASHOUT logs of `backend`, `frontend` and `src-tauri`. Code ported from substrata v2.11.1 (MIT, "substrata contributors") will be listed here when it lands, with its notice kept.

## Engine (Python, ships in the desktop bundle)

| Package | Version | Licence |
| --- | --- | --- |
| fastapi | 0.141.1 | MIT |
| uvicorn[standard] | 0.53.0 | BSD-3-Clause |
| python-multipart | 0.0.32 | Apache-2.0 |
| httpx | 0.28.1 | BSD-3-Clause |
| keyring | 25.7.0 | MIT |
| ptyprocess (macOS, Linux) | 0.7.0 | ISC |
| pywinpty (Windows) | 3.0.5 | MIT |

Transitive packages of fastapi and uvicorn[standard] (starlette, pydantic, click, h11, httptools, uvloop, watchfiles, websockets, python-dotenv, PyYAML and others) get rows when the engine is first frozen (Phase F9).

## Window (TypeScript)

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| @fontsource/inter | 5.3.0 | MIT; font OFL-1.1 | UI font |
| @fontsource/jetbrains-mono | 5.3.0 | MIT; font OFL-1.1 | code font |
| @tauri-apps/api | 2.11.1 | Apache-2.0 OR MIT | desktop bridge |
| @tauri-apps/cli | 2.12.4 | Apache-2.0 OR MIT | build tool only |
| typescript | 7.0.2 | Apache-2.0 | build tool only |
| vite | 8.3.5 | MIT | build tool only |

## Desktop shell (Rust)

| Crate | Version | Licence |
| --- | --- | --- |
| tauri | 2.12.5 | Apache-2.0 OR MIT |
| tauri-build | 2.7.4 | Apache-2.0 OR MIT |
| tauri-plugin-shell | 2.6.0 | Apache-2.0 OR MIT |
| tauri-plugin-dialog | 2.8.4 | Apache-2.0 OR MIT |
| regex | 1.13.1 | MIT OR Apache-2.0 |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.154 | MIT OR Apache-2.0 |
| objc2 (macOS) | 0.6.5 | MIT |
| objc2-app-kit (macOS) | 0.3.2 | Zlib OR Apache-2.0 OR MIT |

## Found on the system, never bundled

git (GPL-2.0), the `claude` command, Node.js and Python for development.

## Art

`assets/subform_icon.svg` and the icons generated from it are original to this repository (a placeholder until the owner supplies the final mark).
