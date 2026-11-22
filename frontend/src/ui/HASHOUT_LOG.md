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

### frontend/src/ui/terminal-dock.ts, frontend/src/styles/terminal.css · a family exception: Substrate keeps its own terminal dock

- refers-to: frontend/src/ui/terminal-dock.ts :: TerminalDock; frontend/src/styles/terminal.css; backend/app/routers/terminal.py; backend/formsubstrate_ptyhost.py
- kind: warning-context
- logged: v0.20.0 · 2026-11-22

The family's shared terminal panel is FormVis's `frontend/src/dock/` (version 2.2.1, fifteen files whose SHA-256 values are in its `MANIFEST.json`), copied byte for byte with everything app-specific in an adapter. Substrate does not take it, by the owner's decision of 22 November (handoff question Q4): it keeps its own terminals and sessions, recorded as a family exception beside formAT's. The reason is what the dock would have to carry for an editor: terminals that outlive an engine restart through the pty-host (`formsubstrate_ptyhost.py`), a Claude Code tab per session bound to that session, and the gate cards (FormSlot's gate type) that hold an agent until the person answers. Substrate does take the family's finder for agent programs (`backend/app/services/agent_lookup.py` 1.0.1, unchanged; see `backend/app/core/HASHOUT_LOG.md`, v0.18.0), so its terminals and the dock find the same programs the same way. No file of `frontend/src/dock/` is in this repository, so there is nothing to keep in step with the manifest; if Substrate takes the dock later, the copy must match the manifest and this entry is closed. The dock's look (tokens, tab chips, the accent line) is still the family's: `terminal.css` reads only tokens.

### frontend/src/ui/settings.ts · SettingsDialog.mcpCard, the MCP clients card in Agents

- refers-to: frontend/src/ui/settings.ts :: mcpCard, mcpConfig, paintMcp, forgetMcpToken, copyMcp, loadMcp, addMcp, removeMcp, refreshRemote; frontend/src/io/mcp-clients.ts :: listMcpClients, addMcpClient, removeMcpClient
- kind: rationale
- logged: v0.21.0 · 2026-11-22

Owner decision Q8. The card is built once in the constructor and only patched: a keyed list of approved clients (name, then added and last used in the `.cv-prefs-keycombo` slot, and Remove, which confirms through `confirmAction`), a name field with Add client, a status line, a read-only token field, a format pick (JSON for Claude Code and Cursor, TOML for Codex), a read-only snippet and Copy token and Copy config. Requests go through `owner` with the window key in `io/mcp-clients.ts`.

The token is shown once. It lives only in `mcpShown` and fills the token field and the snippet, both always laid out (the snippet carries `<token>` until then), so nothing moves when it appears. It is dropped when the card leaves the Preferences pages' viewport (an `IntersectionObserver` with the pages as root, which also fires when the dialog closes), when the dialog opens again, before another client is added and when its own client is removed. The snippet's command is `formsubstrate-engine` with `--mcp` when the page runs inside the Tauri shell and `./formsubstrate` with `mcp` otherwise; the note under the card names both.

Zero shift: the empty state is a `.cv-prefs-keyrow` the same height as a client row (its hidden button, `style="visibility: hidden"`, keeps the height), and exactly one of it and the list is shown, so the first add and the last remove do not move the card; a second client adds one row. The status line holds a no-break space when empty so it keeps its line height. The snippet borrows `cv-st-ta` from `studio.css` (fixed 108 px, code font); a prefs class in `dialogs.css` would be cleaner. Measured in headless Chrome under 4x CPU throttling against a live engine with a made-up data folder: no `layout-shift` entry and no change in the positions of the token field, snippet and status line on add and on remove.

New English keys, not yet in the 29 tables: listed in the v0.21.0 worker report.

The empty row's placeholder button first hid itself with an inline `style="visibility: hidden"`. It now carries the class `is-spacer`, with the rule `.cv-prefs-keyrow .cv-btn.is-spacer { visibility: hidden; }` in `dialogs.css`, as the rest of the window keeps space with classes (`.is-idle` in `formslot.css` and `lsp.css`). Same computed style, same box; the window has no inline style in `settings.ts`. The snippet uses the textarea recipe `cv-st-ta` from `studio.css` (token padding and line height); a Preferences-specific class can replace it if the two ever need to differ.

### frontend/src/ui/settings.ts · SettingsDialog Editor card (Saving group, bracket colours); frontend/src/ui/prefs.ts · editor saving and bracket prefs

- refers-to: frontend/src/ui/settings.ts :: SettingsDialog constructor (editorAutoSave, editorAutoSaveDelay, editorFormatOnSave, editorBrackets, pickEditor), SettingsDialog.sync; frontend/src/ui/prefs.ts :: Prefs, DEFAULT_PREFS, loadPrefs, AUTO_SAVE_DELAYS, EDITOR_PREFS_EVENT
- kind: rationale
- logged: v0.22.0 · 2026-11-22

Four prefs were added with defaults: `editorAutoSave` false, `editorAutoSaveDelay` 1000 (only 500, 1000, 2000, 5000 or 10000 ms load; anything else falls back to 1000), `editorFormatOnSave` false, `editorBracketColors` true (VS Code has bracket pair colouring on by default). The Editor card keeps its Text group and gains "Bracket pair colours" there, plus a Saving group with Auto save, Auto save delay (a select, enhanced by the window's dropdown) and Format on save, with one note. The rows use the card's existing `toggleRow` and `selectRow` and English labels that the page translator renders, like every other row in the card.

The new rows do not go through `ctx.onPrefs`, because that callback lives in `app.ts` and only forwards font size, tab size and word wrap to `EditorHost.setOptions`. Instead `pickEditor` saves through the same `change()` and then dispatches `EDITOR_PREFS_EVENT` on the document; `EditorHost` listens for it and rereads the prefs, so the settings apply at once to open editors (bracket colours through a Compartment reconfigure, saving behaviour as host state) and `app.ts` was not touched. Rows only toggle checkboxes or a select value; measured in headless Chrome at 4x CPU throttling, opening Preferences, switching each of the four settings and closing gave no layout-shift entry.

### frontend/src/ui/commands.ts · Command.verbatim; frontend/src/ui/menu.ts · PopupMenu.refresh; frontend/src/ui/status.ts · the branch item

- refers-to: frontend/src/ui/commands.ts :: Command; frontend/src/ui/menu.ts :: PopupMenu.refresh; frontend/src/ui/status.ts :: StatusBar constructor (cv-st-branch); frontend/src/extensions/git/index.ts :: activate (keydown on cv-st-branch); frontend/src/extensions/git/refs.ts :: GitRefs.dyn
- kind: rationale
- logged: v0.23.0 · 2026-11-22

A menu row passed every label through `t()`, which is right for command names and wrong for names the person chose: the branch menu's Switch to Branch and Delete Branch rows are branch names, and a branch called `Fetch` or `Pull` would have shown in the interface language. A command with `verbatim: true` keeps its label as written; `GitRefs.dyn` sets it on every branch row. Nothing else sets it, so every other menu reads as before.

The status bar's branch item opened the branch menu on a click but was a plain span, so a keyboard could not reach it and a screen reader did not announce it. It now has `role="button"`, `tabindex="0"` and `aria-haspopup="menu"`, Enter and Space open the menu as a click does, and the pointer shows it can be pressed. The span stays a span so the status bar's spacing and type are unchanged.

### frontend/src/ui/tabs.ts · Tabs (context menu, tab-history)

- refers-to: frontend/src/ui/tabs.ts :: Tabs constructor, menu, menuCommands, menuPath; frontend/src/extensions/git/index.ts :: OPEN_HISTORY listener
- kind: rationale
- logged: v0.23.0 · 2026-11-22

The editor tabs had no context menu. They now have one standalone `PopupMenu` on a private `Commands`, built once, with a single entry, Open File History, shown only for a file tab (a doc whose id is its path; diff, review, graph and preview tabs have other ids) while a workspace is open; on other tabs the browser menu is suppressed and nothing opens. The entry sends `formsubstrate:open-history` ({path, session: null}) on `window`, so this shell module does not import the git extension. Escape closes it, as in the Files panel.
