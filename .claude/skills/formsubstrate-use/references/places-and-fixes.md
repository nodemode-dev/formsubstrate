# Places, shortcuts and fixes

## Contents

- The data folder
- Inside a project
- Ports
- Shortcuts for these tasks
- Common failures

## The data folder

Chosen in this order: `FORMSUBSTRATE_DATA_DIR` if set; `FormSubstrateData` beside the app in portable mode; `~/FormSubstrate` if it exists; else `~/Library/Application Support/formsubstrate` on macOS, `%APPDATA%\formsubstrate` on Windows, `~/.local/share/formsubstrate` on Linux. Help > About Substrate shows the folder in use.

It holds, among others: `recent.json`, `identity.json`, `worktrees/` (one folder per session), `run-worktrees.json`, `runs/` (saved graph runs, one folder per workspace), `mcp-clients.json` (approved outside clients, token hashes only), `engine.port`, and `Logs/formsubstrate-engine.log`. Secrets are not in these files: they live in the system keyring under the service name `formsubstrate`; only on a computer without a keyring are the Preferences and Cogentics keys kept in `secrets-local.json`, readable by the user only.

## Inside a project

Substrate writes only to `.formsubstrate/` (graphs, recipes, plugins, MCP settings) and, for sessions and runs, to their worktrees. The person's working copy changes only when they accept a hunk or save a file.

## Ports

From a source checkout the window is 5650 and the engine 5655 (`FORMSUBSTRATE_PORT` moves the engine). The desktop app picks a free engine port and writes it to `engine.port`, which is how the MCP launcher finds it.

## Shortcuts for these tasks

`Ctrl` is `Cmd` and `Alt` is `Option` on macOS.

| Action | Windows and Linux |
| --- | --- |
| Open Folder | `Ctrl+O` |
| Preferences | `Ctrl+,` |
| Command palette | `Shift+Ctrl+P` or `Ctrl+K` |
| Toggle Terminal | `Ctrl+J` |
| New Claude Code Session | `Shift+Ctrl+A` |
| Answer Existing Slot Prompt | `Alt+Ctrl+G` |
| Studio | `Alt+Shift+S` |
| Run Graph | `Alt+Ctrl+R` |
| Commit (in the commit box) | `Ctrl+Enter` |

## Common failures

- The engine does not start: the packaged app says "The Substrate engine failed to start. Please relaunch the app." From a checkout run `./formsubstrate doctor`, then `./formsubstrate install`. Read `Logs/formsubstrate-engine.log`. Home shows "Engine offline" when the window cannot reach it.
- A port is in use: `./formsubstrate doctor` names it; start with another `FORMSUBSTRATE_PORT`.
- Actions fail with 403 after the engine restarted in a browser development build: reload the window to fetch a new window token.
- A session cannot start: the folder must be a git repository with at least one commit, and `claude` must be found (set `FORMSUBSTRATE_CLAUDE_BIN` if it is not).
- A project's language server or a custom language server does not start (the status bar says it needs trust): trust the workspace, then Go > Restart Language Servers if it still does not start. Substrate never installs a server; Go > Language Servers... shows the install line.
- Node.js debugging says js-debug was not found: download js-debug-dap from the vscode-js-debug releases page on GitHub, unpack it, and set the folder under Preferences > Language Servers > Run and Debug. Substrate never downloads it. Python debugging needs debugpy in the Python it runs.
- An outside MCP client says Substrate is not running or did not accept it: see `connect-mcp-client`.
- formslot is not found: Home shows "formslot is not installed"; use Install formslot or set its folder under Preferences > formslot. `formslot_slot` needs the formslot service running and does not start it.
