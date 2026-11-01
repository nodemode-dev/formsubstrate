# NOTICE · subform

subform is GPL-3.0-only, Copyright (C) 2026 NodeAgentc, Inc. Every dependency, binary, font, model or data file gets a row here before it is used.

## Ported code

| Source | Licence | What came over |
| --- | --- | --- |
| formvis (the release current at porting time; `nodemode-ai/formvis`, owner's code) | Apache-2.0 | root scripts and `setup/`, `backend/subform_engine.py` and `backend/app/core/` (config, runtime, local_guard), `backend/app/main.py` (reduced), `frontend/index.html` (critical style, theme boot), `frontend/public/splash.html`, `frontend/src/ui/dom.ts`, `frontend/vite.config.ts`, `src-tauri/src/` (main, reveal, traffic_lights, text_edit, packaged, window_state), `src-tauri` config and entitlements; from v0.2.0 the shell styles (`tokens`, `fonts`, `scrollbars`, `light-mode`, `shell`, `dialogs`) and `frontend/src/ui/` modules (icons, themes, i18n, dialogs, dialog-history, toast, dropdown, number-fields, brand, panels/controls, commands, menu, native-menu, command-palette, caption-buttons, titlebar-tools, tabs, status, jobs-list); from v0.4.0 `ui/home.ts`, `ui/home-files.ts`, `styles/home.css` and the Preferences dialog in `ui/settings.ts`; from v0.5.0 `ui/terminal-dock.ts`, `styles/terminal.css`, `ui/chat-pane.ts` and ideas from the engine's terminal service in `backend/subform_ptyhost.py` and `app/routers/terminal.py` |
| substrata v2.11.1 (owner's code; Copyright (c) 2026 substrata contributors) | MIT | from v0.8.0: the theme tokens and palette of `frontend/src/ui/theme/tokens.css` (violet hollow) as the Substrata theme profile in `frontend/src/ui/themes.ts`, `frontend/src/styles/tokens.css` and the theme boot in `frontend/index.html`, and the right rail and stage split layout of `frontend/src/ui/workbench.ts` as `frontend/src/ui/panels/sash.ts` and `stage-panels.ts`; from v0.4.0: `frontend/src/ui/editor/editor.ts` and `languages.ts` (adapted: graph tab, LSP and breakpoints removed), `frontend/src/extensions/registry.ts`, `extensions/files/index.ts` and `extensions/search/index.ts` (adapted to keyed rows), `backend/app/routers/workspace.py` (adapted) and `backend/app/core/binres.py`; from v0.7.0 `backend/app/core/lsp.py` and `backend/app/routers/lsp.py` (adapted from its LSP relay); from v0.8.0 the graph view's look and controls from `frontend/src/ui/components/graph.ts` (dot grid, node colours by kind, zoom buttons, minimap with viewport box, pan and zoom), reimplemented on a canvas as `frontend/src/ui/graph/` over a file graph computed by the engine, with no code carried over; from v0.14.0 the Studio port (adapted): `frontend/src/engine/*` (as `frontend/src/engine/*`), `frontend/src/ui/components/graph.ts` as `frontend/src/ui/studio/canvas.ts`, `frontend/src/extensions/inspector/index.ts` (the node forms) as `frontend/src/ui/studio/inspector.ts`, `frontend/src/extensions/palette/index.ts` and `extensions/graphs/index.ts` as the palette in `studio-view.ts` and `frontend/src/extensions/studio/index.ts`, `backend/app/models/graph.py` as `backend/app/models/graph.py` and `backend/app/routers/presets.py` (graph presets) with `backend/presets/graphs/*.json` as `backend/app/routers/graphs.py` and `backend/app/templates/graphs/*.json`; from v0.14.0 the library port (adapted): `backend/app/routers/collections.py`, `tools.py`, `plugins.py`, `mcp_servers.py` and `backend/app/core/collections, scoring, plugins, mcp_client, substrate (Tool and ToolRegistry), meta_tools` as `backend/app/services/library/*`, and `frontend/src/extensions/manager, tools, plugins, blocks, collections, activity` rewritten as `frontend/src/extensions/*` with the same names; from v0.14.0 `backend/app/routers/harness.py` (adapted from its harness router), `frontend/src/extensions/system/index.ts` (adapted from its system extension), `frontend/src/extensions/welcome/index.ts` (the first-run idea, rewritten as a readiness check) and `backend/skills/subform-graphs/SKILL.md` (its substrata-graphs skill, renamed); from v0.14.0 the run engine in `backend/app/services/runs/*` and `backend/app/routers/runs.py` (adapted from its core/runner*.py, core/agent.py, routers/run.py, routers/runs.py and routers/presets.py; the model call now goes through the user's `claude` program), `backend/presets/graphs/*.json` (copied), and `frontend/src/extensions/runs/index.ts`, `frontend/src/ui/inspector/*` and `frontend/src/io/runs.ts` (rewritten from its runner, runs and inspector extensions); from v0.14.0 the cogentics and insight port (adapted): `backend/app/core/cogentics*.py`, `agent.py` (the loop only), `llm.py`, `model_catalog.py`, `usage.py`, `checkpoints.py` and `routers/cogentics.py`, `insight.py` as `backend/app/services/cogentics/*` and `backend/app/routers/cogentics.py`, `insight.py`, with `frontend/src/extensions/cogentics/*` rewritten from its cogentics extension and `frontend/src/extensions/console/*` rewritten from its console extension as a terminal dock tab; from v0.14.0 the recipes, triggers and approvals features: `backend/app/core/recipes.py` and `routers/recipes.py` as `backend/app/services/recipes/` and `routers/recipes.py`, the five recipe presets of `backend/presets/recipes` as `backend/app/services/recipes/presets/`, `backend/app/core/triggers.py` and `routers/trigger_routes.py` as `backend/app/services/triggers/` and `routers/triggers.py`, and the recipes, automation, triggers and approvals extensions of `frontend/src/extensions` as the folders of the same names; from v0.16.0, `backend/app/routers/presets.py` (plugin catalog and skill presets) as `backend/app/routers/presets.py` and `backend/app/services/presets/`, and `backend/plugin_catalog/{http_connector,web_search}.py` and `backend/presets/skills/*` as `backend/presets/plugins/` and `backend/presets/skills/`. The MIT permission notice: "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the Software), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTY OF ANY KIND." |

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

Frozen with PyInstaller, these are the packages the engine folder carries besides the six direct ones above (requirements.txt has seven lines; on any one platform ptyprocess or pywinpty applies, not both) (versions as installed from `requirements.txt` on 2026-10-30):

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

The frozen engine folder also carries the interpreter and native code that PyInstaller collects. Checked on 2026-10-30 by freezing the engine with `setup/freeze_backend` into a scratch folder on Linux x86_64 and listing every shared object with `ldd`:

| Component | Version | Licence | Where it is in the freeze |
| --- | --- | --- | --- |
| CPython interpreter and standard library (`libpython3.13.so.1.0`, `base_library.zip`, `python3.13/lib-dynload`) | 3.13.18 | PSF-2.0 | `_internal/` |
| OpenSSL | 3.5.9 in the interpreter; a second copy of the 4.0.x line statically inside the `cryptography` Rust module (`_rust.abi3.so`) | Apache-2.0 | built into `libpython3.13.so.1.0` on this Linux interpreter (`_ssl` and `_hashlib` are builtin modules) and inside `cryptography/hazmat/bindings/_rust.abi3.so` |
| libffi | as built into the interpreter and `_cffi_backend` | MIT | statically linked (`_ctypes` is builtin; `_cffi_backend.cpython-313-x86_64-linux-gnu.so` has no libffi dependency) |
| SQLite | as built into the interpreter | public domain | builtin `_sqlite3` of the interpreter (imported only if the engine uses it; the engine does not) |
| zlib | system `libz.so.1` | Zlib | `lib-dynload/zlib.cpython-313-x86_64-linux-gnu.so` links the system copy, which PyInstaller does not collect on Linux; on macOS and Windows the interpreter's own copy is collected |
| bzip2, xz (liblzma), expat | as built into the interpreter | bzip2-1.0.6, 0BSD and public domain (xz), MIT (expat) | builtin `_bz2`, `_lzma`, `pyexpat` modules of the interpreter; not collected as separate files in this freeze because the engine does not import them |
| libgcc_s | 1.0 | GPL-3.0-or-later WITH GCC-exception-3.1 (the runtime library exception permits distribution with non-GPL-compatible and any other programs) | `_internal/libgcc_s.so.1`, collected on Linux |
| uvloop, httptools, watchfiles, pydantic_core, websockets speedups, PyYAML `_yaml`, cffi | as in the table above | MIT, Apache-2.0 | native extension modules (`.so`), listed in the rows above |

On macOS and Windows the interpreter is a python.org or Homebrew build, so OpenSSL, SQLite, libffi, bzip2 and xz may be separate shared libraries beside the executable; they carry the same licences as above and are re-listed here when the first Mac and Windows freezes are made.

## Freeze tool (Python, build only)

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| pyinstaller | 6.22.3 | GPL-2.0-or-later with the bootloader exception | build tool only: `setup/freeze_backend` freezes the engine into a one-folder app. The exception grants unlimited permission to link or embed the compiled bootloader and related files into other programs and distribute the combination, so the frozen engine in the app may be distributed under this repository's licence; its run-time hooks are Apache-2.0. The tool and its bootloader are not modified |
| pyinstaller-hooks-contrib | 2026.9 | GPL-2.0-or-later (hooks), Apache-2.0 (run-time hooks) | build tool only; pulled by pyinstaller |
| altgraph, packaging, setuptools | 0.17.5, 26.3, 84.2.1 | MIT, Apache-2.0 OR BSD-2-Clause, MIT | build tool only; pulled by pyinstaller |

## Window (TypeScript)

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| @fontsource/inter | 5.3.0 | OFL-1.1 | UI font; the OFL text and both copyright lines ship in the built window as `licenses/fonts-OFL-1.1.txt` |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 | code font; same file |
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

The npm packages not named above are all transitive (checked against `frontend/package-lock.json` on 2026-10-31). Those that end up in the built window are all MIT: the remaining `@codemirror/lang-*` packages, `@codemirror/legacy-modes` and `@codemirror/streamparser` that language-data loads, the `@lezer/*` parsers, crelt, style-mod, w3c-keyname, `@marijn/find-cluster-break`, and vscode-jsonrpc 10.0.0, vscode-languageserver-types 3.18.5 and vscode-languageserver-protocol 3.18.5 pulled by `@codemirror/lsp-client`.

The build-time transitive packages (Vite 8, TypeScript 7 and the Tauri CLI, none shipped in the app) are:

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| rolldown, and its `@rolldown/binding-*` platform packages | 1.2.16 | MIT | Vite's bundler; build tool only |
| `@rolldown/pluginutils`, `@oxc-project/types` | 1.0.1, 0.156.0 | MIT | build tool only |
| lightningcss, and its platform packages | 1.33.0 | MPL-2.0 | CSS transform inside Vite; build tool only, used as published on npm and not modified, not part of the built window or the app |
| postcss, nanoid, picocolors, source-map-js | 8.5.32, 3.3.20, 1.1.1, 1.2.2 | MIT, MIT, ISC, BSD-3-Clause | build tool only |
| picomatch, fdir, tinyglobby, detect-libc, fsevents (macOS) | 4.0.7, 6.5.0, 0.2.17, 2.1.2, 2.3.3 | MIT, MIT, MIT, Apache-2.0, MIT | build tool only |
| `@typescript/typescript-*` platform packages | 7.0.2 | Apache-2.0 | the native TypeScript 7 compiler; build tool only |
| `@tauri-apps/cli-*` platform packages | 2.12.4 | Apache-2.0 OR MIT | build tool only |

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
| tao, dpi (via tauri-runtime-wry) | 0.37.2, 0.1.2 | Apache-2.0, Apache-2.0 AND MIT |
| dbus, libdbus-sys (via tao, Linux) | 0.9.12, 0.2.7 | Apache-2.0/MIT |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.154 | MIT OR Apache-2.0 |
| objc2 (macOS) | 0.6.5 | MIT |
| objc2-app-kit (macOS) | 0.3.2 | Zlib OR Apache-2.0 OR MIT |

### Transitive crates of the desktop shell

`cargo metadata --format-version 1` in `src-tauri` (2026-10-31) lists 476 packages in the lock graph, counting every target (Linux, macOS, Windows). Most are MIT, Apache-2.0 or MIT OR Apache-2.0 (including the Apache-2.0 WITH LLVM-exception forms of rustix, linux-raw-sys, wasi and target-lexicon). These licence classes are present beyond those:

| Licence | Crates | Handling |
| --- | --- | --- |
| MPL-2.0 | cssparser, cssparser-macros, selectors, dtoa-short, option-ext | file-level copyleft; the source is used unedited, as published on crates.io, and is not modified |
| Unicode-3.0 | icu_collections, icu_locale_core, icu_normalizer, icu_normalizer_data, icu_properties, icu_properties_data, icu_provider, litemap, potential_utf, tinystr, writeable, yoke, yoke-derive, zerofrom, zerofrom-derive, zerotrie, zerovec, zerovec-derive; and unicode-ident as (MIT OR Apache-2.0) AND Unicode-3.0 | permissive; the Unicode data licence text travels with the crates |
| BSD-3-Clause | alloc-no-stdlib, alloc-stdlib; brotli as BSD-3-Clause AND MIT; brotli-decompressor as BSD-3-Clause/MIT; encoding_rs as (Apache-2.0 OR MIT) AND BSD-3-Clause; num_enum and num_enum_derive as BSD-3-Clause OR MIT OR Apache-2.0 | permissive |
| Unlicense | aho-corasick, byteorder, memchr, jiff, jiff-core, jiff-static, jiff-tzdb, jiff-tzdb-platform and winapi-util as Unlicense OR MIT; same-file and walkdir as Unlicense/MIT | taken under the MIT option |
| 0BSD | adler2 as 0BSD OR MIT OR Apache-2.0 | taken under the MIT option |
| Zlib | foldhash, zlib-rs; miniz_oxide, bytemuck, tinyvec, raw-window-handle, static_vcruntime, dispatch2 and the objc2-* crates as options in an OR expression | permissive |
| ISC | libloading | permissive |
| CC0-1.0 | dunce as CC0-1.0 OR MIT-0 OR Apache-2.0 | taken under the Apache-2.0 option |
| LGPL-2.1-or-later | r-efi as MIT OR Apache-2.0 OR LGPL-2.1-or-later | only an OR option, never taken: r-efi is used under MIT or Apache-2.0 (it is a UEFI target crate and is not in the Linux, macOS or Windows build) |

No crate in the graph is GPL, AGPL or LGPL-only, and none has a non-commercial or no-derivatives term.

## Found on the system, never bundled

The desktop window is drawn by the system webview, which the app uses and does not ship: WebKitGTK and GTK on Linux (LGPL-2.1, dynamically linked and replaceable by the system package; installed with the `.deb` dependencies), and the system libdbus-1 that `libdbus-sys` links dynamically on Linux (AFL-2.1 OR GPL-2.0-or-later, taken under AFL-2.1; not vendored and not shipped), WKWebView on macOS (part of the operating system) and WebView2 on Windows (the Microsoft Edge WebView2 runtime, installed by Windows or the app's installer). Also: git (GPL-2.0), the `claude` command, Node.js and Python for development. ripgrep (`rg`, MIT OR Unlicense) when present, run as a separate program for workspace search; a Python search is used without it. From v0.7.0: formslot (GPL-3.0-only, the owner's), run as a separate program and reached over its 127.0.0.1 service; debugpy (MIT) in the workspace's Python or on PATH, started as `python -m debugpy.adapter` and never imported by the engine; language servers (the TypeScript 7 `tsc --lsp`, typescript-language-server, pyright-langserver, pylsp, each under its own licence) found in the workspace's `node_modules/.bin`, `.venv` or `venv`, or on PATH, and run as separate programs.

## Art

`assets/subform_icon.svg` and the icons generated from it are original to this repository (a placeholder until the owner supplies the final mark).
