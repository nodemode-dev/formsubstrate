# HASHOUT_LOG · backend · formsubstrate

Current build version: v0.25.1
Last updated: 2026-11-22

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

### backend/app/services/library · pointer

- refers-to: backend/app/services/library/HASHOUT_LOG.md; backend/app/main.py :: app.include_router
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Collections, tools, plugins, MCP servers and the activity feed (ported from substrata) are mounted under `/api` as `/collections`, `/tools`, `/activity`, `/plugins` and `/mcp-servers`. Their log is beside the code in services/library.

### backend/app/services/cogentics · pointer

- refers-to: backend/app/services/cogentics/HASHOUT_LOG.md; backend/app/main.py :: app.include_router
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Cogentics channels and the insight routes (ported from substrata) are mounted under `/api` as `/cogentics` and `/insight`. Their log is beside the code in services/cogentics.

### backend/app/routers/graphs.py · pointer

- refers-to: backend/app/models/HASHOUT_LOG.md; backend/app/main.py :: app.include_router
- kind: explainer
- logged: v0.14.0 · 2026-10-31

The Studio's graph model, validation, saved-graph routes (`/api/graphs`) and preset graphs (`backend/app/templates/graphs`) are ported from substrata. Their log is beside the code in backend/app/models.

### backend/app/routers/recipes.py · pointer

- refers-to: backend/app/services/recipes/HASHOUT_LOG.md; backend/app/services/triggers/HASHOUT_LOG.md; backend/app/main.py :: app.include_router, lifespan
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Recipes (`/api/recipes`) and triggers (`/api/triggers`, the signed webhook `/api/hooks/{id}`) are ported from substrata and mounted under `/api`. `main.py` starts the trigger loop after the sessions reconcile and stops it first at shutdown. Triggers run only while the engine runs; their table is kept in the data folder, not in the workspace. The logs are beside the code in services/recipes and services/triggers.

### setup/freeze_backend · data groups

- refers-to: setup/freeze_backend :: pyinstaller; backend/subform_engine.py :: selfcheck
- kind: rationale
- logged: v0.15.0 · 2026-10-30

Four more `--add-data` folders, each placed where its reader looks under `_MEIPASS`: `presets/graphs` (runs/presets.py reads `_MEIPASS/presets/graphs`), `app/services/recipes/presets` and `app/services/library/bundled` (both found through `Path(__file__)`, which sits under `_MEIPASS/app` when frozen) and `skills` (built-in skills). The graph templates already ride along with `app/templates`. New Python modules under services/runs, recipes, triggers, library and cogentics need no hidden imports: `--collect-submodules app` finds them and the selfcheck imports `app.main`. `selfcheck` counts the files of each group and reports `missing: <folder>` (exit 1) for an empty one. Checked on a frozen Linux engine: 4 graph presets, 5 graph templates, 5 recipe presets, 1 bundled plugin, 1 skill; the engine answered `/api/graphs/presets`, `/api/presets/graphs`, `/api/recipes` (its `presets` list) and `/api/plugins` from the frozen folder. `/api/skills` lists project and user skills only (`sessions.list_skills`); nothing reads the bundled `skills` folder yet, so that route lists it only if a copy sits in `~/.claude/skills`.

### setup/freeze_backend.bat · skill and recipe presets as two arguments

- refers-to: setup/freeze_backend.bat :: pyinstaller
- kind: rationale
- logged: v0.17.1 · 2026-11-22

The Windows freeze line had no space between `"...presets\skills;presets/skills"` and the next `--add-data` (since v0.15.0), so PyInstaller read one argument with a wrong destination and took the recipe presets path as a stray script argument. The space is back; the line now passes the same eight `--add-data` folders as `setup/freeze_backend`. Read only: no Windows freeze ran here.

### build_app.bat, backend/oc_install.bat · a failed install stops the build

- refers-to: build_app.bat :: oc_install.bat, npm ci; backend/oc_install.bat :: venv, pip
- kind: rationale
- logged: v0.17.1 · 2026-11-22

`build_app.bat` used to go on after a failed engine or window install and fail later at the freeze or at `tauri build`, far from the cause. Now `backend/oc_install.bat` exits 1 with a `[formsubstrate] error:` line when the venv is not made, when pip cannot be upgraded or when `requirements.txt` does not install; `build_app.bat` checks the install's exit code, installs the window with `npm ci` (the lock file is tracked), checks its exit code, and then checks that `frontend\node_modules\.bin\tauri.cmd` exists, because the script runs that file next. The install is skipped when `backend\venv\Scripts\activate.bat` and `tauri.cmd` are already there, as before. The script writes no log file; the messages go to the console the build runs in. The same shape as FormPublisher's 0.3.4 `build_app.bat`. Read only: no Windows here, none of it ran.

### backend/requirements_macos.txt · pinned

- refers-to: backend/requirements_macos.txt :: all; backend/requirements.txt :: all
- kind: rationale
- logged: v0.17.1 · 2026-11-22

Replaces the v0.1.0 unpinned list. The seven packages are the same as in `requirements.txt` and now carry the same pins (fastapi 0.141.1, uvicorn[standard] 0.53.0, python-multipart 0.0.32, httpx 0.28.1, keyring 25.7.0, ptyprocess 0.7.0, and pywinpty 3.0.5 behind its win32 marker), so a Mac engine is the same engine Linux, Windows and CI install. Nothing was left unpinned. The packages these pull in (uvloop, httptools, watchfiles, websockets, pydantic and others) are unpinned in both files alike. A pip dry run for `macosx_11_0_arm64` and `macosx_11_0_x86_64` with Python 3.13 and binary wheels only resolved every package. Keep the two files in step by hand.

### .github/workflows/ci.yml · the check workflow

- refers-to: .github/workflows/ci.yml :: frontend, engine
- kind: explainer
- logged: v0.17.1 · 2026-11-22

The check formcompiler's gate waits for (`checks: ["ci.yml"]` in its registry entry). On pushes to main, pull requests and by hand. `frontend`: Node 22, `npm ci`, `npm run build` (`tsc --noEmit` and `vite build`). `engine`: Python 3.13, `pip install -r backend/requirements.txt`, `formsubstrate_engine.py --selfcheck` (unfrozen: imports, version, templates and the five data groups), `compileall` over the engine, and `bash -n` on every shell script. It builds no desktop app, freezes no engine and runs no `cargo check`; the family build does those.

### backend/formsubstrate_engine.py · stream guard, watch_parent

- refers-to: backend/formsubstrate_engine.py :: module head, watch_parent, main
- kind: rationale
- logged: v0.18.0 · 2026-11-22

The entry script now imports `os` and `sys`, replaces a missing `stdin`, `stdout` or `stderr` with the null device, and only then imports anything else. A windowless program on Windows has no streams, and the first `print` or log line would end it; the family rule is that the guard runs before any other import. The Windows freeze is still a console program (see `src-tauri/HASHOUT_LOG.md`, "the engine has no console window"), so this is a guard and not a fix for a seen failure.

`watch_parent` took no argument and returned at once on Windows (`if os.name != "posix": return`), then looped on `os.getppid() == parent` every two seconds. It now takes the data folder and watches the process named in `FORMSUBSTRATE_SHELL_PID` through `startup.watch`, on Windows too (a wait on the process handle); with no such variable it watches its parent on macOS and Linux as before and nothing on Windows as before. On leaving it gives up the lock and the port file through `runtime.release`, removes the unpacked `_MEI` folder as before, and exits 0.

### .github/workflows/ci.yml · the shell job

- refers-to: .github/workflows/ci.yml :: jobs.shell
- kind: rationale
- logged: v0.18.1 · 2026-11-22

The workflow ran no Rust check, so a shell change that did not compile for Windows or macOS was first seen in the family build. The `shell` job runs `cargo check --locked` in `src-tauri` on `windows-latest` and `macos-latest`, each natively, so the Objective-C that two macOS crates compile gets Apple's headers (a Linux machine cannot check the macOS targets for that reason). It writes stand-ins for `frontend/dist` (an `index.html` and the splash page) and `src-tauri/engine`, because `tauri-build` refuses a missing window folder and the build maps the engine folder. It uses the Rust the runner image ships; `Cargo.toml` asks for 1.90 or newer. No Linux leg: that needs the WebKitGTK development packages and the family build covers Linux. Not run on GitHub yet.

### swallowed errors · logged or silent on purpose

- refers-to: backend/app/core/startup.py :: end; backend/app/routers/graphs.py :: _listing; backend/app/routers/lsp.py :: lsp_ws; backend/app/routers/terminal.py :: Sub.writer; backend/app/services/gates.py :: ensure_script; backend/app/services/gitops.py :: ensure_hooks; backend/app/services/ptyhost_client.py :: PtyHostClient._read_loop; backend/app/services/runs/manager.py :: RunManager.tally, RunManager.persist; backend/app/services/runs/worktree.py :: _write, _loop; backend/app/services/sessions.py :: _set_aside, _mcp_arg, _consume, _snapshot, _kill_terminal; backend/app/services/gate_hook.py :: flush_notes, pre_bash, module end; backend/formsubstrate_ptyhost.py :: WinPty.force
- kind: rationale
- logged: v0.19.0 · 2026-11-22

Every `except` in `backend/` whose whole body was `pass` was read in context: 79 of them (72 in the engine code and 7 inside the text of the gate-hook script in `gate_hook.py`, which is Python held in a string and so is not seen by a search of the module). 21 now say what failed and 53 stay silent on purpose; the 5 in `routers/workspace.py` and `routers/secrets.py` (files another change held at the time) are not in this table. Handlers that only `continue` or `return` are not in scope and were not touched.

A logged site is one line through `logging.getLogger("formsubstrate")` with the traceback attached (`exc_info=True`), the same logger `formsubstrate_engine.py` and `runtime.py` already use, so it lands in the engine log at the level the person set with `FORMSUBSTRATE_LOG_LEVEL` (info by default, so a debug line only appears when asked for). `debug` means expected, frequent and harmless; `warning` means something did not happen. Only identifiers are written (a path, a session or run or terminal id, a label), never a value, a header, a token, file content or an environment. The gate hook and the pty-host run as separate programs and do not use that logger. The hook's standard output is the protocol Claude Code reads, so its three lines go through its own `trail()` (the `sf_gate.log` file beside the script, and standard error); the pty-host's standard error is already its log file (`ptyhost.log`, opened by `ptyhost_client._start_host`), so its one line is a `formsubstrate-ptyhost:` line on standard error like the one in `data_dir`. Where a site has no `as` name the traceback carries the exception; where the hook and the pty-host need the text they name it as `exc`.

`agent_lookup.py` is the family's finder, version 1.0.1, kept unchanged (see `NOTICE.md`), so its three silent sites are left as they are.

| File | Function | Caught | Decision | Reason |
| --- | --- | --- | --- | --- |
| app/core/startup.py | end | OSError, SubprocessError ending a leftover engine | logged, warning | the stop did not happen and the caller only says it could not stop |
| app/routers/graphs.py | _listing | OSError, ValueError, AttributeError, TypeError reading a graph file | logged, debug | the row shows valid false with no cause; repeats on every listing |
| app/routers/lsp.py | lsp_ws | Exception in a language server session | logged, warning | any bridge or server failure ended the session with no trace |
| app/routers/terminal.py | Sub.writer | PtyHostError sending an output acknowledgement | logged, debug | a lost acknowledgement can stall a terminal; frequent while the host is down |
| app/services/gates.py | ensure_script | OSError writing the hook script | logged, warning | no script means writes are not gated |
| app/services/gitops.py | ensure_hooks | OSError making the commit-msg hook executable | logged, warning | git skips a hook that is not executable |
| app/services/ptyhost_client.py | PtyHostClient._read_loop | connection to the pty-host ended | logged, debug | normal at shutdown and at host idle exit; the cause (bad frame, reset) was lost |
| app/services/runs/manager.py | RunManager.tally | ValueError, TypeError on a usage note | logged, debug | only the usage figures are off; rare |
| app/services/runs/manager.py | RunManager.persist | OSError saving a run record | logged, warning | the run is missing from history |
| app/services/runs/worktree.py | _write | OSError writing the worktree registry | logged, warning | a run worktree can be left behind with no record |
| app/services/runs/worktree.py | _loop | Exception in a sweep | logged, debug | runs every 3 seconds; a lasting fault would flood the log at warning |
| app/services/sessions.py | _set_aside | OSError setting a damaged registry aside | logged, warning | the damaged file is not kept for inspection |
| app/services/sessions.py | _mcp_arg | OSError writing the session settings | logged, warning | the agent starts without them |
| app/services/sessions.py | _consume | Exception in _on_event | logged, warning | a session event was dropped; a bug would be invisible |
| app/services/sessions.py | _consume | Exception sending an output acknowledgement | logged, debug | lost when the host drops; frequent then |
| app/services/sessions.py | _snapshot | Exception taking a snapshot | logged, warning | the snapshot is missing from review |
| app/services/sessions.py | _kill_terminal | Exception on the kill request | logged, debug | usually the terminal is already gone; a hung host is the rare case |
| app/services/gate_hook.py (script text) | flush_notes | OSError, ValueError, URLError posting a note | logged through trail | the owner is not told a write was not gated |
| app/services/gate_hook.py (script text) | pre_bash | OSError, ValueError saving the Bash snapshot | logged through trail | the check after the Bash command cannot run |
| app/services/gate_hook.py (script text) | module end | Exception flushing the notes | logged through trail | same as flush_notes |
| formsubstrate_ptyhost.py | WinPty.force | Exception ending a terminal process | logged to stderr | the process may still run while the terminal is marked ended |
| app/__init__.py | module | ImportError loading ctypes.util | silent | feature probe at import, before any logging exists |
| app/core/runtime.py | release | OSError, ValueError, AttributeError removing the lock | silent | cleanup of a file that may be gone; logging is already stopped |
| app/core/startup.py | _created_posix | OSError, IndexError, ValueError, StopIteration reading /proc | silent | probe; the `ps` fallback follows at once |
| app/main.py | lifespan | ValueError, TypeError restoring a signal handler | silent | only the main thread can set one; shutdown cleanup |
| app/routers/debug.py | relay | WebSocketDisconnect | silent | the client closed the socket, the normal end |
| app/routers/graphs.py | _atomic | OSError removing the temp file | silent | best-effort unlink; the original error is raised |
| app/routers/lsp.py | lsp_ws | WebSocketDisconnect | silent | the client closed the socket, the normal end |
| app/routers/terminal.py | terminals_ws | PtyHostError on ensure | silent | no pty-host yet is the normal first state; attach reports it |
| app/routers/terminal.py | terminals_ws | WebSocketDisconnect | silent | the client closed the socket, the normal end |
| app/routers/terminal.py | Hub.drop | RuntimeError, OSError closing the socket | silent | already closed |
| app/routers/terminal.py | Hub.detach | PtyHostError returning owed acknowledgements | silent | releasing a subscriber that is leaving; an unreachable host shows on the next terminal request |
| app/routers/terminal.py | Hub.detach | PtyHostError sending detach | silent | same |
| app/services/agent_lookup.py | _stop | OSError, AttributeError on killpg | silent | probe shell that may be gone; file held unchanged |
| app/services/agent_lookup.py | _stop | OSError on kill | silent | same |
| app/services/agent_lookup.py | _stop | OSError, ValueError, SubprocessError on communicate | silent | same |
| app/services/gate_hook.py (script text) | trail | OSError writing sf_gate.log | silent | it is the reporter; standard error is tried next |
| app/services/gate_hook.py (script text) | trail | OSError writing standard error | silent | it is the reporter; nowhere left to report to |
| app/services/gate_hook.py (script text) | tar_items | Exception reading an archive | silent | the read budget ends by raising on purpose; a damaged archive gives no member names |
| app/services/gate_hook.py (script text) | snapshot_save | OSError removing an expired snapshot | silent | best-effort cleanup of an old file |
| app/services/gitops.py | identity_put | OSError on chmod 0600 | silent | the file is created with mode 0600; some file systems refuse chmod |
| app/services/gitops.py | _reap | ProcessLookupError | silent | process already exited |
| app/services/gitops.py | _write_atomic | OSError removing the temp file | silent | best-effort unlink; the original error is raised |
| app/services/library/builtin.py | _search_capabilities | Refused listing collections | silent | no workspace open: no collections is the answer |
| app/services/library/mcp_client.py | McpClientManager.add | Exception deleting old stored headers | silent | there may be nothing stored |
| app/services/library/mcp_client.py | McpClientManager.remove | Exception deleting stored headers | silent | there may be nothing stored |
| app/services/library/mcp_client.py | McpClientManager.stop_now | ProcessLookupError | silent | process already exited at exit |
| app/services/ptyhost_client.py | PtyHostClient._read_loop | OSError closing the writer | silent | already closed |
| app/services/ptyhost_client.py | PtyHostClient.events | PtyHostError on reconnect | silent | a retry loop with backoff; a restarting host is expected |
| app/services/ptyhost_client.py | PtyHostClient.close | OSError closing the writer | silent | already closed |
| app/services/ptyhost_client.py | PtyHostClient.close | CancelledError, Exception awaiting the cancelled read task | silent | the cancel is the point; the loop handles its own failures |
| app/services/runs/agent.py | _run_claude.feed | BrokenPipeError, ConnectionResetError writing the prompt | silent | the agent exited first; the run reports its exit and standard error |
| app/services/runs/manager.py | RunManager.cancel | ProcessLookupError | silent | process already exited |
| app/services/runs/manager.py | RunManager.shutdown | ProcessLookupError | silent | process already exited |
| app/services/runs/manager.py | RunManager.prune | OSError removing an old run file | silent | best-effort; tried again at the next prune |
| app/services/sessions.py | _release | Exception on kill or detach | silent | the terminal already exited or the host is gone |
| app/services/sessions.py | _on_exit | RuntimeError scheduling the release | silent | no running loop, nothing to schedule on |
| app/services/sessions.py | _on_exit | RuntimeError scheduling the snapshot | silent | same |
| app/services/sessions.py | shutdown | CancelledError, Exception awaiting the cancelled consumer | silent | the cancel is the point |
| app/services/triggers/manager.py | Triggers.stop | CancelledError | silent | the cancel is the point |
| formsubstrate_engine.py | main | OSError, ValueError, AttributeError removing its own port file | silent | cleanup at exit of a file that may be gone |
| formsubstrate_ptyhost.py | PosixPty.resize | OSError | silent | the child exited; nothing to resize |
| formsubstrate_ptyhost.py | PosixPty.signal_group | ProcessLookupError, PermissionError on the single-process kill | silent | the process is already gone |
| formsubstrate_ptyhost.py | PosixPty.sweep | ProcessLookupError, PermissionError | silent | the group is already gone |
| formsubstrate_ptyhost.py | PosixPty.close | OSError closing the pty file | silent | already closed |
| formsubstrate_ptyhost.py | WinPty.write | OSError | silent | the child exited; the POSIX write drops the input the same way |
| formsubstrate_ptyhost.py | WinPty.resize | OSError | silent | the child exited; nothing to resize |
| formsubstrate_ptyhost.py | WinPty.terminate | Exception | silent | force follows when the process is still alive, and force logs its failure |
| formsubstrate_ptyhost.py | WinPty.close | Exception | silent | best-effort close |
| formsubstrate_ptyhost.py | Host.client | IncompleteReadError, ConnectionError, OSError reading a frame | silent | a client going away is the normal end |
| formsubstrate_ptyhost.py | Host.client | OSError closing the writer | silent | already closed |
| formsubstrate_ptyhost.py | Host.listen | FileNotFoundError removing a stale socket | silent | no stale socket is the usual case |
| formsubstrate_ptyhost.py | Host.cleanup | OSError removing a socket, port or token file | silent | cleanup of files that may be gone |
| formsubstrate_ptyhost.py | Host.cleanup | OSError, ValueError reading the pid file | silent | cleanup; a missing or foreign pid file is left alone |
| app/routers/workspace.py | _is_form_repo (two sites) | OSError, ValueError reading package.json or Cargo.toml | silent | a probe: an unreadable file means the folder is not a Form app |
| app/routers/workspace.py | _atomic_write | OSError removing the temp file before the error is raised again | silent | best-effort cleanup; the real error is raised |
| app/routers/secrets.py | migrate_keyring | OSError writing the carry-over marker | logged, warning | without the marker the carry-over repeats at every start |
| app/services/secret_store.py | _write_private (two sites) | FileNotFoundError on a stale temp; OSError removing the temp before re-raise | silent | cleanup; the real error is raised |
| app/services/secret_store.py | delete | PasswordDeleteError, NoKeyringError | silent | removing an entry that is not there is the expected case |
| app/services/secret_store.py | _index | OSError writing the converted index | logged, warning | it retries at the next read, but a lasting failure would be invisible |
| app/services/secret_store.py | _quiet_settle | OSError updating the index | logged, warning | a stale index gives a wrong status later |

The window's three sites in `frontend/src/io` landed with these: `io/runs.ts` (a run event that could not be parsed or handled now warns, it was an empty `catch { }`), and `io/sessions.ts` (the session list and the gate list refresh after the event stream connects now warn; a gate card that never shows blocks an agent). `io/lsp.ts` keeps two silent handlers: one only marks a promise handled, the other is a best-effort warm-up. No logged line carries a secret's name or value.

### backend/formsubstrate_engine.py · main, selfcheck (--mcp)

- refers-to: backend/formsubstrate_engine.py :: main, selfcheck; backend/formsubstrate_mcp.py :: main; setup/freeze_backend, setup/freeze_backend.bat :: pyinstaller (hidden imports)
- kind: rationale
- logged: v0.21.0 · 2026-11-22

An installed app has no repository launcher, so the frozen engine itself takes `--mcp`: after `--selfcheck` and `--ptyhost`, and after the stream guard at the top of the script (a missing stdin, stdout or stderr becomes the null device before anything else runs), `main` applies the engine's own switches (`--user-data-dir`, `--port`, `--log-level`, `--portable`, through `runtime.apply_switches`, with `--mcp` itself left out) and then runs `formsubstrate_mcp.main()` in the same process: one JSON-RPC message per stdin line, forwarded to `POST /mcp` of the running engine found through `engine.port` in the data folder, with `FORMSUBSTRATE_GATE_TOKEN` as the bearer. Nothing is printed to stdout before the launcher, so the stream stays pure JSON-RPC. The launcher module is listed as `--hidden-import formsubstrate_mcp` in both freeze scripts, as the pty-host is, and `selfcheck` imports it, so a freeze that lost it fails its own `--selfcheck`. The bundle carries no `form-app.json` (see src-tauri/HASHOUT_LOG.md, "form-app.json · not in the bundle"). Checked unfrozen: an engine started from /tmp with a made-up data folder and a window token injected through `FORMSUBSTRATE_WINDOW_TOKEN`, then `formsubstrate_engine.py --mcp --user-data-dir [that folder]` with the token in `FORMSUBSTRATE_GATE_TOKEN` answered `initialize` (protocol 2025-06-18, server formsubstrate) and `tools/list` on stdin and exited 0 at end of input. The frozen build was not run.

### setup/agents.py · sync (the MCP tool reference)

- refers-to: setup/agents.py :: reference, sync, main; setup/agents, setup/agents.bat; formsubstrate, formsubstrate.bat :: agents; .github/workflows/ci.yml :: engine (Agent tool reference, Shell syntax); .claude/skills/formsubstrate-harness/references/tools.md; backend/app/services/mcp_tools.py :: TOOLS
- kind: rationale
- logged: v0.21.0 · 2026-11-22

`./formsubstrate agents sync` writes `.claude/skills/formsubstrate-harness/references/tools.md` from `TOOLS` in `services/mcp_tools.py`: a contents list, then per tool its name as the heading, its title, its description, its annotations other than the title, and its input schema as a JSON block, so every field of the definition is in the file and any change to one shows as a difference. The shape and place follow FormVis `setup/agents.py` (`tools_reference`, written to `.claude/skills/formvis-editing/references/tools.md`, generated, never edited by hand, `--check` fails on drift); the place also follows formcompiler's agents contract (`docs/REGISTRY.md`, the `agents` section): the release job zips every skill under the registry's `skills` folder, usually `.claude/skills`, so the reference reaches an agent with the skills archive. `--check` writes nothing and exits 1 with a message naming the file and the command to run; `--root DIR` points both the import and the file at another copy of the repository. The tools are imported from the engine, so the script runs with `backend/venv`'s Python when it exists and the first `python3` on the path otherwise (CI has the engine requirements installed there). Checked: sync wrote the file, a second sync and `--check` both reported it in step, and `--check --root` on a copy under /tmp whose `workspace_info` description had one word changed exited 1. FormVis also mirrors skills to `.agents/skills` and writes `agents/manifest.json`; neither was asked for here and Substrate has no `.agents` folder, so the script does neither.

### setup/freeze_backend · data groups (correction to the v0.15.0 entry)

- refers-to: setup/freeze_backend · data groups (v0.15.0, above); backend/app/routers/skills.py :: builtin_folders, list_all; backend/app/services/sessions.py :: list_skills, _scan_skills; docs/PARITY.md :: D4
- kind: correction
- logged: v0.21.0 · 2026-11-22

The v0.15.0 entry ends: "`/api/skills` lists project and user skills only (`sessions.list_skills`); nothing reads the bundled `skills` folder yet, so that route lists it only if a copy sits in `~/.claude/skills`." That is no longer so. `routers/skills.py` `list_all` takes the project and user skills from `sessions.list_skills`, then scans each folder of `builtin_folders` (`config.BACKEND_DIR / "skills"`, and `_MEIPASS/skills` in a frozen engine, the folder the `skills` data group puts there) with `_scan_skills` under the source `built-in`, and adds every skill whose name is not already listed with that source. Checked on a live unfrozen engine: `GET /api/skills` returned `formsubstrate-graphs` with source `built-in`. The route only lists the skill: nothing copies it into a session's worktree or `.claude/skills`. docs/PARITY.md D4 now says the same.

### backend/app/main.py · ide router and shutdown
- refers-to: backend/app/main.py :: lifespan, app; backend/app/routers/ide.py :: router; backend/app/services/ide_link.py :: shutdown
- kind: rationale
- logged: v0.25.0 · 2026-11-22
The ide router is included under `/api`, and the lifespan calls `ide_link.shutdown()` after the terminals stop, which closes the socket and removes the lock file. There is no start call: the server starts when the window first reports a workspace.

### backend/presets/plugins/web_search.py · search (user agent)
- refers-to: backend/presets/plugins/web_search.py :: search; backend/app/__init__.py :: __version__; backend/app/services/library/plugins.py :: _load_one; docs/GUIDE.md :: What Substrate sends over the network
- kind: fix
- logged: v0.25.1 · 2026-11-22
The web search plugin sent a user agent with a version typed in by hand, which had stayed at 0.17 in every release since. It now reads the engine's version: `from app import __version__` and `f"formsubstrate/{__version__}"`. The import is safe where plugins run: `_load_one` loads a plugin file with `importlib` inside the engine process (the file already imports `app.services.library.registry`), in a checkout and in the frozen engine alike, so `app` is always importable. docs/GUIDE.md no longer quotes a number. Removed line:

```
    req = urllib.request.Request(url, headers={"User-Agent": "formsubstrate/0.17"})
```

### backend/formsubstrate_engine.py · main (log first, started alone, refusal logged)
- refers-to: backend/formsubstrate_engine.py :: main, module end; backend/app/core/startup.py :: keep_errors, alone, app_beside, open_app; backend/app/core/runtime.py :: start_logging
- kind: fix
- logged: v0.25.3 · 2026-11-25
The serving path now follows the family's Windows start order (FormTools `formtools_engine.py` :: `serve`). The log file starts before the lock is asked for, so a refusal and a replaced leftover engine are both in the log; a data folder that cannot be made is one sentence and exit 5. `startup.keep_errors` points a missing standard error at `formsubstrate-engine-errors.log` beside the log. The engine prints `[formsubstrate] engine log: <path>` on standard error, which the shell keeps among the last lines it shows when the engine fails.

A frozen engine started with no `FORMSUBSTRATE_SHELL_PID` (a double click, or a launcher that picked the helper) opens the app beside it and stops with exit 0, or says it serves nothing on its own and stops with exit 4; it takes no lock and no port. `FORMSUBSTRATE_NO_SHELL=1` lets a build check serve it alone. `startup.PLACES` reaches the app in all three layouts (`engine\..\formsubstrate.exe` on Windows, `Resources/engine/../../MacOS/formsubstrate` on macOS, `/usr/lib/Substrate/engine/../../../bin/formsubstrate` in a Linux package), which corrects the v0.18.0 note in `app/core/HASHOUT_LOG.md`.

An error that ends `main` is written to the log before it is raised. `lifespan` calls `start_logging` a second time; it removes its own handler first, so the only effect is a second "engine started" line, and it adds the handler back to the uvicorn loggers that uvicorn's log set-up cleared.

Run here on Linux with stand-in shells (`sleep`): a second engine refuses with exit 2 and the refusal is in the log; a stopped engine whose shell is gone is ended (exit 137) and replaced; an engine leaves with its shell and removes the lock; the entry run with `sys.frozen` set and `sys.executable` in a Linux package layout opens a stand-in app and takes no lock, and with no app near exits 4; it serves with standard input, output and error closed, and standard error then goes to the errors file. Not run on Windows or macOS, and not as a really frozen engine.
