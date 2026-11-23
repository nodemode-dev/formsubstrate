# Security policy

Substrate is a desktop code editor (repository `nodemode-dev/formsubstrate`). It runs agent programs, language servers and terminals on your computer, so a security problem here matters. Thank you for reporting one privately.

## Reporting a problem

Please do not open a public issue, pull request or discussion for a security problem.

Report it one of two ways:

- **GitHub private vulnerability reporting.** Open the repository's Security tab and choose Report a vulnerability. Only the maintainers see the report.
- **Email.** Write to the maintainer at mackin@nodemode.ai.

Include what lets us reproduce it:

- the Substrate version (Help > About Substrate, or `./formsubstrate version`) and your operating system;
- whether you ran the desktop app or a source checkout opened in a browser;
- the steps, and a request, file or small project that shows the problem;
- what an attacker gains (which file, token, command or boundary), and what they need first (a web page you visit, a program on the same computer, a project you opened, a project you trusted);
- any log lines, with secrets removed.

## Supported versions

Fixes go into the latest release only. Older releases are not patched; update to the latest release to get a fix.

## Trust model

Substrate has three parts on one computer: the window, the engine (a local HTTP server) and the desktop shell that starts both. The full description for contributors is `.claude/skills/formsubstrate-harness/references/security-model.md`; this is the summary.

### The engine listens on this computer only

The engine binds `127.0.0.1` and nothing else (`backend/formsubstrate_engine.py`). A webhook trigger is therefore reachable by programs on this computer only.

### LocalGuard: every request

Every HTTP and WebSocket request passes `LocalGuard` (`backend/app/core/local_guard.py`) first. It answers 403 (or closes a WebSocket with code 4403) unless:

- the Host header names loopback (`127.0.0.1`, `localhost` or `::1`), and
- the request has no Origin and is not marked `Sec-Fetch-Site: cross-site`, or its Origin is a configured window origin, or it is an `http` origin equal to the Host.

This stops other websites and other machines. It does not stop another program on the same computer, which can send a request with no Origin. Routes that only read rely on LocalGuard alone.

### The window token: changes only the owner may make

Routes that change something only the person at the window may change depend on `require_window`, which compares the header `X-FormSubstrate-Window` with the window token in constant time. That covers, among others: writing, renaming and deleting files; staging, committing, pushing and the other git changes; starting and stopping sessions and terminals; starting runs, recipes, triggers and tasks; answering a permission gate; announcing workspace trust; saving a secret; adding an MCP client; and changing shortcuts, program paths and the two switches below.

- **Desktop app.** The Tauri shell makes a random token, passes it to the engine in the environment variable `FORMSUBSTRATE_WINDOW_TOKEN`, and gives it to the main window through a Tauri command that only that window may call. The engine removes the variable from its own environment when it starts, so the terminals and sessions it starts do not inherit it, and `POST /api/window-token` answers 404. Limit: a process running as the same user can still read the engine's starting environment from the operating system, so the token defends against web pages and agent sessions, not against a hostile program running as you.
- **Browser development build.** Without the shell (a source checkout opened in a browser) the engine mints the token itself and `POST /api/window-token` returns it to any request that carries a window Origin. A local program can send that Origin. This mode is a convenience for developers and is not a security boundary.

### Session tokens: one worktree each

Each agent session gets its own token, in its environment only (`FORMSUBSTRATE_GATE_TOKEN`). With it the session can ask the permission gate about its own writes and read through the MCP server: its own worktree, its own entry in the session list and its own terminals. It cannot name another session and it cannot answer a gate; only the window can. The token is dropped when the session is closed.

Only Claude Code sessions pass the permission gate. A session run by Codex, Cursor or Antigravity gets its own worktree and token, but its writes are not gated, and the window says so.

### Approved MCP clients: read only, hashes only

An MCP client outside Substrate needs a client token, which the person creates by name in Preferences. The token is shown once. The engine keeps only its SHA-256, with the client's name and times, in `mcp-clients.json` in the data folder (mode 0600). A client may only read: it never gets a tool that writes, a terminal tool, or another session's worktree. Removing the client revokes the token at once. Details are in `docs/MCP.md`.

### Workspace trust

A project can carry its own programs. Substrate does not run them until you trust the workspace.

- For language servers, the debugger, tasks and triggers the engine keeps its own record of the decision (`backend/app/core/trust.py`): real paths, in memory only, so after an engine restart nothing is trusted until the window says so again. The record is set only through window-token routes, and only for the workspace that is open.
- That record gates: a language server found inside the project, every custom language server, the project's Python environment for debugging, reading the project's debug launch file, and reading, listing and running the project's tasks. The language server and debugger sockets ask the record and take no trust flag from the caller. Withdrawing trust stops the custom and in-project language servers and every running task.
- Still taken from the request, as a statement from the window: the `trust` query on plugins, presets and the harness import, and the `trusted` field on graph runs, recipes, sessions and Cogentics. Every route of that kind that changes or starts something also needs the window token.

### Secrets

Secrets are kept in the operating system's keyring under the service name `formsubstrate`; they are saved and removed through window-token routes. On a computer with no keyring, the keys saved through Preferences (such as the Anthropic API key) and the Cogentics provider key fall back to `secrets-local.json` in the data folder, created with mode 0600 so only your user can read it (on Windows the user profile's permissions protect it). Plugin secrets, webhook secrets and MCP server headers have no fallback: they live only in the keyring. `secrets-index.json` records which names are saved and where, never a value.

### Programs come from your computer

Agent programs (Claude Code, Codex, Cursor, Antigravity), language servers and debug adapters are found on your computer: a path you set, then the usual places a terminal would find them. Substrate does not bundle them and does not download or install them. Where one is missing it shows an install line for you to copy and run yourself.

### What Substrate sends over the network

Substrate has no telemetry, no crash reporting and no update check. Each feature that reaches the network is listed in the guide: see "What Substrate sends over the network" in `docs/GUIDE.md`.

### Two switches that are off by default

- **Route through FormNET** (Preferences > Terminal). When on, and the proxy on `127.0.0.1:8761` answers, terminals and agent sessions started from then on get proxy and certificate variables. The engine's own requests, language servers, git actions and graph runs are not routed, and running terminals are not changed.
- **Claude Code in the editor** (Preferences > Agents). When on and a workspace is open, Substrate runs one more listener on `127.0.0.1`, on a random port. It is not covered by LocalGuard and carries its own checks: a loopback Host, no Origin, and a token compared in constant time. The token is written only to a lock file under `~/.claude/ide` with mode 0600, and the file is removed when the listener stops. A path outside the workspace is refused. This connection has been run against a stand-in client only, not against Claude Code itself.

## Outside this policy

A program you chose to run (an agent, a task, a language server, a plugin in a workspace you trusted) acts with your user's rights; what it does is that program's behaviour and not a flaw in Substrate. A way for such a program to obtain the window token in the desktop app, to answer its own gate, or to reach another session's worktree through Substrate is a flaw, and we want to hear about it.
