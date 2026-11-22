# HASHOUT_LOG · frontend/src/ui/review (review pane, diff tabs) · formsubstrate

Living log for the review pane and diff tabs as changed in F6 carries and F7: provenance.ts, review-pane.ts, diff-view.ts and views.ts. Source files stay comment-free; what they would have said lives here. The F6 entries that introduced these files are in frontend/HASHOUT_LOG.md.

Current build version: v0.20.0
Last updated: 2026-11-22

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

### frontend/src/ui/review/review-pane.ts, diff-view.ts · provenance badge

- refers-to: frontend/src/ui/review/provenance.ts :: PROVENANCE_HTML; frontend/src/styles/formslot.css :: .cv-fs-prov
- kind: rationale
- logged: v0.7.1 · 2026-10-30

The badge toggled between display none and shown when drift arrived, which reflowed the file row and the diff bar. The fix is in CSS only: while formslot is enabled the badge in those two places keeps a fixed width and hides with visibility, so the filename never re-truncates. provenance.ts is unchanged.

### frontend/src/ui/review/review-pane.ts · paintBadge

- refers-to: frontend/src/ui/review/review-pane.ts :: paintBadge, load; frontend/src/io/sessions.ts :: SessionsClient.bashNotes
- kind: explainer
- logged: v0.11.0 · 2026-10-30

`load` also reads `GET /api/gates/notes?session=` (errors read as none) into a path to slot map. `paintBadge` calls `paintProvenance` and, when the file has a note, reuses the same badge element for the text "Bash · slot X" (title "Written by Bash, overlaps slot X", warn colour through `data-state="behind"`). No node is added, so the fixed-width badge keeps the row layout. The notes are fetched on each reload, which the git change events already trigger after a Bash write.

### frontend/src/ui/review/review-pane.ts · paintBadge, paintSkips (gate notes of kind skipped)

- refers-to: frontend/src/ui/review/review-pane.ts :: paintBadge, paintSkips, gateNotes; frontend/src/io/sessions.ts :: GateNote, SessionsClient.bashNotes; frontend/src/styles/review.css :: .cv-rv-skips, .cv-fs-prov[data-state="skipped"]
- kind: rationale
- logged: v0.14.0 · 2026-10-30

A fail-open gate note now has its own kind and reason, so the badge reads "Gate skipped: <reason>" (for example "Gate skipped: formslot did not answer in time") instead of "Bash · slot unchecked, gate skipped: ...". The title carries the reason and the hook's detail text. Style: `data-state="skipped"`, muted text with a dashed warn border, set on the same badge element, so no node is added and the fixed-width badge keeps the row layout. Slot notes (kind slot) are unchanged. `bashNotes` returns `GateNote` objects; a stored note of the old shape (kind absent, slot starting "unchecked, gate skipped:") is read as a skipped note whose reason is the rest of that text, so notes posted by an older hook still display sensibly. The header shows `.cv-rv-skips` ("N gates skipped", title explains) counting the files whose note is skipped; it is always laid out with a fixed min-width and toggles `visibility` through `data-on`, so it never shifts the bar. The count is of files, not events: a note replaces an earlier note for the same path.

### frontend/src/ui/review/review-pane.ts · conflicted files

- refers-to: frontend/src/ui/review/review-pane.ts :: ReviewPane.updateFile, updateHunk, createHunk, onClick, acceptAll, paint, OPEN_CONFLICT
- kind: rationale
- logged: v0.23.0 · 2026-11-22

The engine refuses hunk actions on a conflicted file, so the pane no longer offers them: such a file hides Accept file, Reject file and each hunk's Accept and Reject (the hunks stay visible, with comments), shows a warning line that says to resolve the conflicts and then use Mark Resolved in Source Control, and an Open to Resolve button that sends `formsubstrate:open-conflict`; the git extension opens the editor for the workspace and the diff tab for a session. Accept all and commit is disabled while any file is conflicted, with the reason as its title. The nodes are the same `patchList` nodes, toggled with `hidden`; their rules live in git.css because review.css was outside this change. Checked in headless Chrome against the /tmp merge: four conflicted files each showed the note and Open to Resolve, no accept buttons, Accept all disabled, and Open to Resolve opened big.py in the editor with its actions.

### frontend/src/ui/review/diff-view.ts · read-only commit mode, conflicts on the editable side

- refers-to: frontend/src/ui/review/diff-view.ts :: DiffTarget (commit, short), diffId, DiffTab.editable, load, queueReload, paint, editExt; frontend/src/ui/review/index.ts :: diffId, COMMIT_RE, OPEN_DIFF listener, openDiff; frontend/src/ui/editor/conflicts.ts :: conflicts; frontend/src/styles/git.css :: .cv-diff .cm-conflict-*
- kind: rationale
- logged: v0.23.0 · 2026-11-22

A `DiffTarget` with `commit` (and `short`) is one file in one commit: `load` calls `git.show` instead of `git.diff`, `editable` is false so both sides get the read-only extensions and Save stays hidden, and `queueReload` ignores `formsubstrate:git-changed` because a commit never changes. The tab is titled `<file> (<short sha>)` with the full sha in its path line; the id is `diff:<target>:commit:<sha>:<path>`, so each commit gets its own tab and opening it again shows the same one. The badge reads target · short sha · Added in this commit, Deleted in this commit, Renamed from <old path>, or Against the first parent · read only, with the subject in its title. `ui/review/index.ts` keeps its own copy of `diffId` (it imports the diff view lazily) and now passes `commit` and `short` through from the `formsubstrate:open-diff` detail, accepted only as 4 to 64 hex characters; this one change there was needed because the tab is opened from that listener and nowhere else.

The editable side (`editExt`, used for session worktree files and the workspace working tree) now carries `conflicts` from `ui/editor/conflicts.ts`, the same extension the main editor has in `buildState`, so a session file in conflict shows Accept Current, Accept Incoming and Accept Both above each block and the tints; an action is an ordinary edit, so the tab turns dirty and Save (or Mod+S) writes through the worktree route. The editor's conflict rules are scoped to `.cv-editor` in editor.ts's stylesheet, which the diff tab is not inside, so the same rules scoped to `.cv-diff` sit in git.css; without them the action line would have no fixed height. Checked in headless Chrome (CPU 4x) with a session registered in a scratch data folder whose worktree under /tmp was mid-merge: the Merge Changes row opened `conf.txt (session)` with the action line at 20.14 px (one line) and the tints, Accept Incoming left `a`, `feature`, `c`, Mod+S wrote exactly that to the worktree, no shift outside input and no console errors. The left side of a conflicted file is empty because the diff route reads the index entry, which a conflicted file does not have at stage 0; that is the route's existing behaviour.
