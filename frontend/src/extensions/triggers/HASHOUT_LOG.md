# HASHOUT_LOG · triggers extension · subform

Living log for frontend/src/extensions/triggers/.

Current build version: v0.14.0
Last updated: 2026-10-31

### frontend/src/extensions/triggers/index.ts · TriggersPanel

- refers-to: frontend/src/extensions/triggers/index.ts :: TriggersPanel
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Ported from substrata frontend/src/extensions/triggers/index.ts and automation/index.ts (MIT, owner's), which are merged here: the create form (kind, value, recipe, run mode, optional JSON inputs) and the list of triggers with enable toggle, run-now, webhook details and delete. Rows are keyed by trigger id with `patchList`; the form is never rebuilt, only the recipe options change, and only when the recipe names changed. The panel polls every 3 seconds while it is visible. Every change is an `owner()` call, so it carries the window token. The empty state says triggers run only while subform is open. A new webhook opens WebhookDialog with the address, the signature header and the secret, shown once at creation and again on demand through the window-token route.

### frontend/src/extensions/triggers/index.ts · what was left out

- refers-to: frontend/src/extensions/triggers/index.ts :: TriggersPanel
- kind: removed-code
- logged: v0.14.0 · 2026-10-31

Substrata's `run_graph` form field (a saved graph name typed into the small triggers panel) is not offered; the engine still accepts the action. Its "open runs" row button is not ported because the runs panel is another extension's.
