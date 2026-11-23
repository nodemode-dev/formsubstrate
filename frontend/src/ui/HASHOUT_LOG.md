# HASHOUT_LOG · frontend/src/ui (pickers, trust, Home) · formsubstrate

Current build version: v0.25.1
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

### frontend/src/ui/settings.ts · lspCard, paintLsp, loadLsp, lspWrite, addLspPreset, saveLsp, removeLsp, openLspForm, closeLspForm, lspFields
- refers-to: frontend/src/ui/settings.ts :: SettingsDialog.lspList, lspNone, lspPresets, lspForm, lspLabel, lspProgram, lspArgs, lspExts, lspLang, lspOptions, lspSave, lspCancel, lspNew, lspStatus, lspCard, lspFields, openLspForm, closeLspForm, paintLsp, loadLsp, lspWrite, addLspPreset, saveLsp, removeLsp, refreshRemote; frontend/src/styles/lsp.css :: .cv-prefs-lsp-row, .cv-prefs-lsp-head, .cv-prefs-lsp-name, .cv-prefs-lsp-sub, .cv-prefs-lsp-form, .cv-prefs-lsp-presets, .cv-lsp-custom-row, .cv-lsp-custom-trust
- kind: rationale
- logged: v0.24.0 · 2026-11-22

Preferences > Language Servers gains a Custom servers card in the Preferences recipe, read on every open with the other remote state. Rows are keyed by id and patched in place (label, Edit, Remove; extensions, language id and command; the install line under a server that was not found). One button per preset adds it at once and is disabled while its extensions are taken; Add custom server and Edit open one form below (Label, Program, Arguments separated by spaces, File extensions separated by spaces or commas with the dot added when missing, Language id, initializationOptions as JSON, parsed before sending). Remove asks with `confirmAction`. The engine's refusal shows in the status line as "The server was not saved: <detail>". Arguments split on whitespace, so an argument with a space cannot be entered from this form; the engine accepts it. Styles in `lsp.css` use tokens only.

Ran in headless Chrome (CPU 4x): add the rust-analyzer preset, edit its label to "Rust", remove it through the confirmation, add it again; cumulative layout shift outside input 0.0000 over the whole run (boot, Preferences, add, edit, remove, re-add, opening main.rs, trusting, hover, definition, completion), no console errors.

### frontend/src/ui/settings.ts · debugCard, loadDebug, saveDebug, paintDebug (Run and Debug card)
- refers-to: frontend/src/ui/settings.ts :: SettingsDialog.debugCard, paintDebug, loadDebug, saveDebug, dbgPath, dbgFound, dbgNode, dbgStatus; frontend/src/io/debug.ts :: debugSettings, saveDebugSettings, debugAdapters
- kind: rationale
- logged: v0.24.0 · 2026-11-22

A Run and Debug card in the Language Servers section, after Custom servers, in the same recipe: one field for the js-debug folder (or its `dapDebugServer.js`), Save, two value rows (the server file that was found, the `node` that was found with its version), a status line and the install note. An empty field means "look in the usual places". A saved path that holds no `dapDebugServer.js` is kept and the status says so, and the found row then shows what the known places gave, if anything. Checked in headless Chrome: a wrong path showed the status and Not found, the right one showed Saved and the server path; layout shift 0, no console errors.

### frontend/src/ui/tasks.ts · installTasks, TaskPicker

- refers-to: frontend/src/ui/tasks.ts :: TasksDeps, TaskPicker, installTasks (apply, poll, watch, start, stop, configure, listing, build, ask); frontend/src/io/tasks.ts; frontend/src/app.ts :: installTasks call, the Run menu; frontend/src/ui/workspace-store.ts :: upsertJob, finishJob; frontend/src/ui/editor/lsp.ts :: setExternal; frontend/src/ui/terminal-dock.ts :: reveal
- kind: rationale
- logged: v0.25.0 · 2026-11-22

Four commands replace the two `soon` placeholders in `app.ts`: `run-task` (Run Task..., the picker), `run-build-task` (Run Build Task, Shift+Mod+B, which moved here from `run-task`), `run-stop` (Stop Task, enabled only while a task runs) and `tasks-configure` (Configure Tasks). Run Build Task runs the one task marked as the default build task, or the only build task when there is exactly one, and otherwise opens the picker limited to build tasks. Stop Task stops the task when one runs and asks which when several do.

The picker is the command palette's recipe on purpose: a `Dialog` with a search field over `.cv-palette-box` and `.cv-palette-list`, whose height is fixed by the existing rule, rows from a pool that only grows (unused rows are hidden, never removed), so nothing moves when the tasks arrive after the dialog is already open. The list carries `data-no-i18n` because labels and command lines are the person's own text and the page translator would otherwise translate a task called `build`; the words around them (`running`, `build task`, `default build task`, `test task`) are translated here before they are joined. A task that failed the engine's check is listed greyed out with the engine's sentence. When the window's own record says the workspace is not trusted the engine is not asked at all and the picker says the workspace must be trusted. When the engine answers `file: .vscode/tasks.json` the line under the list says so.

A running task is a job in the workspace store (`task:<label>`, shown as `Task: <label>`), so the status bar's existing busy item shows it in its reserved width and the jobs list gives it a Stop; no status-bar markup was added. While any task runs the window polls `GET /api/tasks/state` every 0.7 s and stops polling when none does; one read at start and on a workspace change picks up tasks that were already running before a reload. Problems go into the Problems list through `lsp.setExternal('tasks', ...)` only when `seq` moved. When a task this window started ends, a notice says finished or failed with the exit code and the number of problems, with a Show Problems action; a stopped task says nothing. Before the first run or listing the window's trust is told to the engine with `syncTrust()`, the same call the language servers use.

Checked in headless Chrome, CPU slowed 4 times, against a live engine: untrusted picker text, Shift+Ctrl+B ran `npm run build`, the Problems list showed the TS2322 row with source `build` and clicking it opened `src/a.ts`, a long task showed in the busy item and Stop Task ended its process, Configure Tasks opened and (with no file) created the starter. Layout shift outside input: 0 in every phase; no console errors beyond the harness's own refused requests.

### frontend/src/ui/keys-page.ts · KeysPage; frontend/src/ui/commands.ts · adopt, remember, resetKey, add, overrides

- refers-to: frontend/src/ui/keys-page.ts :: KeysPage (sync, fill, beginCapture, endCapture, onKey, onPointer, take, write, resetEvery, ready); frontend/src/ui/commands.ts :: Commands.saved, add, adopt, remember, resetKey, resetKeys, overrides, setKeys; frontend/src/io/keybindings.ts :: adoptSavedKeys, commitKeys, keysLoaded, KEYS_EVENT; frontend/src/ui/settings.ts :: keysPage, the Keys section; frontend/src/app.ts :: keysReady, the KEYS_EVENT listener; frontend/src/ui/menu.ts :: PopupMenu.refresh
- kind: rationale
- logged: v0.25.0 · 2026-11-22

Preferences > Keys is now `KeysPage`, a file of its own so `settings.ts` changed in three places only (the import, the section's content and one line in `sync`). It lists every command, not only those that have a shortcut, so a command without one can be given one. Each row has Change, Remove and Reset; the three controls are always in the row and are disabled when they do not apply, and filtering hides rows instead of removing them, so a row never changes size. The line that carries the prompt and the refusals has a fixed two-line height for the same reason.

Change: the row shows `...` and a capture-phase `keydown` listener on the document takes the next key, stopping it before the dialog's own handler, so Escape cancels the capture and does not close Preferences. Modifier keys alone are waited through. A combination must hold Ctrl or Cmd or Alt, or be a function key: a bare letter would be swallowed by the window's key handler in every text field. A pointer press anywhere else cancels. If the combination belongs to another command a confirm names that command and asks before taking it; taking it removes it from the other command, which then shows as changed. The new combination replaces the command's first shortcut and keeps any further ones. Remove leaves the command with none, Reset puts the default back (taking it back from a command that had been given it), Reset All asks first and clears everything. After a change, focus goes to the row's Change button (or the search field after Reset All), because the button that was pressed may now be disabled and a disabled focused button would leave Escape with nowhere to go.

Storage: `commitKeys` saves `commands.overrides()`, the differences from the defaults, through `PUT /api/keybindings`, one request after another so a slow save cannot land after a newer one. `overrides()` also carries saved entries for commands that are not registered right now (an extension that is off), so saving does not forget them. `Commands.add` applies a saved entry to a command that is registered later, and drops a default key from a late command when a saved entry gave that key to someone else. `adopt` is the load: back to defaults, then the saved entries in file order through `setKeys`.

Load order: `adoptSavedKeys` is started right after the commands are registered and awaited in `startApp` just before the native menus are built and before the document `keydown` listener is added, so no key press is handled with stale bindings. It is not awaited earlier because the lines between create constants (`status`, `home`, `menus`) that callbacks would find uninitialised. The wait is 8 s at most. It was 1.5 s at first, and one run under a slowed CPU then lost the key presses that followed a click on Change; the likely cause, not proven, is that the abort timer ran before the answer was read, which left the page loading again while the keys arrived. Two changes followed: the longer wait, and the page no longer awaits anything before it starts a capture once a load has succeeded. The failure was seen once: five repeats of the sequence before the two changes passed, and so did both full runs after them. If the engine is not there the window starts with the defaults and tries again every 3 s; until a load has succeeded the page refuses changes ("Shortcuts cannot be changed while the engine is offline."), because saving then would overwrite the file with this session's changes only.

Following a change at once: `commitKeys` and a late load dispatch `formsubstrate:keys-changed`; `app.ts` answers with `syncChrome()` (button tooltips) and a rebuild of the native menu, whose accelerators are set at build time. The in-window menus needed one line: `PopupMenu.setItems` returns early when the item list is unchanged, so the shortcut text was the one from the first build; `refresh()`, which runs on every open, now sets it. The palette and the title-bar search read the shortcut when they render.

What cannot be changed here, and the page's note says so: CodeMirror's own keymap (folding, the keys inside the find panel, indenting, extra cursors). Those are not commands. Nothing checks a new shortcut against them; the window's handler runs only when CodeMirror left the event alone, so a clash there means the editor's binding wins while the editor has focus.

Checked in headless Chrome, CPU slowed 4 times: Toggle Side Bar rebound to Ctrl+Alt+Y, the View menu and (for Preferences) the title-bar tooltip showed the new text without a reload, after a reload the new key worked and Ctrl+B did nothing, a bare key was refused, Escape cancelled with Preferences still open, the conflict dialog named Toggle Terminal, Remove wrote `[]`, Reset and Reset All restored the defaults and emptied the file. Layout shift outside input: 0.

### frontend/src/ui/new-session.ts · agent picker; frontend/src/ui/settings.ts · agentsCard, formnetCard

- refers-to: frontend/src/ui/new-session.ts :: AGENT_NOTES, AGENT_MODE_NOTES, NewSessionDialog.agentRows, agentValue, paintAgents, sync, send; frontend/src/ui/settings.ts :: agentsCard, paintAgents, loadAgents, saveAgentPath, formnetCard, paintFormnet, loadFormnet, saveFormnet
- kind: rationale
- logged: v0.25.0 · 2026-11-22

New Session has an Agent field: four fixed radio rows (Claude Code, Codex, Cursor, Antigravity), each one line high with the found path and version, or "Not found. Install it with:" and the install line; a program that is not found is disabled and cannot be picked. The rows and the two note lines exist from construction with reserved heights, so the list arriving from `GET /api/agents` only changes text (the dialog stayed 620 px high through every state). Until the list is known only Claude Code can be picked, as before. The note under the rows says what the picked program gets (MCP servers, gate cards). The permission select hides the modes the program has no documented equivalent for and moves to the first one it has; the note under it says what the mode means for that program. Program names and paths are not translated (`data-no-i18n`).

Preferences, Agents starts with "Agent programs": per program a head, a "Found at" line (one line, ellipsis, full text in the title) and a "Program path" field that is saved on change through the window-key route; the engine's refusal is shown in the status line under the rows. Preferences, Terminal has a FormNET group: the switch, the certificate path field, the proxy line (address and whether it answers), the certificate line (the file found, or where it was looked for) and a three-line status that says which of the five states applies. The Claude Code group, the key and the MCP clients below are unchanged.

Headless Chrome, CPU slowed 4x, live engine with stand-ins: layout shift outside input 0 on load, opening New Session and the list arriving, switching mode, picking each program, starting a Codex session from the window (its row read "Codex interactive"), with one program missing, opening Preferences, the Agents and Terminal pages, saving and clearing a path, flipping the switch and a refused certificate path. No script errors; the only console lines were the browser's own "Failed to load resource" for the three 400 answers that were asked for on purpose.

### frontend/src/ui/ide-link.ts · installIdeLink, ProposalTab
- refers-to: frontend/src/ui/ide-link.ts :: installIdeLink, ProposalTab, liveView, IdeLinkDeps; frontend/src/ui/review/views.ts :: Views, ViewDoc; frontend/src/styles/review.css :: .cv-diff, .cv-diff-pane.is-measuring; frontend/src/app.ts :: boot
- kind: rationale
- logged: v0.25.0 · 2026-11-22
The window half of the Claude Code IDE connection. It posts the open editor tabs, the active file, dirty flags and the main selection to `POST /api/ide/state`, debounced 200 ms and only when the JSON differs from the last post; triggers are the store's workspace, docs and active events and the document's `selectionchange` while focus is in the editor. The selection is read with `EditorView.findFromDOM` on the workbench editor, so `editor.ts` needed no hook; positions are 0-based lines and UTF-16 columns, as VS Code sends them. Only file tabs are reported (`id === path` and not a view).

It listens on `GET /api/ide/events`: `open-file` opens the path through the same function the file tree uses, selects `startText` to `endText` and answers with the line count; `save` saves through the editor host; `diff` opens a `ProposalTab` and `diff-close` withdraws one. The existing `DiffTab` loads both sides from git, so a proposal (text that exists nowhere on disk) gets its own small `ViewDoc` that reuses the diff view's classes and the unified merge view, read-only, with Accept and Reject in the bar. Saving the tab (Mod+S) accepts, closing the tab rejects, as in VS Code. The pane starts with `is-measuring` and shows after CodeMirror's first measure, the same way `DiffTab.settle` does; without it headless Chrome at 4x throttling recorded a layout shift of 0.00008 when the tab opened, with it none.

`app.ts` loads this file with one dynamic import after the editor exists, so it adds nothing to the boot bundle. The command `ide-mention` sends the selection's lines as an `at_mentioned` notification.

### frontend/src/ui/settings.ts · ideToggle, paintIde, loadIde, saveIde (Claude Code in the editor); frontend/src/io/agents.ts · ideLink

- refers-to: frontend/src/ui/settings.ts :: SettingsDialog (ideToggle, ideStatus, paintIde, loadIde, saveIde); frontend/src/io/agents.ts :: ideLink, IdeLinkStatus
- kind: rationale
- logged: v0.25.0 · 2026-11-22

Preferences > Agents gains a "Claude Code in the editor" group with one switch, "Connect Claude Code to this window", read from `GET /api/ide/settings` and written with the window key through `PUT /api/ide/settings`. The status line under it has reserved height (the FormNET status class) and says one of: off; on and starting when a folder is open; on and waiting; on and connected. The note says plainly that the connection follows what Claude Code documents for its VS Code extension and has not been tried with every version of Claude Code.
