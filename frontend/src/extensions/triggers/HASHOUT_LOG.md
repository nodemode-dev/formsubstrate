# HASHOUT_LOG · triggers extension · formsubstrate

Living log for frontend/src/extensions/triggers/.

Current build version: v0.25.1
Last updated: 2026-11-22

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

### frontend/src/extensions/triggers/index.ts · trust and confirm

- refers-to: frontend/src/extensions/triggers/index.ts :: TriggersPanel
- kind: security
- logged: v0.14.0 · 2026-10-31

Security review. The extension tells the engine whether the open workspace is trusted at start, on every workspace change and on `TRUST_EVENT` (`POST /api/triggers/trust` with the window token), because workspace trust lives in the window's preferences and the engine has no copy. A row whose recipe changed after the trigger was made shows a check button and a line saying so; the button asks, then calls the confirm route. The webhook dialog now describes the timestamp, nonce and signature headers, and the secret field says 24 or more characters or blank. The check button toggles with `setHidden`, so the row does not change size.

### frontend/src/extensions/triggers/index.ts · row height

- refers-to: frontend/src/styles/recipes.css :: .cv-tg-meta, .cv-tg-acts
- kind: rationale
- logged: v0.15.0 · 2026-11-01

Measured at 4x throttle: the meta line wrapped to two lines when it gained the "recipe changed" note, and the hidden confirm and webhook buttons changed the width of the action group. The meta line is now one line with an ellipsis (full text in the title) and the changed note comes first; hidden action buttons keep their space with `visibility: hidden`.
