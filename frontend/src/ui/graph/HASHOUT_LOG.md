# HASHOUT_LOG · frontend/src/ui/graph (file graph tab) · subform

Living log for the graph document tab: graph-view.ts, graph-layout.ts, index.ts, with the styles in styles/graph.css and the engine call in io/graph.ts. Source files stay comment-free; what they would have said lives here.

Current build version: v0.8.0
Last updated: 2026-10-30

### frontend/src/ui/graph/graph-view.ts · GraphTab

- refers-to: frontend/src/ui/graph/graph-view.ts :: GraphTab
- kind: rationale
- logged: v0.8.0 · 2026-10-30

Port note. substrata's graph (frontend/src/ui/components/graph.ts) was an editable agent-workflow canvas (node cards with ports, bezier edges, run status), bound to its engine's graph document, not a view of the workspace. That model has no counterpart here, so what came back is its look and controls (dotted grid, zoom buttons and fit, minimap with a viewport box that recentres on click, pan and wheel zoom, kind colours) over a new subject: the workspace file graph. No substrata code was copied; the SVG renderer was replaced by a canvas because a few thousand nodes as DOM would not stay smooth.

The tab is a ViewDoc hosted by Views like the diff and review tabs. The DOM is built once in the constructor; the tab is hidden and shown by Views, so the layout, zoom and selection live in the instance and survive a hide. A second layer of memory (`memory`, by workspace path) keeps positions, pins and the view across closing and reopening the tab. On activate the tab asks the engine with its last `sig`; an `unchanged` answer touches nothing, a changed graph reuses every known position and only runs a short low-heat layout (alpha 0.12 when more than 85 percent of connected nodes are known), so a refresh never reshuffles the picture.

Only connected nodes are simulated. Files with no links are laid out on a grid to the right of the settled cluster, once, when the first layout settles (they are not drawn until then); otherwise a thousand loose docs and configs would be pulled into the middle of the real graph. The Unlinked toggle hides them.

Canvas colours are never hard-coded: each `--token` is assigned to a probe element's `color` and read back from computed style, which resolves `var()` and `color-mix()` to a plain rgb the canvas accepts. They are re-read when `nm:ui-settings-changed` fires and when the root element's style, class or data-theme attributes change, then repainted; while the tab is hidden the change is only flagged and applied on the next activate. Painting is requestAnimationFrame coalesced and batches nodes by category into one path per colour, edges into one stroked path, labels only for the hovered, matched or highest-degree nodes in view. Node radius shrinks with zoom beyond 1 (k to the minus 0.6) so nodes stay legible at high zoom. Hit testing is a linear scan of at most a few thousand points per pointer move, cheaper than keeping a spatial index in sync with the layout.

Slots layer. When formslot is running the Slots toggle enables; it takes `formslotState.driftFiles` (path and slot id) and adds one diamond node per slot id linked to the files it names. Clicking a slot node opens its first file. With formslot absent the toggle stays disabled and the file graph is unaffected.

### frontend/src/ui/graph/graph-layout.ts · worker

- refers-to: frontend/src/ui/graph/graph-layout.ts :: step, build, repel
- kind: rationale
- logged: v0.8.0 · 2026-10-30

Force layout in a module worker so the window thread never runs it. Barnes-Hut repulsion (theta 0.9, distance cut at 420) over a quadtree rebuilt each step in preallocated typed arrays (16 cells per node, which covers clustered points down to a cell half-size of 0.01, below which coincident points share a cell), link springs with strength 1 over the smaller degree and a bias by degree, a weak pull to the origin, velocity decay 0.4, alpha decay 0.972 down to 0.006 (about 200 steps). The worker works in slices of 14 ms and posts a copied position array after each slice, so the window sees the layout settle progressively and the worker is never blocked on the receiver. Pinned indices (dragged nodes) keep their position and are not moved by forces; a drag sends `pin` and a heat of 0.25 so neighbours follow. Copies are made of the incoming arrays instead of using them directly because the posted buffers arrive typed as ArrayBufferLike.

### frontend/src/ui/graph/index.ts · installGraph

- refers-to: frontend/src/ui/graph/index.ts :: installGraph
- kind: explainer
- logged: v0.8.0 · 2026-10-30

Registers the `view-graph` command (View menu, palette, Alt+Shift+G; substrata had no shortcut for its graph, and Mod+Shift+G is find-previous in the editor) and a window event `subform:open-graph`. The tab id is fixed, so opening it again only shows it. Opening a file from a node goes through the same `openInEditor` the file tree uses, so media and Markdown previews apply.

### frontend/src/io/graph.ts · fetchGraph

- refers-to: frontend/src/io/graph.ts :: fetchGraph
- kind: explainer
- logged: v0.8.0 · 2026-10-30

Thin call to `GET /api/graph`. Passing the last signature lets the engine answer `unchanged` without sending the node list.

### frontend/src/styles/graph.css · layout

- refers-to: frontend/src/styles/graph.css :: .cv-gr
- kind: warning-context
- logged: v0.8.0 · 2026-10-30

Everything that changes at run time is inside a fixed box: the toolbar has a fixed height and fixed widths for the search, folder and type controls, the count has a flexible slot that ellipsises, the canvas fills the stage absolutely, the tooltip, zoom column, minimap and legend are absolutely placed (the tooltip moves by transform only), and the minimap toggle keeps its corner whether or not the minimap is shown. Layers use `--z-raised` and `--z-selected` only.
