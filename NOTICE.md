# NOTICE · subform

subform is GPL-3.0-only, Copyright (C) 2026 NodeAgentc, Inc. Every dependency, binary, font, model or data file gets a row here before it is used.

## Ported code

| Source | Licence | What came over |
| --- | --- | --- |
| formvis v1.98.4 (`nodemode-ai/formvis`, owner's code) | Apache-2.0 | root scripts and `setup/`, `backend/subform_engine.py` and `backend/app/core/` (config, runtime, local_guard), `backend/app/main.py` (reduced), `frontend/index.html` (critical style, theme boot), `frontend/public/splash.html`, `frontend/src/ui/dom.ts`, `frontend/vite.config.ts`, `src-tauri/src/` (main, reveal, traffic_lights, text_edit, packaged, window_state), `src-tauri` config and entitlements; from v0.2.0 the shell styles (`tokens`, `fonts`, `scrollbars`, `light-mode`, `shell`, `dialogs`) and `frontend/src/ui/` modules (icons, themes, i18n, dialogs, dialog-history, toast, dropdown, number-fields, brand, panels/controls, commands, menu, native-menu, command-palette, caption-buttons, titlebar-tools, tabs, status, jobs-list); from v0.4.0 `ui/home.ts`, `ui/home-files.ts`, `styles/home.css` and the Preferences dialog in `ui/settings.ts`; from v0.5.0 `ui/terminal-dock.ts`, `styles/terminal.css`, `ui/chat-pane.ts` and ideas from the engine's terminal service in `backend/subform_ptyhost.py` and `app/routers/terminal.py` |
| substrata v2.11.1 (owner's code; Copyright (c) 2026 substrata contributors) | MIT | from v0.8.0: the theme tokens and palette of `frontend/src/ui/theme/tokens.css` (violet hollow) as the Substrata theme profile in `frontend/src/ui/themes.ts`, `frontend/src/styles/tokens.css` and the theme boot in `frontend/index.html`, and the right rail and stage split layout of `frontend/src/ui/workbench.ts` as `frontend/src/ui/panels/sash.ts` and `stage-panels.ts`; from v0.4.0: `frontend/src/ui/editor/editor.ts` and `languages.ts` (adapted: graph tab, LSP and breakpoints removed), `frontend/src/extensions/registry.ts`, `extensions/files/index.ts` and `extensions/search/index.ts` (adapted to keyed rows), `backend/app/routers/workspace.py` (adapted) and `backend/app/core/binres.py`; from v0.7.0 `backend/app/core/lsp.py` and `backend/app/routers/lsp.py` (adapted from its LSP relay); from v0.8.0 the graph view's look and controls from `frontend/src/ui/components/graph.ts` (dot grid, node colours by kind, zoom buttons, minimap with viewport box, pan and zoom), reimplemented on a canvas as `frontend/src/ui/graph/` over a file graph computed by the engine, with no code carried over. The MIT permission notice: "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the Software), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTY OF ANY KIND." |

The file-by-file map from formvis and substrata paths to subform paths is kept in the HASHOUT logs of `backend`, `frontend` and `src-tauri` and the logs beside the new code (`frontend/src/ui/editor`, `frontend/src/extensions`, `backend/app/routers`).

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

Frozen with PyInstaller, these are the packages the engine folder carries besides the five direct ones (versions as installed from `requirements.txt` on 2026-10-30):

| Package | Version | Licence |
| --- | --- | --- |
| starlette | 1.10.0 | BSD-3-Clause |
| pydantic, pydantic_core | 2.14.2, 2.50.2 | MIT |
| annotated-types, annotated-doc, typing-inspection | 0.8.0, 0.0.5, 0.4.4 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| anyio, idna | 4.15.1, 3.20 | MIT, BSD-3-Clause |
| click, h11, httpcore | 8.5.0, 0.16.0, 1.0.9 | BSD-3-Clause, MIT, BSD-3-Clause |
| certifi | 2026.10.23 | MPL-2.0 (the CA bundle file is shipped unedited) |
| httptools, uvloop, watchfiles | 0.9.0, 0.23.0, 1.3.0 | MIT |
| websockets, python-dotenv, PyYAML | 17.3, 1.2.4, 6.0.3 | BSD-3-Clause, BSD-3-Clause, MIT |
| SecretStorage (Linux keyring backend), jeepney | 3.5.0, 0.9.0 | BSD-3-Clause, MIT |
| cryptography (via SecretStorage) | 50.0.2 | Apache-2.0 OR BSD-3-Clause |
| cffi, pycparser | 2.1.1, 3.12 | MIT-0, BSD-3-Clause |
| jaraco.classes, jaraco.context, jaraco.functools, more-itertools | 3.4.0, 6.1.2, 4.6.0, 11.2.1 | MIT |

## Freeze tool (Python, build only)

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| pyinstaller | 6.22.3 | GPL-2.0-or-later with the bootloader exception | build tool only: `setup/freeze_backend` freezes the engine into a one-folder app. The exception grants unlimited permission to link or embed the compiled bootloader and related files into other programs and distribute the combination, so the frozen engine in the app may be distributed under this repository's licence; its run-time hooks are Apache-2.0. The tool and its bootloader are not modified |
| pyinstaller-hooks-contrib | 2026.9 | GPL-2.0-or-later (hooks), Apache-2.0 (run-time hooks) | build tool only; pulled by pyinstaller |
| altgraph, packaging, setuptools | 0.17.5, 26.3, 84.2.1 | MIT, Apache-2.0 OR BSD-2-Clause, MIT | build tool only; pulled by pyinstaller |

## Window (TypeScript)

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| @fontsource/inter | 5.3.0 | MIT; font OFL-1.1 | UI font |
| @fontsource/jetbrains-mono | 5.3.0 | MIT; font OFL-1.1 | code font |
| @tauri-apps/api | 2.12.4 | Apache-2.0 OR MIT | desktop bridge |
| @tauri-apps/plugin-dialog | 2.8.4 | MIT OR Apache-2.0 | folder picker in the desktop app |
| @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0, @xterm/addon-webgl 0.19.0 | as listed | MIT | terminal dock |
| @codemirror/state 6.7.6, view 6.43.15, commands 6.11.1, language 6.13.1, search 6.7.2, autocomplete 6.20.4 | as listed | MIT | code editor |
| @codemirror/merge 6.12.3 | 6.12.3 | MIT | side-by-side and unified diff views (v0.6.0) |
| @codemirror/lsp-client 6.3.0, @codemirror/lint 6.9.7 | as listed | MIT | language server client (hover, diagnostics, definitions, references, rename) and the lint gutter (v0.7.0); pulls vscode-languageserver-protocol and marked, both MIT |
| @codemirror/lang-css 6.3.1, lang-html 6.4.12, lang-javascript 6.2.5, lang-json 6.0.2, lang-markdown 6.5.2, lang-python 6.2.1, lang-rust 6.0.2, lang-yaml 6.1.3, language-data 6.5.2 | as listed | MIT | editor languages (language-data loads the other @codemirror/lang-* and legacy-modes packages on demand, all MIT) |
| @lezer/highlight 1.2.5 and the @lezer parsers they pull in; crelt, style-mod, w3c-keyname, @marijn/find-cluster-break | as locked | MIT | editor internals (transitive) |
| marked | 15.0.12 | MIT | Markdown to HTML for the Markdown preview (already present through @codemirror/lsp-client; now a direct dependency); its output passes through the window's own allowlist sanitizer, and the preview pipeline is adapted from substrata's markdown-preview extension (MIT) |
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
| tauri-plugin-notification | 2.8.0 | Apache-2.0 OR MIT |
| notify-rust (via tauri-plugin-notification) | 4.18.2 | MIT OR Apache-2.0 |
| regex | 1.13.1 | MIT OR Apache-2.0 |
| getrandom | 0.3.4 | MIT OR Apache-2.0 |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.154 | MIT OR Apache-2.0 |
| objc2 (macOS) | 0.6.5 | MIT |
| objc2-app-kit (macOS) | 0.3.2 | Zlib OR Apache-2.0 OR MIT |

## Found on the system, never bundled

git (GPL-2.0), the `claude` command, Node.js and Python for development. ripgrep (`rg`, MIT OR Unlicense) when present, run as a separate program for workspace search; a Python search is used without it. From v0.7.0: formslot (GPL-3.0-only, the owner's), run as a separate program and reached over its 127.0.0.1 service; debugpy (MIT) in the workspace's Python or on PATH, started as `python -m debugpy.adapter` and never imported by the engine; language servers (the TypeScript 7 `tsc --lsp`, typescript-language-server, pyright-langserver, pylsp, each under its own licence) found in the workspace's `node_modules/.bin`, `.venv` or `venv`, or on PATH, and run as separate programs.

## Art

`assets/subform_icon.svg` and the icons generated from it are original to this repository (a placeholder until the owner supplies the final mark).
