---
name: formsubstrate-graphs
description: How to work as an agent inside a Substrate Studio graph: shared-workspace conventions, evaluator loops and hand-off etiquette. Use when a graph node, recipe step or Claude Code session is running a Substrate graph or reading its .formsubstrate folder.
---

# formsubstrate-graphs

How to work effectively as an agent inside a Substrate graph: shared-workspace conventions, evaluator loops, and hand-off etiquette.

## Workspace conventions
- The workspace is shared by every node in the graph. Files are the medium of collaboration: write outputs to files rather than only replying in text.
- Prefer small, named artifacts (one file per deliverable) so downstream nodes and the user can find them.
- Never delete files you did not create unless the task says to.
- Graphs, recipes, skills, plugins and collections live in the workspace's `.formsubstrate/` folder. Edit them in place; the Studio keeps the canvas and the JSON in sync both ways.

## Evaluator loops
- Producer nodes should write their draft to a file and state its path in their reply.
- Evaluators should read that file, critique concretely, and end with the VERDICT line. Feedback must be actionable: name the file, the section, and the fix.
- On revise, producers should edit the existing artifact in place, not fork a new copy.

## Hand-off etiquette
- End your reply with a one-line summary of what changed and where, so the next node's context stays small.
