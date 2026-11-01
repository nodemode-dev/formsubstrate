# HASHOUT_LOG · frontend/src/ui (pickers, trust, Home) · subform

Current build version: v0.8.0
Last updated: 2026-10-30

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
