---
name: review-and-commit
description: Review an agent session's changes in Substrate and keep or discard them. Covers the review pane and its Target list, accepting and rejecting hunks and files, comments sent to a session, committing with the stored identity, snapshots and rewind, Push and Sign and Push, and removing a session's worktree.
---

# review-and-commit

## Purpose

Take a session's work from its worktree to a commit the person is willing to sign, or throw it away cleanly.

## Open the review

1. Git > Review Changes, the Review changes tile on Home, or review on a session's row in the Sessions section.
2. In the Target list pick the workspace or a session. The pane shows its uncommitted changes as hunks.
3. If the pane says "the file changed; reload the review", the file moved under you; reload before acting.

## Decide per hunk

- Accept stages the hunk in the target's index; Reject reverts it in the target's files. Renamed, deleted, new, untracked and binary files are accepted or rejected whole (Accept file, Reject file).
- A reject takes a snapshot first, so it can be rewound.
- Write a comment on a hunk to send it to that session: it is stored with the session and typed into its terminal as "Review comment on [path]:[line]: [text]", so the agent can act on it. The MCP tool `review_comment`, by contrast, only stores the comment and types nothing.
- Read every file marked "Gate skipped" or "Written by Bash, overlaps slot" by hand (see `gate-cards`).

## Commit

- Accept all and commit stages everything in the target and commits with the message from Source Control.
- The Source Control section (Git > Git Status) has the commit box (`Ctrl+Enter`, `Cmd+Enter` on macOS), Commit All, Take Snapshot and Rewind, Push and Sign and Push.
- A commit on a session target lands on that session's branch `sf/[session id]` in its worktree. Substrate does not merge it into another branch; merge or push that branch with git when ready.
- Every commit made from Substrate, by the person or by an agent, uses the name and email in Preferences > Git and Identity (or the global git identity when none is set; refused when neither exists). Attribution trailers such as `Co-Authored-By:` are removed. A commit an agent made under another identity, with a trailer, or past the hook is flagged.

## Snapshots and rewind

Git > Take Snapshot saves the current state; Rewind returns to a snapshot. Rewind is refused while a session is working.

## Push

- Push runs `git push` to the remote you pick.
- Sign and Push (Git > Sign and Push) re-signs and cleans the unpushed commits, checks them, then runs `git fetch` and `git push`. It refuses ranges with merge commits or other authors. History is rewritten only when it is clicked. Signing uses the SSH public key path from Preferences; Substrate never reads or stores the private key.
- Nothing is pushed or fetched in the background.

## Discard a session's work

- Some of it: Reject the hunks or files in the review pane.
- All of it: in the Sessions section choose remove on the row. Remove worktree deletes the worktree and its branch from disk; with uncommitted changes the window asks Remove it anyway. Commit anything worth keeping first.

## Gate

The person names what was accepted, what was rejected, the commit's branch, and whether anything was pushed.

## Owned resources

None.
