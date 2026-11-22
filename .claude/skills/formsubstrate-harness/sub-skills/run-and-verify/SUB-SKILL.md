---
name: run-and-verify
description: Run, build and verify formsubstrate changes. Use when starting the engine or window, building into a scratch folder, typechecking, checking a UI change for flash or layout shift in Chromium at 4x CPU throttle with Playwright, or deciding which ports and data folder to use.
---

# run-and-verify

Verification is part of the change. A UI edit is not done until it was exercised in a real browser under throttle with layout shift measured.

## Scripts in setup/

The root `./formsubstrate` dispatcher runs these (all in `setup/`, with `.bat` twins):

| Command | Script | Does |
| --- | --- | --- |
| `./formsubstrate install` | `install_all` | backend venv and frontend node_modules |
| `./formsubstrate` or `boot` | `boot_all` | backend on 5655 and Vite on 5650 together |
| `backend`, `frontend` | `boot_backend`, `boot_frontend` | one half |
| `serve` | `serve` | builds `frontend/dist` if missing, then the engine serves it on `FORMSUBSTRATE_PORT` (default 5655) |
| `doctor` | `doctor` | toolchain, installs, ports 5650 and the engine port |
| `clean [--all]` | `clean` | build output, with `--all` also venv and node_modules |

As a parallel agent do not use these on the default ports. Use your own port and a scratch data folder.

## Engine

From `backend/`, with a scratch data folder and your own port (check it is free first):

1. `FORMSUBSTRATE_DATA_DIR=[scratch]/data FORMSUBSTRATE_DIST=[scratch]/dist venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port [port]`
2. Record the pid you started and kill only that pid.
3. After any Python edit: `venv/bin/python -c "import app.main"`.

`FORMSUBSTRATE_DIST` is read by `config.dist_dir()`; the engine mounts it at `/` only when it holds an `index.html`. Without it the engine falls back to `frontend/dist`. The engine origin rule: the window origins are the CORS origins (5650 on localhost and 127.0.0.1), the preview port (5651), `tauri://localhost` and `http://tauri.localhost`; for an engine on another port serving its own dist, LocalGuard also accepts an http origin equal to the Host.

## Window

- `cd frontend && npx tsc --noEmit`. Errors in files you did not touch: note them in your report, do not fix.
- `npx vite build --outDir [scratch]/dist` (sourcemaps on, target es2022). Never write into `frontend/dist`.
- Vite dev stays `server.host: false` with `strictPort`; never loosen either.

## Playwright at 4x throttle

Playwright is installed globally: run node with `NODE_PATH=$(npm root -g)` and `require('playwright')`. Open the engine-served build in Chromium, then:

1. Create a CDP session and call `Emulation.setCPUThrottlingRate` with rate 4.
2. Install a layout-shift observer before interaction (`PerformanceObserver` on `layout-shift`, summing entries without recent input) and read the total at the end.
3. Drive the feature the way a user would: open the panel, type, switch tabs, resize.
4. Collect `pageerror` and console errors.
5. Report layout shift (target 0), page errors (target none), and what you clicked.

`references/verification-recipes.md` has a full script skeleton, plus recipes for `/mcp` and for running the gate hook by hand. A change to a gated Bash form, `terminal_tail` or the pty-host is verified against the real hook script or a real pty-host, not a mock; the heavy steps (vite build, Playwright, a live `claude` session) go through `flock /home/claude/build/t11/heavy.lock` when the brief says so.

## Common issues

**403 from every call in the browser.** The page origin is not a window origin and not equal to the Host. Serve the build from the engine, or use 5650 or 5651.

**Window shows Engine offline.** The status poll runs every 15 s; wait one poll after a restart.

**A sibling agent's server is on the port.** Pick another port in your brief's block; never kill by name.
