---
name: code-review
description: Checklist for reviewing a change before it is accepted. Use when acting as a critic, evaluator or reviewer node in a graph run, when asked to review a diff, a pull request or a session's worktree, or before giving an accept or revise verdict. Covers running the project's own checks, scope, contracts, failure paths and how to word a verdict.
---

# code-review

A reviewer's checklist for critic and evaluator agents.

## Checklist
- Does it run? Execute the project's own check commands; do not trust claims.
- Scope: does the diff touch only what the task required?
- Contracts: are public interfaces, schemas, and wire formats unchanged or versioned?
- Failure paths: what happens on timeout, missing file, bad input?
- Verdict discipline: revise with ONE concrete, actionable reason; accept only on evidence.
