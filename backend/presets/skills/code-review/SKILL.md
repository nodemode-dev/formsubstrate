---
name: code-review
description: A reviewer's checklist for critic and evaluator agents.
---

# code-review

A reviewer's checklist for critic and evaluator agents.

## Checklist
- Does it run? Execute the project's own check commands; do not trust claims.
- Scope: does the diff touch only what the task required?
- Contracts: are public interfaces, schemas, and wire formats unchanged or versioned?
- Failure paths: what happens on timeout, missing file, bad input?
- Verdict discipline: revise with ONE concrete, actionable reason; accept only on evidence.
