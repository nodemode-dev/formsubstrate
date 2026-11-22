# Substrate MCP tools for users

Read from `TOOLS` in `backend/app/services/mcp_tools.py` and the client rule in `call_tool` at the time of writing. Tools are still being added: the live `tools/list` answer is the authority, and when the `formsubstrate-harness` pack is installed beside this one, its generated `references/tools.md` carries every input schema. Do not quote a total.

## Contents

- Callers
- Tools
- Paging and limits
- Auth errors

## Callers

- S: a session gate token (`FORMSUBSTRATE_GATE_TOKEN`). Sees only its own session and worktree.
- W: the window token. Sees every session and the open workspace; `session` picks a session worktree.
- C: an outside client token from Preferences > Agents > MCP clients (`FORMSUBSTRATE_MCP_TOKEN`). Read-only tools that are not `terminal_` tools; `session` only on `session_status`.

## Tools

Every tool has `openWorldHint` false and is read-only except `review_comment`.

| Tool | What it answers | Main arguments | S | W | C |
| --- | --- | --- | --- | --- | --- |
| `workspace_info` | Root, name, branch and changed file count | `session` | yes | yes | yes, no `session` |
| `workspace_search` | Content search (ripgrep), confined to the root | `query` (required), `regex`, `case`, `glob`, `limit`, `cursor`, `session` | yes | yes | yes, no `session` |
| `file_read` | A UTF-8 text file, numbered by line | `path` (required), `start_line`, `max_lines`, `session` | yes | yes | yes, no `session` |
| `session_list` | Agent sessions, newest first | `limit`, `cursor` | own only | all | all |
| `session_status` | State, branch, worktree, last message, comment count, open gates | `session` | own only | yes | yes |
| `review_list` | Changed files and hunks awaiting review, plus recorded comments | `lines`, `limit`, `cursor`, `session` | yes | yes | yes, no `session` |
| `review_comment` | Stores a review comment on a file, line or hunk; types nothing into a terminal | `path`, `text` (required), `line`, `hunk`, `session` | yes | yes, names the session | no |
| `terminal_list` | Terminals held by the pty-host | `limit`, `cursor` | own only | all | no |
| `terminal_tail` | Plain-text scrollback, secrets redacted; `since` takes the previous `next_offset` | `terminal` (required), `lines`, `since` | own only | yes | no |
| `run_list` | Graph runs, newest first, last 100 at most | `limit`, `cursor`, `session` | yes | yes | yes, no `session` |
| `run_status` | One run: nodes, last states, errors, recent events | `run` (required), `events`, `session` | yes | yes | yes, no `session` |
| `gate_notes` | Gate hook notes for a session: slot overlaps and skipped gates | `limit`, `cursor`, `session` | own only | names the session | not usable (needs `session`) |
| `formslot_slot` | Slots and units covering one file, and its drift state | `path` (required), `session` | yes | yes | yes, no `session` |
| `problems` | Language-server problems: one file's problems with `path`, or the files that have problems without it; only while a language server is open in the window for that folder, and only servers that push diagnostics | `path`, `severity`, `limit`, `cursor`, `session` | yes | yes | yes, no `session` |

## Paging and limits

- List tools take `limit` and `cursor` and answer `total`, `offset`, `returned` and `next_cursor` (null on the last page). A cursor belongs to one tool and one set of arguments.
- A result is held under about 25,000 tokens; an over-long text ends with `[truncated by Substrate: ...]`.
- Unknown arguments are refused. A bad argument is an `isError` result that names the next call.
- Session ids are 16 lowercase letters and digits; run ids are 10 lowercase hex digits.

## Auth errors

- No token: HTTP 401 with `WWW-Authenticate: Bearer`.
- Unknown or revoked token: HTTP 403.
- The stdio launcher turns either into JSON-RPC `-32001` telling the person to add a client in Preferences.
