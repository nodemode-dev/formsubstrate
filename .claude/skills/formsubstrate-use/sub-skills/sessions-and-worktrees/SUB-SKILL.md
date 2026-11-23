---
name: sessions-and-worktrees
description: Start and manage Claude Code agent sessions in Substrate. Covers the New Agent Session dialog, interactive versus headless mode, permission modes, what a session worktree and branch are, session states, resume, stop and remove, and what a session is given (MCP servers and environment).
---

# sessions-and-worktrees

## Purpose

Start an agent session the right way and explain where its work lives, so the person can let several agents work at once without any of them touching their own files.

## What a worktree is

A git worktree is a second checkout of the same repository in another folder, on its own branch. Each session gets one: branch `sf/[session id]`, folder under `worktrees/` in Substrate's data folder (see `references/places-and-fixes.md` at the pack root). The agent edits only that folder. The person's own working copy is never touched by a session; work reaches it only through review and git.

## Start a session

1. Agents > New Claude Code Session (`Shift+Ctrl+A`, `Shift+Cmd+A` on macOS), or New Claude session on Home. The dialog is New Agent Session.
2. Title: what this agent works on.
3. Agent: Claude Code, Codex, Cursor or Antigravity. Each row shows where the program was found and its version, or "Not found. Install it with:" and the install line; a program that was not found cannot be picked. A program installed elsewhere gets its path under Preferences > Agents > Agent programs. The note under the rows says what the picked program gets (see "Other agent programs" below).
4. Mode:
   - Interactive: a Claude Code terminal. A terminal tab opens in the dock running `claude` in the worktree; the person talks to it there.
   - Headless: run a prompt and stream. Type the Prompt; Substrate runs `claude -p` and streams the transcript. No person approves tools, so the Permission mode decides what it may do.
5. Permission mode (headless only; described here for Claude Code):
   - Accept edits (the default): file edits inside the worktree are accepted; shell and other tools are denied.
   - Ask (default): every edit and tool needs approval, which a headless session cannot give, so they are denied.
   - Plan only: the agent plans and reads; nothing is changed.
   The default for new headless sessions is set in Preferences > Agents.
6. Base branch: blank means HEAD, the current commit.
7. Start session.

## Other agent programs

Every session gets its own worktree, branch and terminal whichever program runs it, and its row names the program when it is not Claude Code (for example "Codex interactive"). What differs:

- Claude Code gets the session MCP servers and the gate cards.
- Codex gets the session MCP servers. Gate cards need Claude Code, so its writes are not gated.
- Cursor and Antigravity are started plainly in the worktree: they do not get the session MCP servers, and their writes are not gated.
- Headless permission modes: Codex has all three (Accept edits is its workspace-write sandbox; Ask and Plan only are its read-only sandbox). Cursor has Ask (it proposes changes and does not apply them) and Plan only, and no Accept edits. Antigravity has Accept edits and Plan only, and no Ask. The select shows only the modes the program has.
- Graph runs in Studio always use Claude Code.

Review, comments and commits work the same for all four, because they read the worktree. Say plainly that an ungated session should be reviewed with more care. The three other programs were checked with stand-in programs, not the real ones.

## Claude Code in the editor, and FormNET

- Preferences > Agents > Claude Code in the editor > Connect Claude Code to this window is off by default. When on, Claude Code started in a Substrate terminal can read the Problems list, the open files and the selection, open a file, and show a proposed change in a tab with Accept and Reject. It listens on this computer only. It has been run against a stand-in client only, not Claude Code itself; say so when someone asks whether it works.
- Preferences > Terminal > Route through FormNET is off by default. When on, terminals and sessions opened from then on use the FormNET proxy on `127.0.0.1:8761`; open terminals are not changed, and when the proxy does not answer new terminals start without it.

Terminal > New Claude Code Terminal is different: it runs `claude` in the open workspace itself, with no worktree and no session record. Use a session for agent work that should be reviewed.

## Watch and manage

- The Sessions section on the left, Agents > Agent Sessions, and Home list sessions. States: working, needs-input, done, failed, stopped.
- Row actions: open, review (opens the review pane on that session), resume, stop, remove.
- Remove asks to confirm Remove worktree: the worktree and its branch are deleted from disk. If the worktree has uncommitted changes the engine refuses and the window asks Remove it anyway.
- Terminals live in a separate pty-host process, so a Claude Code tab keeps running through an engine restart and the window reconnects. Resume restarts Claude Code with `claude --resume` in the same worktree.

## What a session is given

- `.formsubstrate/mcp.json` in its worktree, offering formMCP, formslot and Substrate's own MCP server, plus enabled MCP servers added under Extensions > MCP that are set to be offered to sessions (an HTTP server that needs secret headers is not written into the file). Anything not found is left out and said in the session notes; for example a packaged app without the `formsubstrate` launcher beside its engine runs sessions without Substrate's own server.
- Environment: `FORMSUBSTRATE_ENGINE`, `FORMSUBSTRATE_SESSION`, `FORMSUBSTRATE_WORKTREE`, `FORMSUBSTRATE_REPO` and `FORMSUBSTRATE_GATE_TOKEN`. The gate token is the session's MCP credential and sees only that session; it cannot answer the session's own gates.
- A settings file with attribution off and the gate hook, and a commit hook in the worktree that applies the stored identity and strips attribution trailers.

The list above is what a Claude Code session is given. The files are written for every program, but only Claude Code reads the settings file with the gate hook; Codex is handed the MCP servers on its command line, and Cursor and Antigravity use neither.

An agent inside a session that wants to read Substrate loads `read-with-mcp`.

## Gate

The session appears in the Sessions section with a state, its branch is `sf/[session id]`, and the person knows the next step is review (`review-and-commit`).

## Owned resources

None.
