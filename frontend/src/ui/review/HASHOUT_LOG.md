# HASHOUT_LOG · frontend/src/ui/review (review pane, diff tabs) · subform

Living log for the review pane and diff tabs as changed in F6 carries and F7: provenance.ts, review-pane.ts, diff-view.ts and views.ts. Source files stay comment-free; what they would have said lives here. The F6 entries that introduced these files are in frontend/HASHOUT_LOG.md.

Current build version: v0.7.0
Last updated: 2026-10-30 · Phases F6 carries and F7

### frontend/src/ui/review/provenance.ts · paintProvenance

- refers-to: frontend/src/ui/review/provenance.ts :: paintProvenance
- kind: warning-context
- logged: v0.7.0 · 2026-10-30

Badges are placed before the right-aligned actions (review) or the tools (diff), inside free space, so they shift nothing. Drift is computed for the workspace; for a session worktree review the badge matches by repo-relative path only, which is approximate because /api/formslot/drift takes no session.

### frontend/src/ui/review/review-pane.ts · paintNotice, fix, listeners

- refers-to: frontend/src/ui/review/review-pane.ts :: ReviewPane.paintNotice, ReviewPane.fix, ReviewPane.dispose, ReviewPane.apply
- kind: rationale
- logged: v0.7.0 · 2026-10-30

The notice row already had a reserved height; it now shows a transient message when there is one and otherwise the flagged-commit line with a "Fix with Sign and Push" button at its end, so the pane gains no row and nothing shifts (the button toggles `hidden` inside the fixed-height row). The click runs sign-and-push for the pane's session and then reloads. The sessions and language subscriptions are kept and called in dispose, so a closed tab stops repainting detached DOM (review5 L1). `apply` bumps the load sequence before awaiting so an older in-flight load cannot overwrite the result (review5 L4). The button title and toast no longer claim the commit happens in Source Control when it does not.

### frontend/src/ui/review/diff-view.ts · save, stale, search, editable

- refers-to: frontend/src/ui/review/diff-view.ts :: DiffTab.save, DiffTab.editable, DiffTab.syncDirty, DiffTab.find, DiffTab.dispose
- kind: rationale
- logged: v0.7.0 · 2026-10-30

A session diff tab is editable when the diff carries an mtime (the file exists) and saves through the worktree route with that mtime; the conflict dialog and Overwrite path are the workspace tab's. The git-changed event after a save carries the tab's session. The "read only here" badge now means what it says (shown only when the tab cannot be edited, never for staged views). The language subscription is released in dispose (review5 L1). When the buffer returns to the saved text the stale banner is hidden and a reload is queued, so the tab picks up the newer disk text (review5 L3). Search: the editors get the search keymap and selection highlighting, and the tab implements `find`, `selectNext` and `selectAllOccurrences` on the editor that has focus (else the modified side).

### frontend/src/ui/review/views.ts · find, selectNext, selectAllOccurrences, searchable

- refers-to: frontend/src/ui/review/views.ts :: Views.find, Views.selectNext, Views.selectAllOccurrences, Views.searchable; frontend/src/app.ts :: find commands
- kind: rationale
- logged: v0.7.0 · 2026-10-30

Find, Add Next Occurrence and Select All Occurrences acted on the hidden file editor while a diff or review tab was showing. They now go to the shown view when there is one; a view without search (the review pane) leaves them disabled, and with the file editor showing they behave as before.
