---
name: connect-mcp-client
description: Connect an MCP client started outside Substrate (Claude Code in a terminal, Codex, Cursor) to Substrate's MCP server. Covers Preferences > Agents > MCP clients, adding a client, the token shown once, the config snippet, FORMSUBSTRATE_MCP_TOKEN, how the launcher finds the engine, what a client may read, revoking, and the errors it shows.
---

# connect-mcp-client

## Purpose

Give a program outside Substrate read access to the open workspace and the session list, with a token the person approved and can revoke.

Inside a Substrate session none of this is needed: the session already has its own gate token (see `sessions-and-worktrees`).

## Add a client

1. In Substrate open File > Preferences... (`Ctrl+,`), page Agents, card MCP clients.
2. Type a Client name, 1 to 80 characters (for example "Claude Code in my terminal"), and press Add client. At most 50 clients can be approved at once.
3. The Token field shows the token once. It starts with `fsmcp_`. Press Copy token, or pick Config for (Claude Code and Cursor (JSON), or Codex (TOML)) and press Copy config.
4. The token leaves the page when you move away from the card, and the engine keeps only its SHA-256, so it cannot be shown again. A lost token means remove the client and add a new one.

## Configure the client

The snippet names the server `formsubstrate`, a command, one argument and the token in `FORMSUBSTRATE_MCP_TOKEN`:

- From a source checkout: command `./formsubstrate`, argument `mcp` (Windows: `formsubstrate.bat mcp`). Use the checkout's full path when the client starts elsewhere.
- In the built app: the `formsubstrate-engine` program inside the installed app, by its full path, with `--mcp`.

JSON form (Claude Code, Cursor):

```json
{"mcpServers": {"formsubstrate": {
  "command": "[full path to formsubstrate or formsubstrate-engine]",
  "args": ["[mcp or --mcp]"],
  "env": {"FORMSUBSTRATE_MCP_TOKEN": "[token]"}
}}}
```

TOML form (Codex):

```toml
[mcp_servers.formsubstrate]
command = "[full path to formsubstrate or formsubstrate-engine]"
args = ["[mcp or --mcp]"]
env = { FORMSUBSTRATE_MCP_TOKEN = "[token]" }
```

Keep the file holding the token out of any repository. The launcher reads `FORMSUBSTRATE_GATE_TOKEN` first and `FORMSUBSTRATE_MCP_TOKEN` only when that is empty, so do not start an outside client from inside a session terminal expecting the client token to be used.

## How the launcher reaches Substrate

The stdio launcher starts nothing. It forwards each JSON-RPC line to the running engine's `POST /mcp` with `Authorization: Bearer [token]`, finding the engine from `FORMSUBSTRATE_ENGINE`, else `FORMSUBSTRATE_PORT` on 127.0.0.1, else the `engine.port` file in the data folder (`FORMSUBSTRATE_DATA_DIR` overrides where that is), else port 5655. Substrate must be open.

Protocol: MCP 2025-11-25 and 2025-06-18 through `initialize` (2025-03-26 accepted). A client pinned to 2026-07-28 cannot connect; one that falls back to `initialize` can.

## What a client may do

- Read the open workspace: `workspace_info`, `workspace_search`, `file_read`, `review_list`, `run_list`, `run_status`, `formslot_slot`, `problems`, all without a `session` argument.
- Read every session in `session_list` and `session_status` (the only tool that takes `session` from a client).
- Never: a tool whose `readOnlyHint` is false (such as `review_comment`), any `terminal_` tool, or a `session` argument elsewhere. `gate_notes` needs a session, so it is not usable by a client. Refused calls answer `isError` naming what a client may use.

The rule is computed from the tool annotations, so a tool added later falls under it by its own `readOnlyHint`; `references/mcp-tools.md` at the pack root lists every tool.

## Revoke and inspect

- The card lists each client with its created and last used times (last used is written at most once a minute). Remove revokes the token at once.
- The engine stores id, name, times and the token's SHA-256 in `mcp-clients.json` in the data folder, readable by the user only.

## Errors the client shows

- `-32000` "Substrate is not running: open Substrate, then try again": no engine answered.
- `-32001` "Substrate did not accept this client: in Substrate open Preferences, Agents, MCP clients, add a client, and set FORMSUBSTRATE_MCP_TOKEN to the token it shows": the engine answered 401 (no token) or 403 (unknown or revoked token).

## Gate

The client's `tools/list` succeeds, a `workspace_info` call returns the open workspace, and the token appears in no tracked file.

## Owned resources

None.
