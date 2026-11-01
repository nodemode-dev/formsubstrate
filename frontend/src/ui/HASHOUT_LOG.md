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
