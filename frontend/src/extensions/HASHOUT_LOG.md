# HASHOUT_LOG · frontend/src/extensions and the workbench · subform

Living log for the extension registry, the files and search extensions, ui/workbench.ts, io/workspace.ts and styles/workbench.css. Source files stay comment-free; what they would have said lives here. The shell-wide log is frontend/HASHOUT_LOG.md.

Current build version: v0.4.0
Last updated: 2026-10-30 · Phase F4

### frontend/src/io/workspace.ts · writeFile and RecentWorkspace

- refers-to: frontend/src/io/workspace.ts :: writeFile
- kind: rationale
- logged: v0.4.0 · 2026-10-30

`expectedMtime` is `number | null`: null means "do not check" (a new file, or Overwrite after a conflict); the engine answers 409 for any number when the file does not exist, so the files extension creates a file with null, not 0. `RecentWorkspace.opened` is the engine's ISO string and `formRepo` is optional, matching Home's RecentEntry.

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
