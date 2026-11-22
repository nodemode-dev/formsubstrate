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
3. Mode:
   - Interactive: a Claude Code terminal. A terminal tab opens in the dock running `claude` in the worktree; the person talks to it there.
   - Headless: run a prompt and stream. Type the Prompt; Substrate runs `claude -p` and streams the transcript. No person approves tools, so the Permission mode decides what it may do.
4. Permission mode (headless only):
   - Accept edits (the default): file edits inside the worktree are accepted; shell and other tools are denied.
   - Ask (default): every edit and tool needs approval, which a headless session cannot give, so they are denied.
   - Plan only: the agent plans and reads; nothing is changed.
   The default for new headless sessions is set in Preferences > Agents.
5. Base branch: blank means HEAD, the current commit.
6. Start session.

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

An agent inside a session that wants to read Substrate loads `read-with-mcp`.

## Gate

The session appears in the Sessions section with a state, its branch is `sf/[session id]`, and the person knows the next step is review (`review-and-commit`).

## Owned resources

None.
