---
name: graph-runs
description: Build and run Studio graphs in Substrate and find their runs afterwards. Covers Studio, the Runs tab, Simulator and Claude modes, approvals for waiting steps, run worktrees on sf/run branches and their review, recipes and triggers, the Automation and Activity panels, where runs are saved, and the run_list and run_status MCP tools.
---

# graph-runs

## Purpose

Run an agent graph safely and know where to look while it runs, when it waits, and after it finishes.

## Build

- View > Studio (`Alt+Shift+S`, `Option+Shift+S` on macOS) opens the node canvas; View > New Graph creates a graph. Graphs are saved in `.formsubstrate/graphs` in the project.
- Drag nodes from the palette and wire them; the canvas also works from the keyboard. A graph needs a start node.

## Run

1. Open the Runs tab on the right, or Run Graph (`Alt+Ctrl+R`, `Option+Cmd+R`).
2. Type a task, choose a mode, press Run.
   - Simulator runs the graph with no model. Use it to check a graph's shape; without tool nodes it needs no trust.
   - Claude runs each agent through the local `claude` command and needs a trusted workspace (see `workspace-and-trust`). Graphs with tool nodes also need trust.
3. A step set to "Wait for approval before running", or one that needs a decision before a shell command or file write, parks the run. A toast says "Run waiting" and the Approvals tab on the right shows one card per waiting step with an Approve button.

## Where a run's work goes

- A Claude run that can edit files works in its own worktree on branch `sf/run-[run id]`, behind the same formslot gate as a session (see `gate-cards`).
- When it finishes, Review run changes in the Runs tab opens the review pane on that worktree; accept, reject and commit as for a session (see `review-and-commit`).
- The Node tab inspects any node: what it did in a run and its run settings.

## Where to see runs

- Runs tab: the runs of the open workspace, live and finished.
- Approvals tab: runs parked on a step.
- Automation tab (right panel): runs that triggers started.
- Activity (right panel): a live feed that includes Studio runs.
- On disk: saved runs are JSON files under `runs/[workspace key]/` in the data folder, one per run id (see `references/places-and-fixes.md` at the pack root).
- From an agent: `run_list` returns the workspace's runs (or the session worktree's, with a session token), newest first, at most the last 100, with id, status, graph name, task, mode, event count, token usage and what a parked run waits on. `run_status` with a run id (10 lowercase hex digits) adds each node's visit count, last state and error, and the most recent events. Neither returns node inputs or outputs, and neither starts, resumes or cancels a run; those are window actions.

## Recipes and triggers

- A recipe is a graph plus a task template and declared inputs, run from a form: the Recipes section on the left, or New Recipe....
- A trigger starts a recipe or graph: every N seconds (at least 10), once after N seconds, when files matching a pattern change (for example `src/**`), or a signed webhook at `/api/hooks/[id]` on the engine, with a secret of 24 or more characters and the `X-FormSubstrate-Signature`, `X-FormSubstrate-Timestamp` and `X-FormSubstrate-Nonce` headers. The engine listens on this computer only.
- Triggers run only while Substrate is open; one due while closed shows "missed while the app was closed" and does not catch up. A recipe changed after its trigger was made must be confirmed again. Triggers need trust to run Claude or tool nodes.

## Gate

The person can name the run's mode, its status, where its changes are (`sf/run-[run id]` or none), and which tab shows it.

## Owned resources

None.
