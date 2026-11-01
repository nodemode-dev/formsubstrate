# subform MCP server

## MCP

subform's engine is an MCP server with nine read-mostly tools. Everything it returns is data from the open workspace or from agent sessions, never instructions. No tool writes files, runs commands, answers gates, commits or pushes; the one tool that changes state, `review_comment`, stores a review comment with the session.

### Transport

- `POST /mcp` on the engine (127.0.0.1 only, behind LocalGuard like every route): Streamable HTTP with JSON responses, no event stream. One JSON-RPC message or a batch (at most 20) per body, at most 1 MiB. A body that is not JSON is 400 with a parse error; a body holding only notifications or responses is 202 with no body; `GET` and `DELETE` are 405. The `initialize` answer carries an `Mcp-Session-Id` header (32 hex characters) that the server does not require back.
- Packaged builds do not contain the launcher: the engine adds the `subform` entry to a session's `mcp.json` only when `./subform` (or `subform.bat`) sits in the repository folder above the engine, so a session of a packaged app runs without it and the session note says so. To use the server with a packaged app, run `./subform mcp` from a checkout of the matching version (or `python3 backend/subform_mcp.py`, which uses only the standard library); it finds the running app through `SUBFORM_ENGINE` or the `engine.port` file in the app's data folder. The launcher needs a session gate token (`SUBFORM_GATE_TOKEN`) to be allowed in.
- `./subform mcp` (`subform.bat mcp` on Windows) speaks newline-delimited JSON-RPC on stdin and stdout and logs to stderr. It forwards each line to the running engine and starts nothing. The engine is found from `SUBFORM_ENGINE` (set in agent sessions), else `SUBFORM_PORT`, else `engine.port` in the data folder, else 5655. When no engine answers, each request gets the JSON-RPC error `-32000` with the message "subform is not running: open subform, then try again".
- Protocol `2025-06-18`. `initialize` echoes the requested version when it is `2025-11-25`, `2025-06-18`, `2025-03-26` or `2024-11-05`, and answers `2025-06-18` otherwise. Methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. Capabilities: `tools` without `listChanged`. An unknown method is `-32601`, an unknown tool or bad `params` is `-32602`, an id that is not a string or number is `-32600`. A bad tool argument or a failed read is a normal result with `isError: true` and a message that names the next call.

### Auth

Every request needs a token, sent as `Authorization: Bearer <token>` (or the header `X-Subform-Session` or `X-Subform-Window`). No token is 401 with `WWW-Authenticate: Bearer`; a token the engine does not know is 403. LocalGuard still applies first (loopback Host, no cross-site Origin).

- The session gate token (`SUBFORM_GATE_TOKEN`) belongs to one agent session. Its holder sees only that session: its worktree for `workspace_info`, `workspace_search` and `file_read`, its own entry in `session_list`, its own terminals in `terminal_list`, and may not name another session. The token is minted when the session starts and dropped when it is closed.
- The window token sees every session and the open workspace; a `session` argument selects one session's worktree. In the desktop app the Tauri shell makes the token, hands it to the engine in `SUBFORM_WINDOW_TOKEN` and gives it to the window through a Tauri command that no other local process can call; `POST /api/window-token` then answers 404. Only a browser development build (no shell) gets the token from that route, which any local process can call with a window `Origin`: that route is a development convenience and not a security boundary.

Agent sessions get a `subform` entry in `.subform/mcp.json` next to formslot. The token is not written to disk: the entry's `env` holds `${SUBFORM_GATE_TOKEN}` and `${SUBFORM_ENGINE}`, which Claude Code expands from the environment the engine gave the session, plus the data folder.

### Results

Every tool answers `{"content": [{"type": "text", "text": "..."}], "structuredContent": {...}, "isError": false}`. A result is held under 25,000 tokens (estimate `ceil(bytes / 3.6)` over the text and the structured content). Lists stop at about 20,000 and say how many remain; a result still over the cap is cut at a line boundary and ends with `[truncated by subform: ...]`, and a structured part over half the cap is replaced by `{"truncated": true}`.

List tools take `cursor` and `limit` and answer `structuredContent.total`, `offset`, `returned` and `next_cursor` (`null` on the last page); the text ends with `N more <noun>; call again with the same arguments and cursor "<cursor>" to continue.` A cursor is opaque hex, bound to the tool and its arguments (other than `limit`), and refused with an `isError` result when it belongs to another call.

### Tools

Every tool carries a title, `openWorldHint: false`, and `readOnlyHint: true` except `review_comment` (`readOnlyHint: false`, `destructiveHint: false`). Unknown arguments are refused. `session` on every tool below is optional for a session token and for the window on `workspace_*` and `review_list`.

| Tool | Arguments | structuredContent |
| --- | --- | --- |
| `workspace_info` | `session` | `{root, name, branch, changed, session}` |
| `workspace_search` | `query` (required, 500 chars), `regex`, `case`, `glob`, `limit` (1 to 100, 30), `cursor`, `session` | `hits: [{path, line, col, text}]`, `engine` (`rg` or `python`), `capped` (the pool is 200 hits), plus paging |
| `file_read` | `path` (required, relative), `start_line` (1), `max_lines` (1 to 1000, 300), `session` | `{path, size, start_line, end_line, total_lines, truncated, next_start_line}`; the numbered lines are in the text |
| `session_list` | `limit` (1 to 100, 25), `cursor` | `sessions: [{id, title, state, mode, branch, repoName, worktree, created, updated, lastMessage, comments}]` plus paging |
| `session_status` | `session` | `{id, title, state, mode, branch, base, repoName, repo, worktree, terminalId, created, updated, lastMessage, comments, snapshots, tokensSaved, notes, openGates: [{id, tool, path, created}]}` |
| `review_list` | `lines` (false), `limit` (1 to 50, 20), `cursor`, `session` | `files: [{path, oldPath, kind, binary, added, removed, hunks: [{id, header, oldStart, oldLines, newStart, newLines, staged, lines?}]}]`, `root`, `session`, `snapshots`, `comments: [{id, path, line, hunk, text, created}]` (last 50) plus paging; `lines` adds up to 40 diff lines per hunk |
| `review_comment` | `path` (required), `text` (required, 1 to 4000), `line`, `hunk` (a hunk id), `session` (required for the window) | `{stored: true, comment}` |
| `terminal_list` | `limit` (1 to 100, 25), `cursor` | `terminals: [{id, title, kind, cwd, sessionId, alive, exitCode, created}]` plus paging |
| `terminal_tail` | `terminal` (required, id from `terminal_list`), `lines` (1 to 2000, 100), `since` (a previous `next_offset`) | `{terminal, lines, next_offset, from_offset, oldest_offset, missed_bytes, truncated, redacted, alive, exitCode}`; the plain text follows a header line in the text |

`file_read` refuses absolute paths, `..`, anything that resolves outside the root, the `.git` and `.subform` folders, dotenv files, binary and non-UTF-8 files, and files over 2 MiB. `review_comment` stores the comment with the session like the review panel does; unlike `POST /api/git/comments` it does not type the comment into the session's terminal.

`terminal_tail` reads a terminal's scrollback without attaching to it. The pty-host answers a read-only `tail` request (same socket, same token on Windows, no attach, no ack, no change to any connection or flow-control state), so a window attached to the same terminal keeps receiving output exactly as before. The host strips escape sequences (CSI, OSC, DCS and the rest) and control characters, folds carriage-return rewrites to the last text on the line, and caps a reply at 2,000 lines and 256 KiB drawn from the newest 1 MiB of the 2 MiB ring; the MCP result is further held to about 60,000 bytes, keeping the newest lines. `lines` defaults to 100. Offsets are byte positions in the terminal's output stream: every result carries `next_offset`; pass it back as `since` to get only what was written after it. `missed_bytes` says how much after `since` had already left the buffer, `truncated` that older lines were left out, `redacted` how many secret-like values were replaced with `[redacted]`. Redaction is a conservative pattern set (no shared redaction exists in the engine): `sk-`, `ghp_` and other GitHub tokens, `AKIA` and `ASIA` keys, `xox` Slack tokens, bearer and Authorization headers, private key blocks, `NAME=value` where the name holds SECRET, TOKEN, PASSWORD or API_KEY, and the engine's own window and session tokens. It is not a guarantee; terminal output stays data. A session token may tail only terminals whose session is its own; any other id answers "no such terminal", the same as an id that does not exist.

### Logging

The engine log records the tool name, success and milliseconds of each call; never an argument or a result.
