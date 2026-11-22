# HASHOUT_LOG · frontend/src/ui (pickers, trust, Home) · formsubstrate

Current build version: v0.20.0
Last updated: 2026-11-22

### frontend/src/ui/path-picker.ts · pickPath, PathPicker

- refers-to: frontend/src/ui/path-picker.ts :: pickPath, PathPicker; frontend/src/styles/path-picker.css; backend/app/routers/workspace.py :: browse
- kind: rationale
- logged: v0.8.0 · 2026-10-30

The desktop app uses the Tauri dialog plugin (capability `dialog:allow-open` is already granted). The browser build has no native dialog, so an in-window dialog lists directories through the engine and never runs anything. The first listing is fetched before the dialog opens, so it never paints empty; later folder changes keep the old rows until the new ones arrive and patch them by path. The list box has a fixed height and the status line a fixed height, so errors and long paths do not move anything. Keys: arrows, Home, End, PageUp, PageDown move; Enter or ArrowRight enters a folder or chooses a file; Backspace or ArrowLeft goes up; letters jump by prefix (the buffer clears after 700 ms and on any other key). The typed path field is built hidden and shown only when the preference "Allow typing absolute paths" is on.

### frontend/src/ui/open-folder.ts · openFileAt

- refers-to: frontend/src/ui/open-folder.ts :: openFileAt, setFileOpener
- kind: rationale
- logged: v0.8.0 · 2026-10-30

The engine reads files only inside the workspace, so there are no loose file tabs. This follows the old substrata: a file inside the open workspace opens in place; a file outside it makes its folder the workspace (asked first when another workspace is open) and then opens the file.

### frontend/src/io/trust.ts · setTrusted

- refers-to: frontend/src/io/trust.ts :: isTrusted, setTrusted, trustQuery; frontend/src/ui/trust-banner.ts :: TrustBanner; frontend/src/io/lsp.ts :: lspSocketUrl; frontend/src/io/debug.ts :: DapConnection
- kind: rationale
- logged: v0.8.0 · 2026-10-30

The engine runs workspace-local language servers and the workspace venv python only when the socket URL carries `trust=1`. The window adds it only for a workspace whose path is in the `trustedWorkspaces` preference. A banner asks once per path when the engine reports `localTools` for it; both answers are remembered (`trustAsked`), so Not now does not ask again. Revoking is in Preferences, Workspace, and the File menu command Trust This Workspace toggles it. A change restarts the language servers through `lsp-restart` so the new socket URL is used. The banner is fixed above the page at the temp layer and hidden by attribute, so showing it moves no layout.

### frontend/src/ui/home.ts · Home

- refers-to: frontend/src/ui/home.ts :: Home, TILES; frontend/src/ui/home-files.ts :: HomeFiles; frontend/src/styles/home.css
- kind: rationale
- logged: v0.8.0 · 2026-10-30

The formvis Home skeleton, class names and tokens are unchanged. The content is for building Form family apps: Open folder, Open file, Clone, New Form app and New Claude session in the Create list; a hero for opening a repository; a Quick actions grid (Claude session, Claude terminal, New Form app, Review changes, Start formslot, Language servers) in place of the size tiles; recent workspaces with git branch and changed count; sessions. The typed path row sits in the hero from the start with `visibility: hidden` and `inert` while the preference is off, so turning the preference on moves nothing.

### frontend/src/styles/shell.css · .cv-doc-tabs .cv-brand

- refers-to: frontend/src/styles/shell.css :: .cv-doc-tabs .cv-brand; frontend/src/styles/workbench.css :: .cv-wb
- kind: rationale
- logged: v0.8.0 · 2026-10-30

The Home button's section and the activity rail both take their width from `--cv-rail-w`. The rail has a 1px right border, so the button section carries the same border (transparent) and its icon centres on the same x as the rail icons.

### frontend/src/ui/new-app-dialog.ts · CloneDialog, NewAppDialog

- refers-to: frontend/src/ui/new-app-dialog.ts :: CloneDialog, NewAppDialog, followCloneJob, PathField; frontend/src/io/create.ts :: create; frontend/src/styles/new-app.css; frontend/src/app.ts :: clone-repo, new-form-app
- kind: rationale
- logged: v0.10.0 · 2026-10-30

Both dialogs are built once, on first use, and only patched afterwards: the folder pick is a read-only field plus a Browse button over `pickPath('folder')` (the Tauri dialog in the desktop app, the path picker in the browser build). The progress bar, the status line and the hint line always occupy their space (the line has a minimum height for two lines), the buttons only toggle `disabled` and their label, so opening, typing, picking and running move nothing. The dialog frame takes the glass tokens (`--glass-*`) as the menus do. Clone: the folder name follows the address until the person types one; Stop cancels the engine job, the dialog stays until the job reports; the job also shows in the status bar jobs list while it runs, and finishing opens the folder through `openFolderAt`, which asks about unsaved files first. New app: the port field starts at the engine's suggested free block and follows the destination until the person types a port; every edit is checked by the engine after 300 ms. Home needed no change: its Create buttons and tiles read the command's `enabled` state, so registering the two commands (instead of `soon`) enabled them in place, and the File menu and palette entries follow. `io/create.ts` has its own copy of the window-token plumbing of `io/formslot.ts` (`owner` is not exported from there); fold the two when formslot.ts is next open for editing.

### frontend/src/ui/new-app-dialog.ts · busy handling

- refers-to: frontend/src/ui/new-app-dialog.ts :: CloneDialog.close, CloneDialog.sync, CloneDialog.run, NewAppDialog.sync, NewAppDialog.send, followCloneJob, escapeWhenAdrift
- kind: rationale
- logged: v0.10.0 · 2026-10-30

Disabling the focused field dropped focus to the page body, where the scrim's Escape handler never hears keys. Entering busy now moves focus to Stop (Clone) or Cancel (New app) before the fields are disabled, leaving busy puts it back on the address or name field, and a document-level Escape listener covers the case where focus is outside every scrim. The Browse label has its own class; before, the label was written into the 14px icon span and the icon vanished. Closing a running clone asks "Stop cloning?"; on yes the job is cancelled, the dialog closes and the outcome is toasted without opening the workspace. A New app request cannot be stopped, so closing only dismisses: the toast reports the result and the workspace is not opened. A poll error in followCloneJob is retried with doubling back-off up to four times (a 404 ends at once); after that the job stays in the jobs list labelled as connection lost, and its Stop button cancels and removes it. The port field refills the suggested block after a destination change unless a valid port was typed, and partial input of one to three digits shows no error and no port range.

### frontend/src/ui/new-session.ts · permission mode select, prefs agentPermissionMode

- refers-to: frontend/src/ui/new-session.ts :: NewSessionDialog; frontend/src/ui/prefs.ts :: agentPermissionMode, PERMISSION_MODES; frontend/src/ui/settings.ts :: Agents section
- kind: rationale
- logged: v0.10.0 · 2026-10-30

The New Agent Session dialog has a Permission mode select (Accept edits, Ask, Plan only) and a note that is always laid out at a fixed height; for an interactive session both are dimmed and the note says interactive sessions ask in the terminal, so choosing a mode causes no layout shift. The default comes from Preferences, Agents, Headless permission mode (`agentPermissionMode`, default `acceptEdits`). bypassPermissions is not offered anywhere. Settings also listens for `subform:open-settings` (detail.section) so a panel can open Preferences at a section, and dispatches `subform:identity-changed` after the identity is saved.

### frontend/src/ui/status-formslot.ts · FormslotStatusItem.paint

- refers-to: frontend/src/ui/status-formslot.ts :: FormslotStatusItem
- kind: rationale
- logged: v0.10.0 · 2026-10-30

When formslot is installed, a workspace is open and `workspaceCorpus` is null, the tooltip now says the workspace is not indexed and no gates run there (the PreToolUse hook fails open). The status item reads the workspace from the `workspace` store singleton, so it needs no change to status.ts.

### frontend/src/ui/terminal-dock.ts · TerminalDock (gates event handler)

- refers-to: frontend/src/ui/terminal-dock.ts :: TerminalDock, scheduleGates, paintGate, answerGate
- kind: rationale
- logged: v0.13.0 · 2026-10-30

The gate banner was repainted only inside the animation frame queued by `scheduleGates`, so for up to one frame after a `gates` event the banner could still show the previous gate id and a click in that window answered the wrong (already closed) gate. The `gates` handler now calls `paintGate` synchronously (it patches text, hidden flags and disabled state in place, so no node is rebuilt) and still queues `scheduleGates` for the tab badges; `answerGate` reads `this.gateId` set by that paint. The `sessions` event keeps the queued path because it only changes tab state.

### frontend/src/ui/settings.ts, prefs.ts · "Check for updates at start" removed

- refers-to: frontend/src/ui/settings.ts :: Settings (General, Updates); frontend/src/ui/prefs.ts
- kind: removed-code
- logged: v0.18.0 · 2026-11-22

Preferences showed a switch "Check for updates at start" on General (group Startup) and again on Updates. It was stored under `formsubstrate.updateAtStart` in local storage and nothing read it: Substrate has no updater, and updates come through FormPortal (the owner's decision). Removed: the two `toggleRow` rows `updatesGeneral` and `updatesPanel`, the Startup group on General, their three lines in `sync`, and from `prefs.ts` the key `UPDATE_KEY`, `updateAtStart()` (`localStorage.getItem(UPDATE_KEY) !== '0'`) and `setUpdateAtStart(on)`. The Updates page keeps the version row and now says "Updates come through FormPortal." A stored `formsubstrate.updateAtStart` value is left where it is and never read.

### frontend/src/ui/settings.ts · Anthropic API key row reads the index status

- refers-to: frontend/src/ui/settings.ts :: Settings.keyState, refreshRemote, paintKey, storeKey, dropKey; frontend/src/io/secrets.ts :: SecretStatus, secretStatus, saveSecret, secretStatusText
- kind: rationale
- logged: v0.19.0 · 2026-11-22

`GET /api/secrets/{name}` now returns `{present: boolean | null, state: 'saved' | 'absent' | 'unknown', store: 'keychain' | 'file' | null}` from the engine's index, with no keychain read, and `PUT` returns the same status after saving (see `backend/app/services/HASHOUT_LOG.md`, secret_store entry of v0.19.0). `io/secrets.ts` replaces `hasSecret(name): Promise<boolean>` (`r.present === true`) with `secretStatus`, makes `saveSecret` return the status, and adds `secretStatusText`, shared with Welcome. The key row keeps `keyState: SecretStatus | null` in place of `keyPresent: boolean | null`. Status text: the store-aware text, and for unknown "Not checked yet. Save the key again or remove it to settle this."; Remove is enabled for saved and unknown (removing an absent key is harmless and settles the state), disabled for absent, null or busy. After Save the row shows the store the engine reports; after Remove it is absent. The note under the row now says the key may be kept in a user-only file where there is no keychain, and that opening the page does not touch the keychain. The 503 note "The system keychain is not available." stays for the engine's 503 on a refusing keychain, which a status read no longer returns. Removed: `this.keyPresent = await hasSecret(API_KEY_SECRET);`, `t(this.keyPresent ? 'Saved in the system keychain' : 'Not set')`, `off(remove, this.keyPresent !== true || this.keyBusy);`, `this.keyPresent = true;` and `this.keyPresent = false;`. Text only changes in place, so the row does not reflow beyond the length of the status line.

### frontend/src/ui/inspector/index.ts · NodeInspector.paintRun visit options patched by key

- refers-to: frontend/src/ui/inspector/index.ts :: NodeInspector.paintRun (visitSel); frontend/src/ui/dom.ts :: patchList
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

The Run tab's visit select was rebuilt whenever the number of visits changed: `this.visitSel.replaceChildren(...visits.map((v, i) => new Option(\`${t('Visit')} ${v.n}\`, String(i))));` followed by `this.visitSel.value = String(this.selectedVisit);`. Its options are now patched with `patchList`, keyed by the visit index: a new visit adds one option at the end, a shorter run removes the extra ones, and every kept option has its label rewritten in place only when the text differs. The select element, its focus and the enhanced dropdown button beside it stay; the value is written only when it differs from the chosen visit. The choice of the newest visit when the count changes is kept as before.

### frontend/src/ui/settings.ts · Preferences checked against the FormVis node-wire dialog

- refers-to: frontend/src/ui/settings.ts :: SettingsDialog (constructor, add, markSection, scrollToSection, foldSection, queueSpy, drawWire); frontend/src/styles/dialogs.css :: .cv-prefs-*
- kind: rationale
- logged: v0.20.0 · 2026-11-22

Compared line by line with FormVis `app-dialogs.ts` (the constructor's rail, wire and port, and `showSection` to `drawWire`) and `dialogs.css` (`.cv-prefs-rail` to `.cv-prefs-port::after`): the class names, the constants (rail key, 700 ms spy mute, 12 px scroll pad, 24 px spy edge, 10 px wire radius, the 0.45 trunk, the `H -7` end), the order of open (mark, open, scroll, wire) and the rules match, with the FormVis literals replaced by the tokens of the same value. Nothing was changed. The key and every other setting live in a Preferences card: the Anthropic API key in Agents, the identity in Git and Identity, the formslot folder in formslot. Buttons elsewhere that need one open Preferences at that card through `formsubstrate:open-settings` with `detail.section` (Source Control at Git and Identity, the Home formslot card at formslot, and from v0.20.0 Welcome at Agents). Checked under a 4x CPU and slow network in headless Chrome: after each tab choice and each scroll position the wire starts on the chosen tab's right edge at its middle and ends on the port, and no layout shift is recorded.

### frontend/src/styles/workbench.css, shell.css · group chips and card rows from the FormVis recipe

- refers-to: frontend/src/styles/workbench.css :: .cv-wb-side-head, .cv-wb-side-title, .cv-wb-right-head, .cv-wb-right-title; frontend/src/styles/shell.css :: .cv-list-row
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

Logged here because this worker could not write the styles log. The side and right panel heads were small uppercase muted labels (`color: var(--text-muted); font-size: var(--fs-11); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;`). They now follow FormVis `panels.css` (the group header as a dark strip, the panel's name as a raised chip): the head takes `--group-head`, and the title is a chip with a `--line-3` hairline, `--radius-md` and `--surface-raised`, at the same head height, so nothing below moves; an empty title is hidden by visibility, keeping its space. List rows (the command palette) were flat (`border-radius: var(--radius-sm)`, selected `background: var(--accent-color-dim)`); they are now rounded cards on the layer-row recipe: `--radius-md`, a hairline on hover and, when selected, the gradient from `--surface-raised` to `--accent-glow` with an `--accent-line` hairline, drawn as an inset shadow so the row keeps its size. Checked and already matching FormVis: document tabs with rounded tops and the raised active tab, the dialog recipe (blurred scrim, `--radius-2xl` of 14 px, the white primary button), the numeric field and the slider (`.cv-num`, `.cv-slider-ctl`, the Preferences range recipe), and the segmented bar in `review.css`, which is FormVis `shell.css`'s hairline version. Left out on purpose, as an editor differs: no tool rail and no dot grid (there is no canvas; the activity rail is the editor's), the options row stays as it is, the file tree and search rows stay dense flat rows like an editor's, and there is no row splitter because the side and right columns show one panel at a time and never stack groups.

### frontend/src/ui/dom.ts · revealApp sends the page's background; frontend/index.html · the icon link

- refers-to: frontend/src/ui/dom.ts :: revealApp; frontend/index.html :: head; src-tauri/src/reveal.rs :: app_ready
- kind: rationale
- logged: v0.20.0 · 2026-11-22

`revealApp` called `invoke('app_ready')` with nothing. It now reads the body's computed background and sends it as `bg` (three numbers, or null when it cannot be read), as FormDeck's page does, and the shell sets the main window's own background to it before showing the window. With a light theme the window behind the page was the dark default until the page covered it; now the two match from the first shown frame. `index.html` gains `<link rel="icon" type="image/png" href="/icon.png">`: the browser asked for `/favicon.ico` on every load and logged a 404. Type-checked; not seen in the desktop app.
