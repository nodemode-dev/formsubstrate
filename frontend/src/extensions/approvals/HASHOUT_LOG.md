# HASHOUT_LOG · approvals extension · subform

Living log for frontend/src/extensions/approvals/.

Current build version: v0.14.0
Last updated: 2026-10-31

### frontend/src/extensions/approvals/index.ts · ApprovalsPanel

- refers-to: frontend/src/extensions/approvals/index.ts :: ApprovalsPanel
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Ported from substrata frontend/src/extensions/approvals/index.ts (MIT, owner's). A right-panel section lists every run parked on an approval (GET /api/runs/approvals, served by the run engine) as a card: the tool, the run, the task, the gated step as text (a shell command as `$ command`, a file write with its unified diff, an HTTP request, otherwise the arguments as JSON) and Approve and Deny. Substrata rendered the diff line by line with coloured elements built from a string; the card here sets the text of one `pre` so nothing is injected as markup. Decisions use `owner()` (window token). Cards are keyed by run id with `patchList`; the buttons are disabled while a decision is in flight. The panel polls every 3 seconds while the window is visible and raises a toast with a Review action (and a desktop notification when the window is not in focus) for an approval that appears after the first load.

### frontend/src/extensions/approvals/client.ts · approval id

- refers-to: frontend/src/extensions/approvals/client.ts :: approvalsApi
- kind: rationale
- logged: v0.14.0 · 2026-10-31

The run engine now answers an approval by its own id as well as the run id (`{approved, approval}`), so a run with two pending approvals cannot have one answer land on the other. `decide` sends the id the list returned; the card is still keyed by run, and the next approval of the same run shows after the poll.
