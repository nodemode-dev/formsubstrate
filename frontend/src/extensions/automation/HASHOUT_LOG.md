# HASHOUT_LOG · automation extension · formsubstrate

Living log for frontend/src/extensions/automation/.

Current build version: v0.25.1
Last updated: 2026-11-22

### frontend/src/extensions/automation/index.ts · AutomationPanel

- refers-to: frontend/src/extensions/automation/index.ts :: AutomationPanel
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Substrata's automation view was a full page that joined triggers, recipes and runs and held the trigger builder. In subform the builder is the Triggers sidebar section and this extension is the other half of the control room, a right-panel section: the last 40 fires across every trigger of the open workspace (time, kind, recipe, run id, and the run's state joined from GET /api/runs, or the error or skip reason), newest first, with a line saying how many triggers are on and that they run only while subform is open. It is read-only, so it uses plain requests. Rows are keyed by trigger id and fire time with `patchList`.

### frontend/src/extensions/automation/index.ts · order

- refers-to: frontend/src/extensions/automation/index.ts :: fires, paint
- kind: rationale
- logged: v0.15.0 · 2026-11-01

The list is now oldest first with the newest at the bottom, kept scrolled to the end while the reader is at the end. New fires inserted at the top pushed every row down (CLS 0.003 each time while a trigger fired), and a list that does not overflow cannot be scroll-anchored. Appending at the end moves nothing.
