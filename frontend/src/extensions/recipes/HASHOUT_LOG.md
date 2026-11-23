# HASHOUT_LOG · recipes extension · formsubstrate

Living log for frontend/src/extensions/recipes/ and frontend/src/styles/recipes.css (shared by the recipes, triggers, approvals and automation panels). Source files stay comment-free.

Current build version: v0.25.1
Last updated: 2026-11-22

### frontend/src/extensions/recipes/index.ts · RecipesPanel

- refers-to: frontend/src/extensions/recipes/index.ts :: RecipesPanel
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Ported from substrata frontend/src/extensions/recipes/index.ts (MIT, owner's). A sidebar section lists installed recipes and uninstalled presets. The panel is built once; the list is a keyed `patchList` (a head row, then one row per recipe or preset) so a reload patches text and adds or removes only the rows that changed. A row click or the play button opens RunDialog, built from the recipe's declared inputs, with a choice between the simulator and Claude Code (remembered in localStorage under subform.recipes.mode, falling back to the simulator when /api/runs/env says the claude command is missing). A started run raises `subform:run-started` with the run reply and a toast. Differences from substrata: substrata saved "the current graph" from its canvas; here New Recipe wraps a saved graph chosen from `.subform/graphs/` (the Studio saves there), because the extension has no handle on the editor. Substrata's "load the recipe graph into the editor" button is not ported for the same reason. All writes go through `owner()` (window token).

### frontend/src/styles/recipes.css · tokens

- refers-to: frontend/src/styles/recipes.css :: .cv-rc, .cv-tg, .cv-ap, .cv-au
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Every colour, space and radius comes from tokens.css. The note line under each toolbar has a fixed height so a message appearing or clearing does not move the list; the lists are absolutely positioned inside a flex body, so their content never changes the panel's size.

### frontend/src/extensions/recipes/client.ts · trust on run

- refers-to: frontend/src/extensions/recipes/client.ts :: recipesApi
- kind: security
- logged: v0.14.0 · 2026-10-31

`recipesApi.run` sends `trust: workspaceTrusted()` with the inputs and mode, so the engine can refuse Claude Code mode and tool nodes in a workspace the owner has not trusted. The engine answers 403 with a message that the existing run dialog shows.
