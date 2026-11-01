# HASHOUT_LOG · backend · subform

Current build version: v0.4.0
Last updated: 2026-10-30 · Phases F3 and F4 (workspace and secrets routes registered in main.py; their log is app/routers/HASHOUT_LOG.md)

## Org-navi-map

```
backend/
  subform_engine.py      engine entry: switches, data folder claim, uvicorn on 127.0.0.1, selfcheck, port file
  boot_backend, .bat           dev server: uvicorn with reload on 5655, inside backend/venv
  oc_install, .bat             creates backend/venv and installs requirements (Python 3.13+)
  app/routers/workspace.py     workspace, files and search routes (own log: app/routers/HASHOUT_LOG.md)
  app/routers/secrets.py       secret names and presence, values in the system keyring (same log)
  app/core/workspace_root.py   current root, recent list, path confinement (same log)
  app/core/binres.py           finds rg and other programs (same log)
  subform_ptyhost.py     detached pty-host that owns every terminal (log: app/services/HASHOUT_LOG.md)
  app/services/                ptyhost_client, sessions registry and worktrees (same log)
  app/routers/terminal.py      terminals and the multiplexed websocket (same log)
  app/routers/sessions.py      agent sessions and their event stream (same log)
  app/routers/skills.py        read-only installed skills (same log)
  requirements.txt             pinned engine packages, each with its licence
  requirements_macos.txt       unpinned list used by oc_install on macOS
  HASHOUT_LOG.md               this log
  app/
    __init__.py                version, and the ctypes.util find_library guard for Linux
    main.py                    FastAPI app: lifespan, CORS, LocalGuard, system router, frontend/dist mount
    core/
      __init__.py              package marker
      config.py                names, ports, data folder choice, dist folder, CORS and window origins
      runtime.py               switches, rotating log file, single-instance lock on the data folder
      local_guard.py           loopback-only Host and Origin check for http and websocket
    routers/
      __init__.py              package marker
      system.py                GET /api/system/status
```

## Table of contents

- backend/subform_engine.py
- backend/boot_backend and backend/boot_backend.bat
- backend/oc_install and backend/oc_install.bat
- backend/requirements.txt
- backend/requirements_macos.txt
- backend/app/__init__.py
- backend/app/main.py
- backend/app/core/config.py
- backend/app/core/runtime.py
- backend/app/core/local_guard.py
- backend/app/routers/system.py
- backend/app/services (created in v0.5.0; own log: app/services/HASHOUT_LOG.md)
- Root scripts and setup/ (ported in the same phase)

## backend/subform_engine.py

### backend/subform_engine.py · selfcheck
- refers-to: backend/subform_engine.py :: selfcheck
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Run as `python backend/subform_engine.py selfcheck` (the formvis spelling `--selfcheck` is accepted too, so a freeze script ported later keeps working). It imports the whole app the way the server does, so a module that fails at import fails the build, not the engine on the person's computer. Exit 0 only when no package reports "missing" and the app imports. The formvis check also required a non-empty fal model list; that gate is removed with the fal service.

### backend/subform_engine.py · watch_parent
- refers-to: backend/subform_engine.py :: watch_parent
- kind: rationale
- logged: v0.1.0 · 2026-10-30
- Carried from formvis 1.86.2. A one-file build runs as two processes: the launcher unpacks into a temporary `_MEI` folder and starts this server as its child. When the desktop shell has to force the launcher closed, nothing told the server, which kept its CPU, memory and port, and the folder stayed behind. The thread polls the parent id every 2 seconds and, once it is gone, removes its own `_MEI` folder and exits. Posix only.

### backend/subform_engine.py · sweep_stale_unpacks
- refers-to: backend/subform_engine.py :: sweep_stale_unpacks
- kind: rationale
- logged: v0.1.0 · 2026-10-30
- Carried from formvis 1.86.3. The one-file launcher names its folder `_MEI` + its process id as eight hex digits + six random characters and deletes it on exit; a launcher forced closed never did, and one Mac collected 31 such folders (about 5.3 GB) in a day. A folder whose process is gone belongs to nobody; one whose id is alive is kept (the id may have been reused, so this is conservative), and so is this engine's own. A PermissionError from `os.kill` counts as "not alive" because another user's process now holds the id and this user's launcher is gone. Runs on a background thread so the engine starts at once.

### backend/subform_engine.py · announce_port
- refers-to: backend/subform_engine.py :: announce_port
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Writes `{"pid", "port"}` to `engine.port` in the data folder once the server really listens (the desktop shell asks for port 0). It is removed by `runtime.release` in the app's lifespan shutdown, only when the pid in the file is its own; the `finally` in `main` is a second try. The lifespan is the one that matters: on SIGTERM uvicorn 0.53 finishes shutdown and then re-raises the signal, so the process ends before `main`'s `finally` runs (found in review; the desktop shell stops the engine with SIGTERM). The desktop shell reads the printed uvicorn line "Uvicorn running on http://127.0.0.1:PORT"; the file is for tools that start later. Port comes from SUBFORM_PORT, 0 when unset; the dev scripts set 5655.

### backend/subform_engine.py · main
- refers-to: backend/subform_engine.py :: main
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Order: selfcheck short-circuit, switches to environment, claim the data folder (exit 2 with a message when another live engine holds it, exit 3 if the server never started), parent watch, stale-unpack sweep, bundled `frontend_dist` as SUBFORM_DIST when present, SUBFORM_DESKTOP=1 by default, uvicorn on 127.0.0.1 only. Bound to loopback on purpose; the LocalGuard repeats the check per request.

### backend/subform_engine.py · removed-code
- refers-to: backend/subform_engine.py :: run_mcp
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed `run_mcp`, `setup_path` and `run_agents` (formvis 1.90.9 and DEV_PLAN 28.4): they run `setup/mcp_stdio.py` and `setup/agents.py`, which this repository does not have yet. They return with the MCP server step (Part 3 step 14 of the porting map); `setup_path` was only needed by those two.
- refers-to: backend/subform_engine.py :: selfcheck
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed the PIL, numpy and cv2 import probes and the `fal_models` count from selfcheck: image-engine packages and the fal service are not part of this app.
- refers-to: backend/subform_engine.py :: module docstring
- kind: warning-context
- logged: v0.1.0 · 2026-10-30
- The formvis module docstring explained that OpenCV's OpenEXR codec stays off (opencv/opencv#21326) and contained.py decodes EXR in a child. Dropped with the image stack. Its second paragraph moved to `backend/app/__init__.py` (see that section).

## backend/boot_backend and backend/boot_backend.bat

### backend/boot_backend · uvicorn dev server
- refers-to: backend/boot_backend :: exec uvicorn
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Dev only: `--reload`, host 127.0.0.1 always (formvis's SUBFORM_HOST style override was removed in review: binding any other address would put the unauthenticated engine on the network, and LocalGuard only checks the Host header a LAN client can forge), port SUBFORM_PORT (default 5655). `setup/serve` and its `.bat` twin bind the same way. This path does not take the engine lock, as in formvis; the desktop uses `subform_engine.py`. The formvis `# shellcheck disable=SC1091` line is dropped with all shell comments.
- refers-to: backend/boot_backend.bat :: line endings
- kind: warning-context
- logged: v0.1.0 · 2026-10-30
- The formvis .bat files use CRLF. The files here were written with LF because the build tool writes LF. Windows cmd runs these (no labels, no goto) but a `.gitattributes` rule `*.bat text eol=crlf` would normalise them on checkout.

## backend/oc_install and backend/oc_install.bat

### backend/oc_install · interpreter choice
- refers-to: backend/oc_install :: PY
- kind: rationale
- logged: v0.1.0 · 2026-10-30
- formvis accepted Python 3.12 or newer. subform's engine targets Python 3.13, so the minimum is 3.13 and the candidate list is python3.14, python3.13, python3. The macOS branch installs `requirements_macos.txt`.

## backend/requirements.txt

### backend/requirements.txt · pins and licences
- refers-to: backend/requirements.txt :: fastapi, uvicorn, python-multipart, httpx, keyring, ptyprocess, pywinpty
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Seven packages, each pinned, with no comments (the formvis-style trailing licence comments were removed in review under the no-comments rule; the licences live here and in NOTICE.md): fastapi MIT, uvicorn BSD-3-Clause, python-multipart Apache-2.0, httpx BSD-3-Clause, keyring MIT, ptyprocess ISC (non-win32), pywinpty MIT (win32). Rows for NOTICE.md are in the build notice file. ptyprocess and pywinpty serve the terminal dock, which lands later; they are pinned now so the lock is stable.

### backend/requirements.txt · removed-code
- refers-to: backend/requirements.txt :: pillow, pillow-heif, rawpy, numpy, opencv-python-headless, onnxruntime, onnx, psd-tools, tifffile, OpenEXR, pyspellchecker
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed every image and ML package of formvis: this is a code workbench, not an image editor. Also not copied: `requirements-test.txt` (no tests), `requirements_desktop*.txt`, `requirements_ml*.txt`, `requirements_relight.txt`, `requirements_sam2.txt`.

## backend/requirements_macos.txt

### backend/requirements_macos.txt · unpinned list
- refers-to: backend/requirements_macos.txt :: all
- kind: rationale
- logged: v0.1.0 · 2026-10-30
- formvis keeps an unpinned list for macOS so the newest wheels for the machine install. It must hold the same packages as requirements.txt: the formvis file carried a comment that httpx was missing from it until 1.62.1 (the owner's Mac had no httpx, so the engine, which imported local generation at start, could not start), and a test kept the two in step. There are no tests here, so keep the two files in step by hand. `ptyprocess` is listed bare because macOS is never win32.

## backend/app/__init__.py

### backend/app/__init__.py · find_library guard
- refers-to: backend/app/__init__.py :: ctypes.util._findLib_ld
- kind: warning-context
- logged: v0.1.0 · 2026-10-30
- Carried from formvis 1.89.8. On Linux `ctypes.util.find_library` falls back to `ld -t -o /dev/null -l<name>` when its compiler probe finds nothing, and a failed link removes its output file: run as root, a lookup for a missing library (a dependency probing for the macOS Security framework at import, for one) deleted /dev/null. The fallback is switched off for this process before any dependency loads. The formvis `# type: ignore[attr-defined]` marker is dropped.

### backend/app/__init__.py · __version__
- refers-to: backend/app/__init__.py :: __version__
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- "0.1.0". `./subform version` reads this line with a pattern match, so keep the exact form `__version__ = "X.Y.Z"` on one line.

## backend/app/main.py

### backend/app/main.py · lifespan
- refers-to: backend/app/main.py :: lifespan
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Start: resolve the data folder and start the rotating log. Stop: stop logging and release the engine lock (only if the pid in the lock is this process).

### backend/app/main.py · static mount
- refers-to: backend/app/main.py :: _dist
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- `/` serves `frontend/dist` (or SUBFORM_DIST) with `html=True` when an `index.html` is there, mounted last so `/api` wins. In dev the frontend is Vite on 5650 and nothing is mounted.

### backend/app/main.py · removed-code
- refers-to: backend/app/main.py :: IsolateWindow, PLUGIN_WORKER_CSP, is_plugin_worker
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed the cross-origin isolation middleware (COOP same-origin, COEP credentialless, switch FORMVIS_ISOLATED=0) and the sealed plugin-worker CSP. They exist for SharedArrayBuffer, precise timers and formvis's folder-plugin workers; this app uses none yet. The note on `IsolateWindow`: plain ASGI so a handler can still see its caller hang up (`request.is_disconnected`). Re-add if a feature needs it.
- refers-to: backend/app/main.py :: router includes
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed about 20 image router includes (io, projects, ops, colour, remove_find, merge, video, undo, bands, generative, fal, nodemode, comfyui, llm, mcp, commands, agents, plugins, large, native, terminal, claude_code) and 17 `localgen` imports. Terminal, claude_code, agents and mcp return in porting-map steps 12 to 14. `undo.clear()` and `bands.clear()` (nothing kept outlives the session) go with them.
- refers-to: backend/app/main.py :: lifespan
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed from lifespan: the image-session prune on an executor, `_terminal_service.bind` and, on shutdown, `_claude_service.stop(quiet=True)` and `_terminal_service.close_all()`. They come back with the terminal and Claude Code services.
- refers-to: backend/app/main.py :: noComfy
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed the `--no-comfy` condition around the ComfyUI router; ComfyUI is not part of this app.

## backend/app/core/config.py

### backend/app/core/config.py · data_dir
- refers-to: backend/app/core/config.py :: data_dir
- kind: rationale
- logged: v0.1.0 · 2026-10-30
- Order: SUBFORM_DATA_DIR (also `--user-data-dir`), the portable folder `SubformData` (SUBFORM_PORTABLE=1, or a file named portable or portable.txt beside the frozen engine), `~/Subform` only when it already exists (nothing is created there), else the platform folder named `subform`: Application Support on macOS, %APPDATA% on Windows, $XDG_DATA_HOME (an absolute path, else ~/.local/share) elsewhere. No legacy migration, no former-name carry-over.

### backend/app/core/config.py · env file
- refers-to: backend/app/core/config.py :: _load_env_file
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Reads `backend/.env` (git-ignored) into the environment with setdefault, so a real environment variable wins. Lines that are blank or start with the hash character are skipped; that string literal is code, not a comment.

### backend/app/core/config.py · origins
- refers-to: backend/app/core/config.py :: window_origins
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- CORS origins default to Vite on 5650 (localhost and 127.0.0.1); the window adds the preview port 5651 and the Tauri origins `tauri://localhost` and `http://tauri.localhost`. SUBFORM_CORS_ORIGINS replaces the CORS list (comma separated).

### backend/app/core/config.py · removed-code
- refers-to: backend/app/core/config.py :: total_memory, pixel_budget, MAX_PIXELS, MAX_SIDE, MAX_LAYERS, MAX_DEPTH, MAX_CLIP_CHAIN, MAX_MANIFEST_BYTES, MAX_ASSET_BYTES, SESSION_TTL_SECONDS
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed the document limits of an image editor (a pixel per 40 bytes of memory, 100 to 250 megapixels, layer and clip limits, asset sizes, session lifetime). The memory probe (ctypes GlobalMemoryStatusEx / sysconf) is gone with them.
- refers-to: backend/app/core/config.py :: default_projects_dir, projects_dir, exports_dir, sessions_dir
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed the library and export folders (FORMVIS_LIBRARY_DIR, library.json, Projects, Exports) and the temp sessions folder. Workspaces replace projects later and will get their own helpers.
- refers-to: backend/app/core/config.py :: legacy.carry_over_library, `~/Formvis` special case
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed the import of `core/legacy.py` (former-name carry-over of the saved library), the `~/Formvis` branch and the capitalised former-folder check. `core/legacy.py` is not ported.

## backend/app/core/runtime.py

### backend/app/core/runtime.py · switches
- refers-to: backend/app/core/runtime.py :: apply_switches
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Honoured: `--user-data-dir PATH`, `--port N`, `--log-level LEVEL` (each also as `--name=value`) and `--portable`. Each becomes its SUBFORM_ variable; unknown arguments are handed back. Removed: `--no-comfy`, `--tiles`, `--no-tiles` (image features) and the `noComfy` and `tiles` entries of `switches()`.

### backend/app/core/runtime.py · log and lock
- refers-to: backend/app/core/runtime.py :: start_logging, claim, release
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Log: `Logs/subform-engine.log` in the data folder, 1 MiB each, three older files kept (SUBFORM_LOG_BYTES sets the size, SUBFORM_LOG_LEVEL the level) for the loggers subform, uvicorn, uvicorn.error and uvicorn.access. Lock: `engine.lock` holds `{pid, started}`; a live other pid raises AlreadyRunning, a lock left by a dead process (or a zombie on Linux) is replaced. On Windows liveness uses OpenProcess with PROCESS_QUERY_LIMITED_INFORMATION (0x1000).

## backend/app/core/local_guard.py

### backend/app/core/local_guard.py · LocalGuard
- refers-to: backend/app/core/local_guard.py :: LocalGuard
- kind: rationale
- logged: v0.1.0 · 2026-10-30
- The engine answers this computer's own window and agents only. Host must be 127.0.0.1, localhost or ::1. With no Origin header the request passes unless Sec-Fetch-Site says cross-site; with an Origin it must be in the allowed list or be the same http origin as the Host. Websockets that fail are closed with code 4403; HTTP gets 403 JSON. Ported unchanged except the user-visible name in the 403 body.

## backend/app/routers/system.py

### backend/app/routers/system.py · status
- refers-to: backend/app/routers/system.py :: status
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Written new (not the formvis system router). `GET /api/system/status` returns `{"app":"subform","version":"0.1.0","engine":"python","data_dir":...,"git":<version or null>,"claude":<path or null>}`. git is `git --version` with the "git version " prefix removed, run with a 5 second timeout; claude is `shutil.which("claude")`. Both are found on the system and never bundled (repository rule).

### backend/app/routers/system.py · removed-code
- refers-to: backend/app/routers/system.py :: formvis system router
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- The formvis router (image formats, GPU and colour info, System Info data) is not ported; only the status route is new here.

## backend/app/services (created in v0.5.0)

The package now holds ptyhost_client.py and sessions.py (Phase F5); their entries, with the pty-host and the terminal, sessions and skills routers, are in app/services/HASHOUT_LOG.md. The `sessions.py` here is the agent-session registry, not formvis's image-asset store described below, which stays unported.

### backend/app/services · sessions
- refers-to: backend/app/services/sessions.py :: prune, create, asset_path, payload
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- formvis `services/sessions.py` is the temp store of image assets per editing session (32-hex ids under the temp folder, pruned after 24 hours, depends on `project_format.safe_name`). main.py here needs nothing like it, so neither `services/__init__.py` nor `sessions.py` is created. The package arrives with the first real service (terminal, step 12 of the porting map).
- refers-to: backend/app/services/__init__.py :: package
- kind: todo
- logged: v0.1.0 · 2026-10-30
- Create `services/__init__.py` with the first service.

## Root scripts and setup/

### subform · commands
- refers-to: subform :: case
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Commands with a target today: boot (default, also `dev`), install, backend, frontend, serve, doctor, clean, version, help. `version` reads `backend/app/__init__.py` (formvis read `frontend/src/version.ts`; keep the two in step when the frontend has its own version file) and appends the short git commit when `git rev-parse` works. `subform_oc_install` runs `setup/install_all`. Installed pieces call the frontend scripts as `bash ./boot_frontend` and `bash ./oc_install`, so they run even when the frontend scripts lack the execute bit.

### subform · removed-code
- refers-to: subform :: install-ml, install-desktop, build, freeze, desktop, libcheck, test, counts, bench, perf, corpus, verify-local, mcp, headless, agents, cli
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed every formvis command whose target does not exist here: ML install (image models), desktop install/dev/build and freeze (no freeze step or Tauri scripts yet; the Tauri shell is built from src-tauri), libcheck, test (no tests), counts and its README/command-catalogue gates, bench, perf, corpus, verify-local (image drawing and local model checks), mcp and headless and agents and cli (no MCP server, Playwright launcher, agent setup or command catalogue yet), and `build` (use `cd frontend && npm run build`; `serve` runs it when `frontend/dist` is missing). Ports changed from 8190/5190 to 5655/5650.
- refers-to: subform :: usage
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Dropped the comment that put the version in the first line of usage ("a copy that missed an update shows it at once, not as unknown command"): the behaviour is kept, the first line still shows the version.

### setup/lib.sh · helpers
- refers-to: setup/lib.sh :: sf_say, sf_die, sf_os, sf_python, sf_venv
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Renamed from the `cv_` prefix to `sf_`, root variable to SUBFORM_ROOT. `sf_python` needs Python 3.13 or newer. `sf_venv` activates `backend/venv`.
- refers-to: setup/lib.sh :: cv_target_triple, cv_exe, cv_rust_env, cv_rust_fresh
- kind: removed-code
- logged: v0.1.0 · 2026-10-30
- Removed with the freeze and desktop build scripts that used them (Rust environment scrubbing, per-compiler cleaning of src-tauri/target through the `.formvis-rustc` stamp, target triple lookup). They return with the build phase.

### setup/boot_all · boot_all.bat
- refers-to: setup/boot_all :: pids
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Starts `backend/boot_backend` and `frontend/boot_frontend` as background jobs, kills both on exit, interrupt or terminate, and prints both addresses. The Windows twin opens two `cmd /k` windows.

### setup/doctor · doctor.bat
- refers-to: setup/doctor :: checks
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Fails on missing node (20.19+ or 22.12+), npm, Python 3.13+. Warns on missing git, claude, backend venv, frontend node_modules, engine packages, Rust, and ports 5650 and SUBFORM_PORT (default 5655) already in use. Removed: the rembg/onnxruntime, OpenCV GrabCut and HEIC checks (image engine).

### setup/serve · serve.bat
- refers-to: setup/serve :: build step
- kind: rationale
- logged: v0.1.0 · 2026-10-30
- formvis called `setup/build_frontend` when `frontend/dist/index.html` was missing; that helper is not ported, so serve runs `npm run build` inside `frontend` itself. It exports SUBFORM_DIST and starts uvicorn without reload.

### setup/clean · clean.bat
- refers-to: setup/clean :: paths
- kind: explainer
- logged: v0.1.0 · 2026-10-30
- Removes `frontend/dist`, `backend/build`, `backend/dist-engine`, `src-tauri/target`, `src-tauri/gen`, `__pycache__` folders under backend and `src-tauri/binaries/subform-engine-*`. `--all` also removes `frontend/node_modules` and `backend/venv`.

### setup · not ported
- refers-to: setup/ :: agents.py, bench*, cli*.py, collect_licenses.py, corpus.py, counts, desktop_*, freeze_backend, headless.py, install_desktop, install_ml, libcheck, line_counts.py, mcp_stdio.py, mcpb*, package_desktop.py, perf.py, pyi_hooks, release_notes.py, test, verify_local*, build_frontend, install_backend, install_frontend
- kind: todo
- logged: v0.1.0 · 2026-10-30
- None is called by a kept script. `install_backend` and `install_frontend` were thin wrappers the root script never used. Freeze, desktop and packaging scripts return with porting-map step 15; mcp_stdio.py and agents.py with step 14; `collect_licenses.py` should be ported before the first release for NOTICE.md.

### setup/freeze_backend · one-folder engine
- refers-to: setup/freeze_backend :: pyinstaller
- kind: explainer
- logged: v0.10.0 · 2026-10-30
- Ported from formvis `setup/freeze_backend` (Apache-2.0, owner's). Differences: always `--onedir` (B04: signable file by file, fast start, no `_MEI` unpack folder), output `src-tauri/engine`, no ML or FFmpeg branches, hidden imports `subform_ptyhost`, `ptyprocess` (`winpty` in the .bat) and `app.services.gate_hook` (the hook script is a string constant, so no data file), `--collect-submodules` for app, uvicorn and keyring, `--copy-metadata keyring`. The window goes in as `frontend_dist`, which `subform_engine.py` already reads. Environment overrides used for builds outside the tree: `SUBFORM_BUILD_VENV`, `SUBFORM_FRONTEND_DIST`, `SUBFORM_FREEZE_WORK`, `SUBFORM_ENGINE_OUT`. With `APPLE_SIGNING_IDENTITY` PyInstaller signs the folder with `src-tauri/entitlements.plist`. `backend/requirements_build.txt` pins PyInstaller 6.22.3 and its hooks 2026.9; it is separate from `requirements.txt` so the tool never reaches the engine's own install.

### subform_engine.py · main
- refers-to: backend/subform_engine.py :: main
- kind: warning-context
- logged: v0.10.0 · 2026-10-30
- Found while freezing: `ptyhost_client.host_command` starts a frozen engine as `subform-engine --ptyhost --data-dir <dir>`, but `main()` has no `--ptyhost` branch, so the frozen binary starts a second engine instead of the pty host (checked: it printed a uvicorn banner on a random port). The fix belongs in the engine entry, before `runtime.claim`: when `--ptyhost` is in argv, `import subform_ptyhost` and `return subform_ptyhost.main()`. The module is already frozen in.

### backend/subform_engine.py · main (--ptyhost)

- refers-to: backend/subform_engine.py :: main, selfcheck
- kind: rationale
- logged: v0.10.0 · 2026-10-30

A frozen engine is one program, so the pty-host is started as `subform-engine --ptyhost --data-dir X`; main now hands that to `subform_ptyhost.main()` before claiming the engine lock, which reads its own arguments. Without it the frozen app started a second full engine and its terminals did not work. The selfcheck also imports the gate hook module and the pty-host so a freeze that misses them fails its check.

### backend/subform_engine.py · selfcheck, alive

- refers-to: backend/subform_engine.py :: selfcheck, sweep_stale_unpacks.alive
- kind: rationale
- logged: v0.10.0 · 2026-10-30

review M7 and L10. `New Form app` reads its files from `app/templates`, which the freeze did not bundle (`--add-data` added to `setup/freeze_backend` and its `.bat`), so a packaged app could not scaffold. `selfcheck` now fails with `templates: missing: <folder>` unless `common`, `python` and `rust` exist under the resource folder. `alive()` in the stale-unpack sweep treated `PermissionError` from `os.kill(pid, 0)` as dead; it means the process exists but belongs to someone else, so it is alive and its unpack folder is kept.

### backend/subform_mcp.py · OPENER

- refers-to: backend/subform_mcp.py :: OPENER, forward
- kind: warning-context
- logged: v0.10.0 · 2026-10-30

review M4. The launcher sends the bearer token with `urllib`, which uses `http_proxy` from the environment. It now opens the request with an opener holding `ProxyHandler({})`, so the token goes only to the engine.

### setup/freeze_backend and build_app · safe_rm, tauri config

- refers-to: setup/freeze_backend :: safe_rm; build_app :: safe_rm, tauri_config
- kind: warning-context
- logged: v0.10.0 · 2026-10-30

review L9, L1. `rm -rf` on paths built from `SUBFORM_FREEZE_WORK` and `SUBFORM_ENGINE_OUT` could remove the wrong folder when a variable is wrong. `safe_rm` refuses an empty path, `/` and `$HOME`, and requires the folder name to be the expected one (`pyinstaller`, `dist-engine`, `engine`). `build_app` now builds the `tauri build --config` JSON with `json.dumps` in Python instead of string interpolation, so a path with a quote or backslash cannot break or alter it. `subform` and `subform.bat` list `mcp` in their usage text. The Windows scripts keep their plain `rmdir` and string config; they are not changed beyond `--add-data` (M7).
