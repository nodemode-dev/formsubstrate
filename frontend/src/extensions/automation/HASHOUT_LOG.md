# HASHOUT_LOG · automation extension · subform

Living log for frontend/src/extensions/automation/.

Current build version: v0.14.0
Last updated: 2026-10-31

### frontend/src/extensions/automation/index.ts · AutomationPanel

- refers-to: frontend/src/extensions/automation/index.ts :: AutomationPanel
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Substrata's automation view was a full page that joined triggers, recipes and runs and held the trigger builder. In subform the builder is the Triggers sidebar section and this extension is the other half of the control room, a right-panel section: the last 40 fires across every trigger of the open workspace (time, kind, recipe, run id, and the run's state joined from GET /api/runs, or the error or skip reason), newest first, with a line saying how many triggers are on and that they run only while subform is open. It is read-only, so it uses plain requests. Rows are keyed by trigger id and fire time with `patchList`.
