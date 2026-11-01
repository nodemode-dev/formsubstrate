# HASHOUT_LOG · frontend/src/ui/studio (Studio tab) · subform

Living log for the Studio: the node canvas where agent graphs are built. Covers `frontend/src/ui/studio/`, the graph engine in `frontend/src/engine/`, the saved-graphs sidebar in `frontend/src/extensions/studio/`, the styles in `frontend/src/styles/studio.css` and the engine calls in `frontend/src/io/studio.ts`. Source files stay comment-free; what they would have said lives here.

Current build version: v0.14.0
Last updated: 2026-10-31

### frontend/src/ui/studio/api.ts · studio (API for port-runs)

- refers-to: frontend/src/ui/studio/api.ts :: studio, StudioAction
- kind: explainer
- logged: v0.14.0 · 2026-10-31

The running side (port-runs) talks to the Studio only through `import { studio } from '../../ui/studio/api'` (or the re-export in `ui/studio/index.ts`). There is one hub and one graph document per window; the Studio tab is a view of it, so the API works whether or not the tab is open.

Document:
- `studio.getDoc(): GraphDoc` the current document (read only; never mutate it, dispatch commands).
- `studio.toText(): string` the pretty-printed JSON, the same text the code pane shows.
- `studio.loadFromText(text, origin = 'system'): { ok: true, doc } | { ok: false, errors }` parse, structurally validate and load as one undoable step.
- `studio.onChange(handler): () => void` fires after every change with `{ origin: 'canvas' | 'code' | 'system' }`; returns the unsubscribe.
- `studio.engine` the underlying `Engine` (`frontend/src/engine/index.ts`) for `dispatch(cmd, origin)`, `dispatchMany(cmds, origin)`, `replace(doc)` (load without undo history and mark saved), `undo()`, `redo()`, `dirty`, `markSaved()`.

Node status (the canvas paints these in place, no rebuild):
- `studio.setNodeStatus(nodeId, 'running' | 'done' | 'error' | 'parked' | null)`, `studio.clearStatus()`, `studio.onStatus(handler)`.
- Or dispatch window events: `subform:run-event` with `detail { node_id, phase }` where phase is `enter` (running; earlier running nodes are not touched, send `exit` for them), `exit` and `loop` (done), `yielded` and `parked` (parked), `halt` and `error` (error); an explicit `detail.status` wins. `subform:run-finished` clears every status. These names replace substrata's `substrata:run-event` and `substrata:run-finished`.

Selection and opening:
- `studio.selection` (`{ kind: 'node' | 'edge', id } | null`), `studio.select(sel)`, `studio.onSelect(handler)`; the window event `subform:studio-select` carries the same value in `detail`.
- `studio.fileName` / `studio.fileMtime` name the saved graph the document came from (`.subform/graphs/<name>.json`) or null when it was never saved.
- `studio.open(name | null): Promise<boolean>` opens the Studio tab, loading the saved graph `name` first when given (asks before discarding unsaved changes). The window event `subform:studio-open` with `detail { name }` does the same. `subform:studio-graphs-changed` is dispatched after a save, delete or install and refreshes lists; call `studio.graphsChanged()` if your code writes a graph file.

Toolbar slot:
- `studio.registerAction({ id, label, icon, title?, run, enabled? }): () => void` adds a button at the right end of the Studio toolbar (icon is a name in `ui/icons.ts`). The Run button belongs there. `enabled` is read on every document change.

Saved graph file shape: the `GraphDoc` JSON (`version: 1`, `name`, `nodes`, `edges`), 2-space indented, written by `PUT /api/graphs/{name}` (window token). `GET /api/graphs/{name}` returns `{ name, path, text, mtime }`; `GET /api/graphs` lists them. A runner that needs a saved graph by name (call_graph) can read `.subform/graphs/<name>.json` through the workspace root.

### frontend/src/engine/index.ts · Engine

- refers-to: frontend/src/engine/index.ts :: Engine
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Ported from substrata frontend/src/engine (state.ts, commands.ts, events.ts, serialize.ts, index.ts; MIT, owner's). Kept: the canonical `GraphDoc`, command objects applied to a cloned draft, snapshot undo and redo (200 deep), the typed event bus, JSON as the code view, `loadFromText` as the code to model path. Changed: `validateDoc` accepts all ten node kinds (substrata's list stopped at six, so a saved branch or foreach graph failed to load), checks duplicate edge ids and config shape; `add_node` and `add_edge` take an optional id so a spawn and its first edge are one undo step; new `dispatchMany` (one undo step for several commands), `move_nodes` (auto layout is one step, substrata pushed one undo entry per node), `update_node` (label and config together); `add_edge` refuses an edge into a start node or out of an end node. Added `replace` (load without history), `dirty` and `markSaved`, and the node status map with `statusChanged`.

### frontend/src/ui/studio/canvas.ts · StudioCanvas

- refers-to: frontend/src/ui/studio/canvas.ts :: StudioCanvas
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Ported from substrata frontend/src/ui/components/graph.ts (MIT, owner's): pan and zoom, node cards with ports, bezier edges with a back-edge dip, edge label pills, wire drag from an out-port with a kind menu when dropped on empty canvas, minimap with a viewport box, fit, BFS auto layout, delete on Delete, rename on double click, context menus. substrata rebuilt the whole SVG with innerHTML on every change, pointer move and run event. Here everything is built once and patched: node cards are HTML elements keyed by node id and moved with `transform`, edges are keyed SVG paths (a thin visible path and a 14 unit transparent twin for hit testing), edge labels are keyed HTML pills placed at the bezier midpoint (computed from the control points, not `getPointAtLength`), and the minimap is keyed rects and lines. A node drag moves only its element and redraws only the edges that touch it, then commits one `move_node` on pointer up, so one drag is one undo step and the JSON view is not rewritten on every pixel (substrata dispatched a move per pointer event and filled the 200 step history). The dot grid is the stage background moved with three custom properties; the world layer is the only thing that pans, with `will-change: transform`. Run status classes (`is-running`, `is-done`, `is-error`, `is-parked`) are toggled on the existing element; an edge next to a running node gets the flowing dash. Arrowheads are three markers (normal, hot, selected) chosen with `marker-end` because `context-stroke` is not available in every webview subform ships in.

Behaviour additions over substrata: an edge dropped from an evaluator, branch or foreach gets the next unused route label (accept, revise; true, false; each, done) so the graph is runnable without typing labels; an edge can be selected and edited in the inspector; the node palette (click to add at the view centre, or drag onto the canvas); undo and redo keys on the canvas (they stop at the canvas so the editor's own undo is untouched); Escape cancels a wire.

### frontend/src/ui/studio/inspector.ts · Inspector

- refers-to: frontend/src/ui/studio/inspector.ts :: Inspector
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Ported from substrata frontend/src/extensions/inspector/index.ts (the per-kind node forms; MIT, owner's). It is part of the Studio tab here, as the right column, because the Studio cannot be used without it; the run inspector and the runs drawer stay with port-runs. All form controls for all ten kinds are built once and shown or hidden by kind, values are filled with a guard that skips the focused field, and a field commits on `change` (blur or Enter) in a single `update_node` step instead of an Apply button. Config keys are kept exactly as substrata wrote them so a runner built from substrata reads them unchanged: agent and evaluator `prompt`, `lean`; tool `tool`, `args`; yield `event { type, seconds | glob }`; branch `expr`; foreach `items`, `parallel` (1 to 8); transform `expr` and `template` (the unused one is the empty string); call_graph `graph`, `task`; flow control `retries`, `backoff_s`, `on_error` (halt, continue, route) on agent, tool, branch, foreach, transform and call_graph, written only when not the default. The tool name list comes from `GET /api/tools` when that route exists (port-runs or the tools port) and the field stays a free text box when it does not. The saved-graph picker for call_graph is fed by `GET /api/graphs` and patched as keyed options.

### frontend/src/ui/studio/studio-view.ts · StudioTab

- refers-to: frontend/src/ui/studio/studio-view.ts :: StudioTab
- kind: rationale
- logged: v0.14.0 · 2026-10-31

The Studio is a ViewDoc hosted by `Views` like the file graph and the diff tabs, with the fixed id `studio`, so a second open only shows the tab. Layout is fixed columns (palette, canvas, inspector) with a toolbar and a one line footer of fixed heights; the JSON pane sits to the right in split mode or takes the whole area in code mode; the mode is remembered in localStorage and switching it is a user action. The JSON view is a plain text area (substrata used CodeMirror): edits are parsed 280 ms after typing stops or on blur, a parse or structure error shows on the state line and nothing is loaded, a valid document equal to the current one is ignored, and a canvas change rewrites the text unless the change came from the text itself, so the caret never jumps while typing. Mod+S is the app's Save command: `Views.save` calls the tab's `save()`, which writes `.subform/graphs/<name>.json`. The graph name is the file name (letters, digits, dot, dash and underscore); renaming the graph and saving writes the new file and removes the old one after the new one is on disk. The tab title follows the graph name only while the Studio is the active tab, so a background load never steals focus. Closing the tab disposes the view but the document stays in the hub, so reopening shows it again.

### frontend/src/ui/studio/studio-file.ts · saveCurrent

- refers-to: frontend/src/ui/studio/studio-file.ts :: saveCurrent, loadSaved, newGraph
- kind: rationale
- logged: v0.14.0 · 2026-10-31

substrata saved a graph with a plain file PUT and loaded one by reading the file and calling `loadFromText`. Here saving goes to `PUT /api/graphs/{name}` with the window token so the engine validates the document first (a 422 with the first errors is shown as a toast) and answers warnings, and a changed-on-disk or already-exists conflict (409) becomes an Overwrite confirmation. Loading a graph over unsaved changes asks first.

### frontend/src/extensions/studio/index.ts · GraphsPanel

- refers-to: frontend/src/extensions/studio/index.ts :: GraphsPanel
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Ported from substrata frontend/src/extensions/graphs/index.ts (the saved graphs list; MIT, owner's). A "Graphs" sidebar section lists `.subform/graphs/*.json` with node counts and an invalid marker, opens a graph in the Studio on click, deletes with the row button, and offers the preset graphs (substrata's four plus a foreach example) under Presets: clicking one installs it into the workspace and opens it. Rows are keyed and patched in place. The View menu has Studio (Alt+Shift+S) and New Graph.

### frontend/src/styles/studio.css · layout

- refers-to: frontend/src/styles/studio.css :: .cv-st
- kind: warning-context
- logged: v0.14.0 · 2026-10-31

Everything that changes at run time sits in a fixed box: the toolbar and footer have fixed heights, the palette, inspector and JSON columns have fixed widths, the canvas fills the centre absolutely, the zoom row, minimap and its toggle are absolutely placed, and nodes have a fixed size (168 by 52) with the label ellipsised. Layers use `--z-raised` and `--z-selected` only; node colours are mapped from existing syntax and status tokens through a `--k` custom property per kind.

### frontend/src/extensions/runs/index.ts · RunsPanel (integration round)

- refers-to: frontend/src/extensions/runs/index.ts :: RunsPanel.paintParks, loadDetail, start, probeReview; frontend/src/ui/inspector/index.ts :: NodeInspector.show
- kind: rationale
- logged: v0.15.0 · 2026-10-31

Studio and runs were exercised together for the first time. The Studio toolbar already rendered `studio.registerAction` actions (the Run button) and the run streamed node status onto the canvas; what failed was around it. Parallel approvals: the panel showed only `parks[0]`, so two tool nodes in parallel were answered one at a time; each park is now a keyed card (`.rn-park[data-park]`) answered with its own id, and a pressed button is disabled until the call returns. Blank inspector: `loadDetail` could be overtaken by an older response (the tail finishing, the list refresh and the debounced reload all fetch the detail), leaving the inspector with a stale running snapshot; responses now carry a ticket and a stale one is dropped, and `NodeInspector.show` no longer resets the chosen visit when the same node is shown again after an engine change. Untrusted workspaces: the window checks before calling, and refuses Claude mode and any graph with a tool node with a sentence in the toast, instead of showing the engine's 403. Review: a Claude run whose worktree exists (GET /api/git/status answers 200 for session `run<id>000`) gets a "Review run changes" button in the run header; the slot is reserved with `visibility`, so it never shifts layout. The engine adds `review` to the run summary when the graph has an agent or evaluator node with edit or plan permission.

### frontend/src/ui/studio/canvas.ts · keyboard model

- refers-to: frontend/src/ui/studio/canvas.ts :: StudioCanvas.layoutOrder, reveal, createNode, updateEdge, paintSelection
- kind: rationale
- logged: v0.15.0 · 2026-11-01

The node layer is a `listbox` and each node card an `option` with `tabindex="-1"`, `aria-selected` kept in step with the selection in `paintSelection`, and `aria-label` of kind plus name. The stage stays the single Tab stop; ArrowRight and ArrowDown move focus to the next node in layout order (x, then y, then id), ArrowLeft and ArrowUp to the previous, Home and End to the ends, panning the view just enough to keep the focused node on screen. Focus does not select: Enter selects the focused node (the Studio inspector column and the run Node inspector follow the selection), Delete or Backspace removes the selection, Shift+F10 or the ContextMenu key opens the node menu at the focused node's rect, Escape clears the selection (and cancels a wire first). Edges carry `role="img"` and a label "from to to: label"; they are not focusable, an edge is still selected with the pointer and edited from its menu. The minimap toggle exposes `aria-pressed`; the canvas mode buttons already did, and the runs panel has no toggle buttons (its mode is a select).
