# HASHOUT_LOG · frontend/src/extensions and the workbench · formsubstrate

Living log for the extension registry, the files and search extensions, ui/workbench.ts, io/workspace.ts and styles/workbench.css. Source files stay comment-free; what they would have said lives here. The shell-wide log is frontend/HASHOUT_LOG.md.

Current build version: v0.25.1
Last updated: 2026-11-22

### frontend/src/io/workspace.ts · writeFile and RecentWorkspace

- refers-to: frontend/src/io/workspace.ts :: writeFile
- kind: rationale
- logged: v0.4.0 · 2026-10-30

`expectedMtime` is `number | null`: null means "do not check" (Overwrite after a conflict); the engine answers 409 for any number when the file does not exist. Since v0.4.1 `writeFile` takes `create`, and New File sends `create: true`, so an existing file of that name is a 409 instead of being truncated (review). `RecentWorkspace.opened` is the engine's ISO string and `formRepo` is optional, matching Home's RecentEntry.

### frontend/src/io/workspace.ts · module

- refers-to: frontend/src/io/workspace.ts :: currentWorkspace
- kind: explainer
- logged: v0.4.0 · 2026-10-30

Client for the engine workspace routes, all through request() from io/api.ts, which already throws "status detail". statusOf and detailOf read that prefix back so callers can branch on 404, 409 or 415 without a second error type. The engine reply names the folder `root`; the shell store calls it `path`, so openWorkspace and currentWorkspace map it. currentWorkspace returns null on 404 (no folder open yet). Search sends case=true or false always and regex only when on; limit and glob only when set. The abort signal is passed straight to fetch so a newer query cancels the older one.

### frontend/src/extensions/registry.ts · module

- refers-to: frontend/src/extensions/registry.ts :: register
- kind: explainer
- logged: v0.4.0 · 2026-10-30

Ported from substrata frontend/src/extensions/registry.ts (MIT, owner's). Kept: register, activateAll, listExtensions, setEnabled, registerSearchProvider, searchProviders, the required flag, the disabled list in localStorage. Removed: the graph members of Shell (graphAction, onNodeSelected), rightSection, bottomPanel, openMediaTab, registerPreview, insertSnippet, registerView, navigate, closeEditorTab, uninstallLocal and the user-extension loader (loadUserExtensions, origin and version fields). The disabled key is subform.ext.disabled. setup receives an ExtensionContext ({store, commands}) in place of substrata's Engine. toggleBottom stays in the contract as a no-op until the bottom panel exists (F5).

### frontend/src/extensions/registry.ts · SidebarSection

- refers-to: frontend/src/ui/workbench.ts :: Workbench.sidebarSection
- kind: rationale
- logged: v0.4.0 · 2026-10-30

sidebarSection takes render(host) and calls it once with a host the workbench owns; the section never builds its own chrome. It returns the host and reveal(), which shows the panel, expands a collapsed side panel and dispatches a wb-focus event on the host so the extension can put focus in its own field. The extension, not the workbench, knows what to focus.

### frontend/src/ui/workbench.ts · layout

- refers-to: frontend/src/styles/workbench.css :: .cv-wb
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Built once into .cv-stage. A grid of three columns on custom properties: --wb-rail-w 44px, --wb-side-w (the saved width, or 0px when collapsed) and the editor. The rail and panel exist from the first frame, empty until a workspace opens, so opening a folder changes no box (measured: identical rects before and after, no layout-shift entries under 4x CPU throttling). Panels are shown with setHidden; rail buttons are created once as sections register. The .cv-stage-empty text now lives inside the editor area so it never covers the rail. The grip is 5px wide inside the panel at its right edge; dragging reads the width from pointer position divided by the zoom scale (rect width over offsetWidth) so the UI zoom on the html element does not skew it, paints at most once per frame, and writes the pref only on release. Double click resets to 280, arrow keys move 16px. Collapsed and active panel are per-viewer conveniences kept in localStorage subform.workbench inside try/catch; the width is a pref (sidebarWidth).

### frontend/src/ui/workbench.ts · revealLine

- refers-to: frontend/src/ui/workbench.ts :: Workbench.revealLine
- kind: rationale
- logged: v0.4.0 · 2026-10-30

A search hit in a file that is not open must open it at the line; one that is open only needs the cursor moved. The store's docs say which, matched by path, so the editor is asked for the right call. This assumes the doc id and path are the workspace-relative path everywhere.

### frontend/src/extensions/files/index.ts · tree

- refers-to: frontend/src/extensions/files/index.ts :: FilesTree
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Ported in idea from substrata extensions/files/index.ts (MIT, owner's), which rebuilt the whole tree with innerHTML from one flat file list. Here the tree is lazy: one engine call per folder, cached in a Map keyed by folder path, and the visible rows are the flattened expanded folders. Rows are one flat list patched with patchList and keyed d:path or f:path, so expanding a folder inserts only that folder's rows and leaves every other node untouched; update touches an attribute or text only when it differs, so unchanged rows produce no mutation. Folder depth is a --depth custom property. A load in flight marks the folder row is-loading; a failed load or an empty folder adds one note row keyed under the folder. Expand state is saved per workspace root in localStorage (subform.files.open:root, capped at 500 paths). After create, rename or delete only the parent folder's listing is reloaded. The tree is one tab stop with aria-activedescendant and arrow, Home, End, Enter, F2, Delete and the context-menu key.

### frontend/src/extensions/files/index.ts · create

- refers-to: frontend/src/extensions/files/index.ts :: FilesTree.create
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

A new file is written with writeFile(path, '', 0): expectedMtime 0 means "no earlier version", which assumes the engine skips the mtime check when the file does not exist. If the engine rejects 0 the 409 detail is shown in the status bar. Names with a slash or a dot-only name are refused client side; nested creation is not offered.

### frontend/src/extensions/files/index.ts · context menu

- refers-to: frontend/src/ui/menu.ts :: PopupMenu
- kind: rationale
- logged: v0.4.0 · 2026-10-30

PopupMenu takes command ids from a Commands, so the tree owns a private Commands with ft-new-file, ft-new-folder, ft-rename and ft-delete whose run closes over the current target. They are not in the app's command list or palette. The panel gets class cv-wb-context, which sets z-index var(--z-context), above the overlay root's own layer.

### frontend/src/extensions/files/index.ts · PATHS_CHANGED

- refers-to: frontend/src/app.ts :: startApp
- kind: rationale
- logged: v0.4.0 · 2026-10-30

The Shell contract has no closeEditorTab, so after a rename or delete the tree dispatches subform:paths-changed on window with {kind, from, to?}; app.ts closes every open editor buffer at or under `from`. A renamed file is closed, not moved; the user reopens it from the tree. A dirty buffer under a deleted or renamed path is dropped with it.

### frontend/src/extensions/search/index.ts · panel

- refers-to: frontend/src/extensions/search/index.ts :: SearchPanel
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Ported in idea from substrata extensions/search/index.ts (MIT, owner's), which only fed the command palette. The panel keeps the palette provider (prefix "/") and adds the side panel. Input is debounced 180 ms; Enter runs at once; a newer query aborts the older fetch and a stale reply is ignored by comparing the controller. Results are one flat keyed list: a file row (name, folder, count; click collapses its hits) then its hit rows (line, text clipped to 240 characters). The count line has a fixed height and holds the totals with the engine name and, beside it, the truncated note, so neither shifts the list. The list dims through pendingClass (shown only after 300 ms) instead of being cleared. The glob field is behind its toggle; its row appears on demand. The command search-in-files has Shift+Mod+F: comboOf writes modifiers in the order Alt, Shift, Mod, then the key, so Shift+Mod+F is the only spelling that matches a key event (see the Commands entry in HASHOUT_LOG.md).

### frontend/src/styles/workbench.css · module

- refers-to: frontend/src/styles/workbench.css :: .cv-wb
- kind: explainer
- logged: v0.4.0 · 2026-10-30

Rules for .cv-wb-*, .cv-tree-* and .cv-search-*, all on tokens. The three layout numbers (44px rail, 5px grip, row height from --ctl-sm) are local custom properties on .cv-wb. Row hover, selected and current-file states use --bg-hover, --bg-tertiary, --accent-wash and, while the tree has focus, --accent-soft with --accent-line. Twist rotation and the dim transition are switched off by body.animations-disabled.

### frontend/src/extensions/formslot/index.ts · FormslotPanel

- refers-to: frontend/src/extensions/formslot/index.ts :: FormslotPanel
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Built once; search results, manifest files, copies and drift lines are patched with patchList. Results and manifest are both in the DOM and swap by hidden. Search is debounced 260 ms and sequence guarded. The owner Confirm goes through confirmAction. Paths from slot hits are opened as given and assume the corpus is the open workspace.

### frontend/src/extensions/formslot/index.ts · offer

- refers-to: frontend/src/extensions/formslot/index.ts :: register
- kind: rationale
- logged: v0.7.0 · 2026-10-30

The install offer is a persistent toast (ms 0) with Install (warn mode) and Not now. It shows once per workspace path, recorded in localStorage `subform.formslot.offered` (per viewer convenience), only when formslot is installed and the engine says pluginInstalled is false, judged on a status fetched after the workspace opened. Auto start runs once per page load when Preferences allow it.

### frontend/src/extensions/debug/index.ts · panel

- refers-to: frontend/src/extensions/debug/index.ts :: DebugPanel
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Run and Debug sidebar section: toolbar (start, continue, step over, into, out, stop, state text), adapter status line (two lines reserved), arguments field, call stack, variables, debug console with an expression field. Every box has a fixed height or a flex share, so nothing moves as content arrives; lists are patched with patchList, and a local wrapper makes patchList fill a new row at once because the shared helper only calls update on existing rows. Row keys live in data-node, because patchList overwrites data-key. Variable scopes and open nodes are remembered by name path (Locals opens by default) and reloaded at the next stop. Start order follows debugpy: initialize, launch (not awaited), wait for initialized, setBreakpoints, configurationDone, then the launch response. Stepping sets the phase to running at once and keeps the old stack, variables and highlight until the next stopped event replaces them in place. A terminated event or a closed socket ends the session and frees the engine's single slot. Unsaved text in the current file is saved first through the save command (up to 4 s). Not done: pause while running, conditional breakpoints and logpoints, watch expressions, a breakpoints list, a saved launch configuration file, node and other adapters, translations for the new strings, a breakpoint-not-verified marker.

### frontend/src/extensions/lsp/index.ts · panels and status

- refers-to: frontend/src/extensions/lsp/index.ts :: register
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Outline and Problems are two sidebar sections (rail icons code and warning), patched in place with patchList; the empty-state text is absolutely positioned so nothing moves. The status bar slot is a fixed 232 px button that is only visibility-hidden when the active file has no language server, so nothing shifts when it fills; it shows language, state and error and warning counts, and opens the Language Servers dialog (found servers, versions, install commands). The slot is fed by the window event subform:lsp-status, like the git sync event.

### frontend/src/extensions/git/index.ts · paintFlag, flagged, fromReview

- refers-to: frontend/src/extensions/git/index.ts :: GitPanel.paintFlag, GitPanel.flagged, GitPanel.fromReview, FOCUS_COMMIT
- kind: rationale
- logged: v0.7.0 · 2026-10-30

Flagging: a session target fetches `/api/git/audit` with the status and snapshots on every refresh. The flag card is an overlay like the other two cards (no layout shift) and is shown only when neither the check card nor the last-commit card is up; it says `commit <short> has a trailer or another identity` (plus how many more), and its button runs Sign and Push (title text says history is rewritten only on the click). Nothing rewrites history by itself. "Accept all and commit": the review pane already dispatched `subform:focus-commit` and nobody listened. The panel now listens: it reveals the section, retargets to the pane's session, focuses the message box and commits when the box has text (a zero-delay timeout lets the retarget settle). With an empty box it only focuses it. Also from review5 L6: discard and rewind capture the target before their confirm and stop if it changed while the dialog was open; commit sets the audit card only if the target is still the same; a refused push shows `Push refused: <check line>`.

### frontend/src/extensions/debug/index.ts · start, stop, workspace handler, loadScopes, resume, step

- refers-to: frontend/src/extensions/debug/index.ts :: DebugPanel.start, DebugPanel.stop, DebugPanel.sessionRoot, DebugPanel.startSeq
- kind: rationale
- logged: v0.7.1 · 2026-10-30

start() now sets phase starting and paints before its first await, so canStart is false for a second F5, click or Enter; every early return resets to idle, and a start counter makes a start that was stopped meanwhile quit silently. stop() with no connection yet resets directly. The workspace path is remembered; when it changes, breakpoints are cleared, the adapter root is dropped and a session that is not idle is stopped. The root is copied into sessionRoot when a session starts, and path mapping and breakpoint requests use that copy, never the root that refreshAdapter may replace. Waiting for the initialized event is raced against the launch reply, so a launch that fails first ends the start instead of hanging in Starting. A failed variable fetch for one expanded scope is logged and skipped so the rest still load. A failed continue or step puts the phase back to paused.

### frontend/src/extensions/git/index.ts · fromReview

- refers-to: frontend/src/extensions/git/index.ts :: GitPanel.fromReview
- kind: rationale
- logged: v0.7.1 · 2026-10-30

Accept all and commit could commit a draft written for another target, or nothing when staging had not been read yet. When the review pane names a different session the draft is cleared and only focus moves. For the same session the status is refreshed first, a draft is committed only when files are staged, and a busy panel or an empty stage says so instead of doing nothing.

### frontend/src/extensions/formslot/index.ts · copies manifest, markEnabled

- refers-to: frontend/src/extensions/formslot/index.ts :: FormslotPanel.paint, markEnabled; frontend/src/styles/formslot.css :: .cv-fs-prov, .cv-ss-saved, .cv-gate-slot-path
- kind: rationale
- logged: v0.7.1 · 2026-10-30

Copy lines and scores come from MCP JSON, so a one-element lines array printed "5-undefined" and a null score threw inside paint. The range needs two entries, a single entry prints alone, and the score must be a finite number. Layout: the provenance badge in review rows and the diff bar and the saved-tokens span in session rows used to appear and push their neighbours. The root element now carries data-formslot on or off; with it on, the badge keeps a fixed width and uses visibility hidden, and the saved span has a minimum width. Slot paths in gate cards are right-to-left so the tail shows; a left-to-right mark before and after the text stops a leading or trailing slash from jumping to the other end.

### frontend/src/extensions/lsp/index.ts · outline-right

- refers-to: frontend/src/extensions/lsp/index.ts :: setup; /home/claude/ref2/frontend/src/extensions/lsp/index.ts :: outline right-section
- kind: rationale
- logged: v0.10.0 · 2026-10-30

Substrata kept the outline in the right panel; here a second OutlinePanel is mounted in a right section (id outline-right) and the sidebar one stays. Show Outline reveals the right one, Show Outline in the Sidebar the left one. Two instances are independent and cheap.

### frontend/src/extensions/formslot/index.ts · SlotCard

- refers-to: frontend/src/extensions/formslot/index.ts :: SlotCard; frontend/src/styles/formslot.css :: .cv-fsc
- kind: explainer
- logged: v0.10.0 · 2026-10-30

Right-panel card for the active file. It asks slot_find for the workspace-relative path, keeps unit hits whose path equals the file, and checks up to five slot hits with slot_get for the file in their files list. Drift for the file comes from formslotState.driftFor. Fetches run once per file while formslot is running; rows are patched by key and the empty note is absolutely placed, so arriving content shifts nothing. The section is unavailable when formslot is not installed or turned off. The hidden rule for right tabs sits in formslot.css because workbench.css is not in this change.

### frontend/src/extensions/formslot/index.ts · SlotCard, markEnabled

- refers-to: frontend/src/extensions/formslot/index.ts :: SlotCard.sync, SlotCard.paint, setup
- kind: rationale
- logged: v0.10.0 · 2026-10-30

The card tracks `loaded`, the file whose find finished, apart from `fetched`, the file a find was started for. "No slot or unit covers this file" shows only when loaded equals the current file, so nothing claims emptiness while the request runs. Every change of file, including to none, bumps the sequence and clears rows and loaded, so a late answer for a closed file is dropped. The Slots tab is also unavailable while the formslot phase is unknown, so the right panel does not open on Slots and flip to Outline when the first status says it is missing.

### frontend/src/extensions/lsp/index.ts · OutlinePanel

- refers-to: frontend/src/extensions/lsp/index.ts :: OutlinePanel.refresh
- kind: rationale
- logged: v0.10.0 · 2026-10-30

Refresh returns early while the panel has no layout box, and an IntersectionObserver on the host schedules a refresh when the panel becomes visible. Both Outline panels used to send documentSymbol while hidden.

### frontend/src/extensions/formslot/index.ts · SlotCard cache and refresh

- refers-to: frontend/src/extensions/formslot/index.ts :: SlotCard.sync, SlotCard.load; frontend/src/io/formslot.ts :: FormslotState.noteIndexed, FormslotState.indexGen
- kind: rationale
- logged: v0.11.0 · 2026-10-30

Carried LOW from the F7 review, now closed. The card keeps two maps: rows by workspace-relative path and slot_get answers by slot id, both stamped with the workspace corpus name, its head from the formslot status and the index generation. A new stamp (the 5 s status poll sees a new head, or the Index action calls noteIndexed) clears both and refetches the shown file without clearing its rows, so nothing blinks. A save (an open document going from modified to saved) drops that file's cached rows and refetches. Switching back to a file seen under the same stamp paints from the cache with no call. Every slot hit from slot_find is now checked, five at a time, instead of the first five, so a slot listed sixth or later is no longer missed; the rows are painted once at the end. Measured against a mocked engine route at 4x CPU throttle: first visit 1 find and 8 gets, switch away and back 0 calls, save 1 find and 0 gets, new head 1 find and 8 gets, layout shift only the editor cursor.

### frontend/src/ui/titlebar-tools.ts, panels/stage-panels.ts · right panel toggle

- refers-to: frontend/src/ui/titlebar-tools.ts :: TitleTools; frontend/src/ui/panels/stage-panels.ts :: RIGHT_PANEL_EVENT, StagePanels.apply; frontend/src/ui/icons.ts :: panelRight
- kind: rationale
- logged: v0.11.0 · 2026-10-30

The right panel starts closed, so the Outline was not reachable on first run. A toggle button (icon panelRight, is-on and aria-pressed while open) now follows the Show Terminal button in the title bar tools, per the formvis title bar map (section C5, tools in a row of cv-tt-btn). It runs the existing toggle-right-panel command, so Alt+Mod+B and View menu stay the same path. The panel announces a change of visibility with a window event (RIGHT_PANEL_EVENT, only when the visible state changes) so the button follows the panel's own close button too. The panel is still closed on first run; the button is the way in.

### frontend/src/extensions/formslot/index.ts · SlotCard cache

- refers-to: frontend/src/extensions/formslot/index.ts :: remember, SlotCard
- kind: rationale
- logged: v0.11.0 · 2026-10-30

review L8. The card's per-path rows cache is an LRU of 64 paths (`remember` re-inserts on hit and on store and drops the oldest), and the slot detail cache is capped at 256 ids. The window has no per-file watcher; the file-change signal it already receives is the git extension's `subform:git-changed` event, which also follows a Bash write. On it the shown file's cached rows are dropped and the card refetches without clearing its rows first, so the keyed list patches in place and does not flash.

### frontend/src/extensions/system/index.ts · System dialog

- refers-to: frontend/src/extensions/system/index.ts :: SystemDialog
- kind: rationale
- logged: v0.14.0 · 2026-10-30

Ported from substrata `frontend/src/extensions/system/index.ts` (MIT, the owner's). Substrata showed model, tool and plugin counts in a right-rail section; subform has no model of its own, so the dialog shows what the engine reports at `/api/system/status` (version, engine, data folder, git, the `claude` path), the open workspace, the MCP endpoint (`/mcp` of the same origin) and the harness file count, plus Export and Import harness. The dialog is built once on first use (command `system-status`, Help menu) and its value rows are patched in place by `refresh`; a run counter drops a slow answer that a newer open has superseded. Import sends the window token (`owner`) and raises `subform:harness-imported`. The saved file is the inner `{version, files}` object, and import accepts either that or the substrata style `{harness: {...}}` wrapper.

### frontend/src/extensions/welcome/index.ts · readiness check

- refers-to: frontend/src/extensions/welcome/index.ts :: WelcomeDialog
- kind: rationale
- logged: v0.14.0 · 2026-10-30

Ported in purpose from substrata `frontend/src/extensions/welcome/index.ts` (MIT, the owner's), not in content: substrata's wizard chose a model provider, and subform has none. The dialog lists the engine, git, Claude Code, whether an Anthropic key is in the keychain (`hasSecret`, name `anthropic-api-key`, never read back) and the workspace, with buttons for Preferences and Open folder. It shows once on first run (localStorage flag `subform.welcomed.v1`, closed or skipped both set it) 900 ms after setup and only when no workspace is open; every read and write of the flag is in try/catch and a failure counts as seen so a blocked store never nags. The command `welcome` reopens it. Home is not touched: the onboarding agent owns home.ts this turn.

### frontend/src/extensions/runs/index.ts · RunsPanel, registration

- refers-to: frontend/src/extensions/runs/index.ts :: RunsPanel; frontend/src/ui/inspector/index.ts :: NodeInspector; frontend/src/io/runs.ts; frontend/src/styles/runs.css; ref2 frontend/src/extensions/runner, runs, inspector
- kind: rationale
- logged: v0.14.0 · 2026-10-30

Replaces substrata's runner (a task input and Run button in the graph toolbar, polling events), runs (history list plus a drawer) and inspector (per-kind forms) extensions with two right-panel sections, Runs and Node, and one studio action. Run: the bar takes a task and a mode (Simulator or Claude, remembered in `subform.runs.mode`), starts the run with the window token, then tails `/api/runs/<id>/stream` (ndjson with token deltas) and re-dispatches each stored event as `subform:run-event`, which the studio hub already maps onto node status on the canvas (enter running, exit or loop done, parked parked, halt or error error); `resumed` is sent with `status: running` because the hub has no phase for it. `subform:run-finished` is deliberately not sent: the hub clears all statuses on it, and the final colours are what a person wants to look at. Statuses are cleared when the next run starts, and opening a finished run from the list paints that run's last visit status onto the nodes of the current graph, per node and only where it differs (`setNodeStatus` no-ops on equal values, so there is no clear-then-set flicker). Layout is reserved so nothing moves: the run list is a fixed-height region with an absolutely placed empty note, the detail pane takes the remaining height and its parked banner and token stream sit below the events list, the row action buttons are hidden with `visibility`, the status chip has a minimum width. Lists are keyed `patchList`; the run row, event row and log row are built once and filled by one function used by both `create` and `update` (patchList does not call `update` on a node it just created). The Node section is a different job from the studio inspector (which edits label, prompt, tool, arguments, flow and edges): it shows, for the node selected on the canvas, the input, output, error, streamed text, usage and log of each visit in the open run, and edits only the settings the runner added, namely model, tools (read, edit, plan, none) and timeout for agents and evaluators and `approve` for tool nodes. Checked in Chromium at 4x CPU throttle against a live engine: a 4-node producer/critic/revise graph run in the simulator streamed `s w c w c e` running and done onto the canvas, the second visit of the critic was selectable in the inspector, a gated-deploy graph parked and was approved from the panel, layout shift 0 (before the list reservation, chip width and action visibility fixes 0.006), no run, event or log row was removed and rebuilt while a run streamed, no console errors. One real run through the `claude` command (a start, agent, end graph, haiku, no tools) finished with the output `pong` and 16.1k tokens; reopening it from history showed the output, status and cost in the inspector.

- refers-to: frontend/src/extensions/runs/index.ts :: RunsPanel; frontend/src/io/runs.ts :: runsApi
- kind: rationale
- logged: v0.14.0 · 2026-10-30

Security review changes: start and rerun send `workspaceTrusted()` as `trusted` (the engine refuses claude mode and tool nodes otherwise, and the panel shows its message as a toast). The parked banner now reads `parks[0]` and names its park id on Approve, Deny and Resume, shows the full arguments or full diff in the banner, and a count when more than one park waits, so each decision applies to the command displayed. `interrupted` runs (engine stopped while running or parked) use the failed colours and can be rerun or deleted. The node `approve` hint now says every tool except list_files and read_file always waits.

### frontend/src/extensions/welcome/index.ts · key row reads the index status

- refers-to: frontend/src/extensions/welcome/index.ts :: WelcomeDialog.refresh, STEPS; frontend/src/io/secrets.ts :: secretStatus, secretStatusText
- kind: rationale
- logged: v0.19.0 · 2026-11-22

The engine answers a secret's status from its index and never reads the keychain for it (see `backend/app/services/HASHOUT_LOG.md`, secret_store entry of v0.19.0), so opening Welcome causes no keychain prompt. The row used `hasSecret` and showed "Saved in the system keychain" or "Not set"; it now calls `secretStatus` and shows `secretStatusText`: "Saved in the system keychain", "Saved in a file only you can read" (a computer with no keychain), "Not set", or "Not checked yet" for a key the engine has not confirmed since an update. The row's hint says what that last state means and that saving the key again settles it. Removed: `const present = await hasSecret(KEY_NAME);` and `present ? t('Saved in the system keychain') : t('Not set')`.

### frontend/src/extensions/blocks/snippets.ts · Media block image is inline

- refers-to: frontend/src/extensions/blocks/snippets.ts :: SNIPPETS (media)
- kind: removed-code
- logged: v0.19.0 · 2026-11-22

The Media block inserted `<img src="https://<placeholder image service>/560x360" alt="" style="width:100%;border-radius:12px" />`, the service being the public placeholder image site named "placehold" on the `.co` domain (its address is not written out here so a search of the tree for it stays empty), so every preview of a page using it fetched an image from that site. It is now an SVG data URI (a tinted 560 by 360 frame, a circle and a hill line, all `fill="currentColor"` with low `fill-opacity`, no tokens and no text), with `width="560" height="360"` so the space is reserved before paint, and `height:auto` so it keeps its ratio at `width:100%`. A file under `frontend/public` would not work: the snippet is pasted into the person's own HTML file, where that path does not exist. Inside an `img` an SVG does not inherit the page colour, so `currentColor` resolves to black and the low opacity gives a neutral grey on light and dark pages. A `git grep` for that address finds nothing.

### frontend/src/extensions/triggers/index.ts · TriggersPanel.syncRecipes patches the recipe options

- refers-to: frontend/src/extensions/triggers/index.ts :: TriggersPanel.syncRecipes; frontend/src/ui/dom.ts :: patchList
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

The recipe select was rebuilt when the list of names changed: `this.recipe.replaceChildren(...names.map((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; return o; }));` and then `if (names.includes(current)) this.recipe.value = current;`. The options are now patched with `patchList`, keyed by the recipe name: a new recipe adds one option, a removed one takes its option away, the rest stay where they are. The select, its focus and its enhanced dropdown stay; the chosen recipe is written back only when it is still listed and the value differs.

### frontend/src/extensions/cogentics/members.ts · fillModels patches options and groups by key

- refers-to: frontend/src/extensions/cogentics/members.ts :: fillModels; frontend/src/extensions/cogentics/rich.ts :: patchFilled
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

The model select was emptied and refilled whenever the catalogue, the CLI list or the member kind changed: a `nodes` array of new options and optgroups, `select.replaceChildren(...nodes);` and `select.value = '';`. It is now patched with `patchFilled` at two levels: top-level entries keyed `o:<id>` for an option (the default model, or each CLI model) and `g:<vendor>` for an optgroup, and each optgroup's models patched inside it keyed `o:<id>`. Labels, values and group labels are rewritten in place only when they differ. The `data-filled` check that skips an unchanged fill stays. The value is kept when the same model is still listed and set to the empty default otherwise, which is what the old code always did.

### frontend/src/extensions/welcome/index.ts · Preferences opens at the key's card

- refers-to: frontend/src/extensions/welcome/index.ts :: WelcomeDialog constructor (Preferences button); frontend/src/ui/settings.ts :: formsubstrate:open-settings
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

Welcome's only setting is the Anthropic API key row, and its Preferences button opened Preferences wherever it was last left: `document.dispatchEvent(new CustomEvent('formsubstrate:open-settings'))`. It now sends `{ detail: { section: 'Agents' } }`, so Preferences opens scrolled to the Agents card that holds the key, with its rail tab chosen and the wire on it.

### frontend/src/extensions/search/index.ts · Replace all with a preview

- refers-to: frontend/src/extensions/search/index.ts :: SearchPanel.startPreview, confirmReplace, leavePreview, loadDiff, previewLines, paintDiff, paintCount, FILES_WRITTEN; frontend/src/extensions/search/preview-diff.ts :: mountDiff; frontend/src/io/workspace.ts :: previewReplace, replaceInFiles; frontend/src/styles/workbench.css :: .cv-search-replrow to .cv-search-diffnote
- kind: warning-context
- logged: v0.22.0 · 2026-11-22

The replace row sits under the query row and is always shown, so it never moves the list. Replace all (the swap button, or Enter in the field) asks the engine for a preview and switches the same results container to preview rows, patched by key (`p:f:`, `p:h:`, `p:d:` beside the search rows' `f:` and `h:`), so the change is a keyed patch and not a rebuild. A file row has a checkbox; a hit row shows the unchanged start and end of the line with the changed middle as a struck deletion and an insertion (one span from the first to the last change on the line, so two matches on a line show as one change). Clicking a file row, or Enter on it, opens a diff row of a fixed height (`--search-diff-h`, 240px, with `contain: strict`), so opening it moves only the rows under it and its content never changes its size; the diff loads through the preview route with `full: true` for that one file and is drawn by `preview-diff.ts`, loaded on first use, with the review's own unified recipe from `ui/review/diff-view.ts` (`unifiedMergeView` with `mergeControls: false`, gutter, change highlights, deleted-line highlighting and `collapseUnchanged` margin 3, minimum 6, read only, editor theme and highlight, the language when it loads) and hidden by `is-measuring` until CodeMirror has measured. Views are destroyed when their row leaves the list. Space toggles a file's checkbox from the keyboard; Escape leaves the preview.

The counts row (fixed height) holds the totals for the checked files and the Replace and Cancel buttons, so they appear without a shift. Typing in the query, glob or replacement, or turning a flag, leaves the preview, because it would no longer describe what is written. Replace goes through `confirmAction` with the totals. A file with unsaved changes in an open tab (the store's `docs[].modified`) is shown unchecked and disabled with "Unsaved changes in an open tab", is checked again at confirmation (a tab may have changed while the dialog was open), and is never sent; a toast names those files. The request carries each file's hash and the hit line numbers from the preview, so the engine refuses a file changed since then and replaces only what was shown. Up to three refusals are toasted with the engine's reason and the rest counted. The panel then runs the search again, which patches the list in place.

After a write the panel dispatches `formsubstrate:files-written` (`FILES_WRITTEN`, detail `{paths}`) and `formsubstrate:git-changed`. Reloading clean open tabs needs the editor host, which extensions cannot reach (`Shell` has no reload, `EditorHost.reloadFromDisk` is private, and `transact` would leave the tab marked modified with an old mtime). Until `app.ts` listens for `FILES_WRITTEN` and asks the editor to reload each path that is open and not dirty (a public wrapper around `reloadFromDisk`, which replaces the document in one transaction with `userEvent: 'input.reload'` and so does not flash), a clean open tab keeps its old text and its next save meets the existing 409 conflict dialog, whose Reload button loads the new text. Checked in headless Chrome (CPU 4x, network throttled) against a live engine on port 5653 with ripgrep hidden from the router: search, preview of three files, a diff, confirmation and the write; cumulative layout shift 0 (the one shift was the diff row opening after a click, 0.011 with recent input), no console errors, and the three files changed on disk; with one of them dirty in an open tab it was shown disabled and left unchanged while the other two were written.

### frontend/src/extensions/git/refs.ts · GitRefs (branch menu, Stashes, Tags)

- refers-to: frontend/src/extensions/git/refs.ts :: GitRefs, REFS_HTML, BranchDialog, StashDialog, TagDialog, RefsHost; frontend/src/extensions/git/index.ts :: GitPanel constructor, openBranchMenu, gitRefs, refresh, paint, paintFoot, register (git-branch-menu, git-branch-create, git-fetch, git-pull, git-stash, git-tag, status bar click); frontend/src/io/git.ts :: GitError.extra, Branch, Branches, Stash, Tag, GitRefusal, git.branches to git.pushTag; frontend/src/styles/git.css :: .cv-sc-refs to .cv-sc-dlg-problem
- kind: warning-context
- logged: v0.23.0 · 2026-11-22

The foot's branch line is now a button (branch icon, name, chevron) that opens a `PopupMenu` built on a private `Commands`: Create Branch, Switch to Branch and Delete Branch submenus, Fetch, Pull, Pull with a Merge Commit, Stash Changes and Create Tag. Branch rows are commands added on demand (`sw:<name>`, `del:<name>`, `tp:<remote>` for the tag push menu) and removed when the branch is gone, so `setItems` only rebuilds the menu when its item list really changed. Branch names pass through the menu's `t()` like every label; a name equal to an English key would show translated. Branches checked out in another worktree (agent sessions) are shown disabled under Switch and left out of Delete. On a session target `Commands.blocked` disables switch and both pulls with "A session keeps its own branch; choose Workspace in the target list to switch or pull", and the Create dialog turns its "Switch to the new branch" box off. The status bar's `.cv-st-branch` lives in `ui/status.ts`, which this extension may not edit, so a delegated document click on it reveals Source Control and opens the same menu at the item; it has no pointer cursor or button role of its own.

The Stashes and Tags sections sit under Snapshots, each a fixed 124px block in the snapshot recipe (bar with count and an add button, list patched by key `s:<sha>` and `t:<name>`, empty note absolutely placed), so data arriving never moves anything. Stash rows offer Apply (keep), Pop and Drop (confirmed, danger); Tag rows offer Push (confirmed; with more than one remote a small menu picks it). The three lists are read with the panel's existing refresh (one `Promise.all`, so the 5 s poll gains three cheap reads) and when the menu opens. A switch that git refuses for local changes comes back as `GitError.extra.overwrite`; the panel asks "Stash and Switch", stashes with untracked files under the message "Before switching to <b>" and switches again, never discarding. A diverged pull asks whether to pull with a merge commit instead. A refused unmerged delete asks a second, danger confirmation before sending `force`. Dialog fields are `cv-field` rows translated by `Dialog.relabel`; the `From` select is enhanced with a filter. `confirmAction` does not translate its button label, so the labels are passed through `t()` here.

Checked in headless Chrome (CPU 4x, network 80 ms and 1.5 Mbps) against an engine on port 5659 serving the /tmp build, a scratch data folder and a clone under /tmp: switch to a branch from the menu, create and switch, stash with an untracked file and pop it, the overwrite refusal followed by Stash and Switch, an annotated tag created and pushed to the bare remote, and the status bar item opening the menu. Layout shift without recent input 0 (0.00006 with input); the only console error was the browser's own line for the intended 409 of the refused switch.

### frontend/src/extensions/git/index.ts · Merge Changes group, takeSide, markResolved, noteConflicts, OPEN_CONFLICT

- refers-to: frontend/src/extensions/git/index.ts :: GitPanel.entries, update, onList, openRow, noteConflicts, takeSide, markResolved, apply, OPEN_CONFLICT; frontend/src/io/git.ts :: git.stage, git.takeSide, GitRefusal
- kind: rationale
- logged: v0.23.0 · 2026-11-22

Conflicted files leave Changes and sit in their own group at the top, "Merge Changes", keyed `h:merge` and `f:merge:<path>`, so the group appears and goes by `patchList` adding or removing those rows; the other rows keep their nodes. A merge row's actions are Accept All Current, Accept All Incoming (`POST /api/git/conflicts/take`) and Mark Resolved (stage); its head has no stage-all or discard-all, and stage-all and discard-all of Changes leave conflicted files out. Clicking a merge row opens the file in the editor for the workspace and the diff tab for a session. Mark Resolved stages; a 409 with `markers` asks "this file still has conflict markers; stage it anyway?" (path:line shown) and stages with `force` only on Stage. After a take, the panel dispatches `formsubstrate:files-written`, so a clean open tab reloads in place. `noteConflicts` says, in the panel's notice card, how many files still have conflicts whenever that number changes for the target, and "No merge conflicts remain." when it drops to 0. The review pane's Open to Resolve sends `formsubstrate:open-conflict` ({path, session}), which this extension handles because it holds `shell.openEditorTab`.

Checked in headless Chrome (CPU 4x) against a live engine and a /tmp merge (text, binary, deleted on ours, and the 20-block file): the four rows in Merge Changes, the marker dialog and Cancel (still UU), Accept All Incoming reloaded the open f.txt tab, binary taken from feature, the readable refusal for the deleted side and then Accept All Incoming, Mark Resolved with no dialog after the editor actions, the group gone and Staged Changes shown, then Commit from the box made `Merge branch feature` with two parents and a clean tree. A stash pop conflict with diff3 markers showed the base tint and the labels Updated upstream and Stashed changes, and the forced stage put the markers in the index. No console errors; the only shift outside input is the 0.00044 gutter shift noted in frontend/src/ui/editor/HASHOUT_LOG.md.

### frontend/src/extensions/git/history.ts · FileHistory, HISTORY_HTML, OPEN_HISTORY (File History)

- refers-to: frontend/src/extensions/git/history.ts :: FileHistory, HISTORY_HTML, OPEN_HISTORY, HistoryHost; frontend/src/extensions/git/index.ts :: GitPanel constructor (history, row contextmenu), fileHistory, register (git-file-history, OPEN_HISTORY listener, activeFile); frontend/src/extensions/files/index.ts :: defineMenu (ft-history), showMenu; frontend/src/ui/tabs.ts :: Tabs constructor (tab-history); frontend/src/io/git.ts :: git.fileLog, git.show
- kind: rationale
- logged: v0.23.0 · 2026-11-22

File History is a section of the Source Control panel, as VS Code's Timeline is a section under Explorer: it sits under the changes list and above Snapshots, hidden until a history is opened, and when shown it has a fixed height (the bar plus six 38px rows, `contain: strict`), so rows arriving, paging and the empty or loading note never move anything; only its own appearance after a click or a palette command moves the sections below it, and that shift is input-driven. Entry points: the editor tab's context menu (`ui/tabs.ts`, which had no context menu; one entry, file tabs only, i.e. docs whose id is their path), the Files panel's context menu on a file (`ft-history`), the context menu of a Source Control file row (for the panel's current target, so a session row reads the session worktree), and the palette command Open File History (`git-file-history`, for the active file tab). Tabs and Files send `formsubstrate:open-history` ({path, session}) so neither imports the git extension; the git extension reveals the panel and opens the section.

Rows come from `GET /api/git/log?path=` 50 at a time. The list is a slot pool: keys are `s:<index>`, not shas, so opening another file rewrites the same nodes in place; the Load More row is the slot one past the last row, so after a page arrives that same node becomes row 51 and the new rows are appended below it, and nothing that was on screen moves (patchList keeps `s:50` and appends `s:51` on). A row shows the status letter (A, M, D, R), subject, short sha, author, relative time (the existing Just now, min ago, h ago, d ago keys, then a date) and the signature letter in a small box, coloured as the panel's audit colours it and titled with the panel's signature text (passed in by `GitPanel`, which owns `SIGNATURE`); N is kept invisible so the width stays. The row title has the full sha, author and email, date and the file's path in that commit. Click or Enter opens the diff tab through `formsubstrate:open-diff` with `commit` and `short` (read only, against the first parent); the context menu has Open Changes and Copy Commit Hash (clipboard, with the Copied and Copy failed toasts). A folder answers "A folder has no file history. Choose a file."; an untracked file, or one with no commits, "No history: this file has no commits or is not tracked by git.". Any `formsubstrate:git-changed` reloads the open history with as many rows as are shown (at most 500), patched in place; a workspace change closes it.

Checked in headless Chrome (CPU 4x) against an engine on port 5658 serving the /tmp build, a scratch data folder and a /tmp repository with a 300-commit file, a rename, a merge and a binary: opened from the Files menu (50 rows and Load More), paged twice (100 then 150 rows, 281 and 180 ms; the Load More slot `s:50` became a row), opened three diffs (rows 1, 61 and 141, tabs titled `many.txt (<short>)`, badge "Workspace · <short> · Against the first parent · read only"), Copy Commit Hash put the full sha on the clipboard, the editor tab menu on new.txt listed M, R, M, A across the rename, the rename diff said "Renamed from old.txt" and the add had an empty left side, the palette command opened the active file's history, b.bin showed the binary note, loose.txt and a folder showed their notes, and a Source Control row opened conf.txt's history. Layout shift outside input 0 for the whole run (0.032 with input, from the section appearing); no console errors.

### frontend/src/extensions/lsp/index.ts · ServersDialog (custom section), describe, emptyReason, STATE_WORD
- refers-to: frontend/src/extensions/lsp/index.ts :: STATE_WORD, untrusted, trustNeed, emptyReason, ServersDialog.customList, ServersDialog.customNone, ServersDialog.trustRow, ServersDialog.bind, ServersDialog.show, ServersDialog.paintCustom, describe, setup
- kind: rationale
- logged: v0.24.0 · 2026-11-22

The status item names a custom server by its label. An untrusted refusal reads "<label> · needs trust" with the title "Trust the workspace to run <label>. Open Language Servers to trust it."; the Outline says the same. Go > Language Servers (and a click on the status item) gains a Custom servers section: one keyed row per server patched in place (label, state, extensions and program path, the first install line when the program was not found), an empty note, and, when the workspace is not trusted, a row with the trust banner's own action (`setTrusted(path, true)`), after which the dialog repaints once the engine has heard. The foot gains Preferences, which opens Preferences. `show` now reads the listing before it opens the dialog, so the sections paint their final size before the dialog is shown; while open it repaints on custom changes, trust changes and language state. Removed from `show`: `this.open();` as its first line and `let servers: LspServerInfo[] = []; try { servers = (await lsp.servers()).servers; } catch { servers = []; }`.

### frontend/src/extensions/lsp/index.ts · lsp-quick-fix, lsp-source-action, lsp-organize-imports

- refers-to: frontend/src/extensions/lsp/index.ts :: register (setup); frontend/src/ui/editor/code-actions.ts :: quickFix, sourceActions, organizeImports, bindEditorMenu
- kind: rationale
- logged: v0.24.0 · 2026-11-22

Three commands beside the other language commands, all enabled like them (a file a server can attach to): `lsp-quick-fix` (Quick Fix..., Mod+.), `lsp-source-action` (Source Action..., the list for `only: ['source']`) and `lsp-organize-imports` (Organize Imports, Alt+Shift+O, applies the first `source.organizeImports` answer). Each says so in an info notice when the server has nothing to offer. `bindEditorMenu(ctx.commands)` hands the window's command registry to the editor's context menu, which is built in `ui/editor/code-actions.ts` because `ui/editor` cannot import the registry of an extension. The key string is written in the order `comboOf` builds it (Alt, Shift, Mod), so `Alt+Shift+O` matches; `Shift+Alt+F` on `lsp-format`, written the other way round before this change, cannot match by that reading of `comboOf` (not tried in a browser) and was left as found. The commands are not in the Go menu: `app.ts` owns the menu bar and was outside this change; they are in the palette and the editor's context menu.

### frontend/src/extensions/debug/index.ts · Watch, LaunchPicker, logpoints, capabilities, Node.js
- refers-to: frontend/src/extensions/debug/index.ts :: DebugPanel (loadWatches, addWatch, editWatch, commitWatch, paintWatch, evalWatches, idleWatches, toggleWatchNode, wantedKind, canStart, start, sendBreakpoints, onEvent, missingText), LOG_MARK, LOG_TAG, JS_DEBUG_STEPS, register; frontend/src/extensions/debug/launch.ts :: LaunchPicker, recallFor, keepFor; frontend/src/io/debug.ts :: launchFile, createLaunchFile, capabilitiesOf, DapConnection.open; frontend/src/styles/debug.css :: .cv-dbg-cfg to .cv-dbg-wacts
- kind: rationale
- logged: v0.24.0 · 2026-11-22

Watch is a fixed-height section between Variables and the console (head, four rows, an input that adds on Enter), so adding, evaluating and expanding never move another section. Expressions are kept per workspace in `localStorage` (`formsubstrate.debug.watch`, 40 at most). They are evaluated with `context: "watch"` in the selected frame after every stop, every frame change and every console evaluation, one after another, each row patched as its answer arrives (rows are keyed `w<id>` and children `w<id>/<name>`, so stepping rewrites text in the same nodes). An error shows in the row in the danger colour; with no paused program the value reads "not available". A value with `variablesReference` expands like a variable. Edit is a double click or the pencil (the name becomes an input in the same row), remove is the cross; both buttons are real buttons shown on hover or focus.

The picker lists Current File and the launch file's configurations (dynamic names, not translated); one that cannot run is disabled with the reason as its title. Under it one fixed line says where the list came from: the file, the `.vscode` fallback, the ignored fields, a parse problem, or that the workspace is not trusted. The gear opens the launch file, or writes the starter first (Add Configuration, also a palette command). The choice is kept per workspace. With a configuration chosen the Arguments input is off (they come from the file). F5 runs the choice. Current File picks the adapter from the extension (`.py`, or `.js .mjs .cjs .ts .mts .cts`). The listing is read again on panel focus, on a trust change, when a `launch.json` tab is saved, and before every start.

Logpoints: debugpy and js-debug with `outputCapture: std` send a logpoint's text as an ordinary `output` event without a source, so the message the adapter gets is prefixed with U+2063, an id, U+2063 (invisible, written as an escape), and the console turns that prefix into `file:line` and the `log` line kind. The debuggee's own stdout never contains it, because the adapter prints logpoints itself.

Breakpoints are sent with their condition, hit condition and log message; disabled ones are left out; one whose field the adapter does not support is left out and named in the console (sending it bare would make it stop every time). Scope names repeat in js-debug (two Block scopes), so scope keys are made unique. `evaluate` passes the frame id only when a frame is selected, by membership and not by truthiness, because js-debug's first frame id can be 0. When js-debug or node is missing the meta line and the console say what to do (`JS_DEBUG_STEPS`); Preferences has the field.

Checked in headless Chrome, CPU 4x, against an engine on port 5656 with a /tmp data folder and workspace: Python: `i == 3` stopped once at loop.py:12 with i = 3 and the watch `i * 10` = 30, a dict watch expanded to five children, an error watch showed NameError, ten steps (into and over) with the three watch rows keeping their nodes and `i * 10` going 30 to 40, a frame change re-evaluated, edit and remove, logpoint `i is {i}` printed `loop.py:13  i is 0` to `5` without stopping, the configuration "Loop with args" printed its args and env; Node.js: `i === 3` stopped once at app.js:7, watches updated over four steps, six logpoint lines. Untrusted: the note says why and the list is only Current File. Layout shift without recent input 0 for all of it (the only entry is the status bar's 0.00105 at boot, not from this panel); with input 0.0147, from the inline input opening and closing; no console errors.

### frontend/src/extensions/lsp/index.ts · lsp-format (shortcut)
- refers-to: frontend/src/extensions/lsp/index.ts :: activate (lsp-format)
- kind: fix
- logged: v0.24.0 · 2026-11-22

The Format Document shortcut was registered as 'Shift+Alt+F', but `comboOf` in frontend/src/ui/commands.ts builds combinations as Alt, then Shift, then Mod, and the key map is looked up by exact string, so the shortcut never fired. It is now 'Alt+Shift+F', the order every other command uses. Removed: `keys: ['Shift+Alt+F']`.
