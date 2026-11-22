# HASHOUT_LOG · backend/app/models + routers/graphs.py (Studio graphs) · formsubstrate

Living log for the graph document model, the saved-graph routes and the preset graphs behind the Studio. Source files stay comment-free; what they would have said lives here.

Current build version: v0.20.0
Last updated: 2026-11-22

### backend/app/models/graph.py · GraphDoc, check_doc

- refers-to: backend/app/models/graph.py :: GraphDoc, GraphNode, GraphEdge, check_doc
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Ported from substrata backend/app/models/graph.py (MIT, owner's). substrata's model listed six node kinds (start, agent, tool, evaluator, yield, end) although its runner and its window already used ten, so a saved branch, foreach, transform or call_graph graph could not pass the model; all ten are accepted here. The edge source field is declared with the alias `from` (pydantic `from_`), replacing the `__init__` that rewrote the key. `check_doc(raw)` returns `(doc, errors, warnings)`: errors block a save (schema errors from pydantic, duplicate node or edge ids, edges to unknown nodes or from a node to itself, an edge into a start node or out of an end node, foreach parallel outside 1 to 8, a yield event type outside manual, delay, watch, webhook and approval, a delay under one second, retries outside 0 to 10, an unknown on_error); warnings never block (no start or no end node, more than one start, a route label that is not one of the node's routes, a tool node without a tool, a branch or foreach without its expression, a foreach without an each edge, a call_graph without a saved graph, on_error route without an error edge). The substrata run models (RunEvent, RunResult) are not here; the running side owns them.

### backend/app/routers/graphs.py · routes

- refers-to: backend/app/routers/graphs.py :: router
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Mounted under `/api` behind LocalGuard. Reads: `GET /graphs/kinds` (the node catalogue: kind, label, help, ports, routes, plus the route, yield-event and on-error tables), `GET /graphs/presets` and `/graphs/presets/{name}`, `GET /graphs` (saved graphs in `<workspace>/.subform/graphs` with node and edge counts and a valid flag), `GET /graphs/{name}` (the file text and mtime), `POST /graphs/validate` (errors and warnings, no state change). Owner-only (window token `X-Subform-Window`): `PUT /graphs/{name}` (validates, answers 422 with the first six errors on failure, 409 when `expectedMtime` no longer matches or when `create` is set and the file exists, atomic write through a temp file in the same folder), `DELETE /graphs/{name}`, `POST /graphs/presets/{name}/install` (409 when a graph of that name is saved, so an install never overwrites). Names are `[A-Za-z0-9][A-Za-z0-9._-]{0,79}` so a name cannot carry a path; the folder goes through `workspace_root.resolve(..., write=True)` so it cannot leave the workspace. The substrata `.substrata/graphs` folder is `.subform/graphs` here.

### backend/app/templates/graphs · presets

- refers-to: backend/app/templates/graphs/*.json; backend/app/routers/graphs.py :: PRESETS
- kind: rationale
- logged: v0.14.0 · 2026-10-31

The preset graphs live under `templates/` because `setup/freeze_backend` already ships that folder with the frozen engine; a new data folder would have needed a packaging change. Four are substrata's presets (producer-critic-revise, bench-review, gated-deploy, watch-pipeline; MIT, owner's, `backend/presets/graphs`) with the author's product name removed from the descriptions, and foreach-review is new and shows branch, foreach and transform together. The tool name `run_shell` in gated-deploy is substrata's; it names whatever tool the running side offers.
