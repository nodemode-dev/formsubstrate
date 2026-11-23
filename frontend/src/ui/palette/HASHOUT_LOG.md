# HASHOUT_LOG · frontend/src/ui/palette · formsubstrate

Living log for the command palette's symbol search (fuzzy.ts, symbols.ts). Source files stay comment-free; what they would have said lives here. The shell-wide log is frontend/HASHOUT_LOG.md; the palette dialog itself is frontend/src/ui/command-palette.ts.

Current build version: v0.25.1
Last updated: 2026-11-22

### frontend/src/ui/palette/fuzzy.ts · fuzzyScore

- refers-to: frontend/src/ui/palette/fuzzy.ts :: fuzzyScore
- kind: explainer
- logged: v0.12.0 · 2026-10-30

Moved unchanged from command-palette.ts so symbols.ts can rank without a circular import. One change: an underscore now opens a word (`shape_total` is matched at `total` the way `shapeTotal` is), because Python names use it where TypeScript uses a capital. The scoring text in the shell log (v0.2.0) still applies.

### frontend/src/ui/palette/symbols.ts · scopeOf, prefixes

- refers-to: frontend/src/ui/palette/symbols.ts :: scopeOf
- kind: rationale
- logged: v0.12.0 · 2026-10-30

A palette whose text starts with `@` lists the active file's symbols, one starting with `#` searches the workspace; anything else is the command list. The prefix is part of the input so it can be typed, deleted or pre-filled by the two commands (Go to Symbol in File, Go to Symbol in Workspace) without a second mode switch.

### frontend/src/ui/palette/symbols.ts · loadFileSymbols

- refers-to: frontend/src/ui/palette/symbols.ts :: loadFileSymbols
- kind: rationale
- logged: v0.12.0 · 2026-10-30

`@` reuses the editor's own language-server session (`lsp.symbols`, textDocument/documentSymbol), so it sees unsaved edits and starts no second process. The tree is flattened in document order and each row's container is the dotted chain of its ancestors, taken from the depth the outline already reports. Rows are loaded once per visit and filtered locally on every key, so typing needs no request and no debounce. A result with no rows is not cached, so the palette picks the symbols up when a starting server becomes ready. Quiet notes: no folder, no file, file type without a server, server starting, server not running (with the trust sentence when the workspace is not trusted), no symbols, no match.

### frontend/src/io/lsp.ts · SymbolHub, SymbolSession

- refers-to: frontend/src/io/lsp.ts :: symbolHub, SymbolHub, SymbolSession
- kind: rationale
- logged: v0.12.0 · 2026-10-30

`#` needs servers for both languages at once, but the editor only runs a server for the languages of the files that are open, and its sessions are private to ui/editor/lsp.ts. So the palette keeps its own small JSON-RPC client per language over the same relay (`/api/lsp/ws`, the same trust query), started on the first `#` search and closed after 60 seconds without use. It asks only workspace/symbol, so it is a few dozen lines: initialize, initialized, request with `$/cancelRequest` on abort, a 15 s initialize and 8 s request timeout. The relay's per-language limit is two processes, which is the editor's session plus this one; a refusal (close code 4409) shows as "Too many language servers are running". A session that failed or was refused is not retried for four seconds. GET /api/lsp/servers (cached 20 s) decides which languages have a usable server, so a language without one is skipped and no process is started for it. Hits outside the workspace root, or under node_modules, site-packages or __pycache__, are dropped.

Measured with the scratch workspace (tsc 7.0.2 --lsp, pyright 1.1.x): tsc answers workspace/symbol with an empty list until at least one file is opened, so the TypeScript session sends one textDocument/didOpen first (an open document of that language, else the first match of `*.ts` from the workspace search, never a .d.ts or node_modules file). pyright answers with an empty list for the first second or two while it indexes; a session younger than eight seconds that returns nothing is reported as warming, and the palette asks again every 1.2 s, up to five times, while the text is unchanged, showing "Indexing the workspace..." only if there is nothing to show.

### frontend/src/ui/palette/symbols.ts · searchWorkspaceSymbols

- refers-to: frontend/src/ui/palette/symbols.ts :: searchWorkspaceSymbols, slotRows
- kind: rationale
- logged: v0.12.0 · 2026-10-30

Language-server hits are ranked by fuzzyScore on the symbol name (a hit the server matched by other rules sorts after those that fuzzy-match). The optional formslot part adds unit hits from `formslot.find` only when the formslot phase is running and the workspace corpus is indexed; a hit is kept when its last name segment fuzzy-matches the query and no language-server hit has the same path with the same line or name. They come after every language-server hit and carry the badge `slot`. formslot hit paths are workspace-relative, as the formslot panel already assumes. Not checked against a live formslot service in this build (no service was running); the path is guarded by phase and errors return no rows.

### frontend/src/ui/command-palette.ts · symbol modes, row pool

- refers-to: frontend/src/ui/command-palette.ts :: CommandPalette.renderSymbols, CommandPalette.runWorkspace, CommandPalette.paint
- kind: rationale
- logged: v0.12.0 · 2026-10-30

`#` waits 140 ms after the last key, aborts the request still in flight (the abort sends `$/cancelRequest`) and ignores an answer that was overtaken. The old rows stay until the new answer arrives; "Searching..." shows only after 250 ms and only when there are no rows. The list keeps a pool of row nodes that only grows (never more than the largest result seen): rows past the current result are hidden, not removed, so after the first search no row is created or removed and each row's name, kind chip, badge and meta text are patched in place. Rows are keyed by slot, as before. The list now scrolls (scrollbars are never drawn) because a file can have more than twelve symbols; symbol results are capped at 100 and the selected row is kept in view by setting scrollTop. The row template gained a kind chip and a badge cell that only symbol rows show (styles/lsp.css), with fixed column widths so a row never changes size. Opening a hit goes through `onOpenSymbol`, set in app.ts to the workbench's revealLine, which opens the file when it is not open and reveals the line.

### frontend/src/app.ts · go-to-symbol, go-to-symbol-workspace

- refers-to: frontend/src/app.ts :: startApp
- kind: rationale
- logged: v0.12.0 · 2026-10-30

Go to Symbol in File is Alt+Mod+O, not Shift+Mod+O: Shift+Mod+O is already Open File (the family keeps Mod+O for Open Folder). Go to Symbol in Workspace is Mod+T, which no command used. Both are in the Go menu after Go to File and run `palette.show('@')` or `palette.show('#')`; when the palette is already open the call only replaces the text. The palette placeholder names both prefixes.

### frontend/src/ui/palette/files.ts · FileIndex, parseFileQuery, Go to File

- refers-to: frontend/src/ui/palette/files.ts :: FileIndex, parseFileQuery, scoreOf, remember; frontend/src/ui/command-palette.ts :: CommandPalette.show, renderFiles, pageFiles, fileProgress, stopFiles, mark; frontend/src/app.ts :: startApp (go-to-file, onOpenFile)
- kind: rationale
- logged: v0.22.0 · 2026-11-22

Go to File (Mod+P) was a `soon(...)` placeholder; it now runs `palette.show('', true)`, which opens the palette in file mode. In file mode text without a prefix is a file query, `>` switches to commands (the `>` is stripped from the command query), and `@` and `#` work as before; the mode lasts until the palette closes, so deleting the `>` goes back to files. Opened as the Command Palette, text without a prefix is still the command list and a leading `>` is accepted and ignored. Mod+P typed inside an open palette turns it into file mode, and inside file mode moves the selection down (as VS Code does); the global key handler ignores keys while a dialog is open, so without this the browser's print would run.

The engine has no route that returns a flat file list: `/api/workspace/search` returns matching lines, not files, and nothing else under `/api/workspace` walks the folder. So the window builds the list from `/api/workspace/tree` (the Files panel's own route, which already drops `.git`, `node_modules`, `__pycache__`, `.venv`, `venv`, `target` and `dist`), breadth first, six requests at a time (the browser's per-host connection limit), also skipping the folder names in the `hiddenFolders` preference as the Files panel does. Caps: 20,000 files, 5,000 folders, depth 32 (the tree route follows linked folders, so the caps also end a link loop). The walk runs once per palette opening, started by the first file-mode render and stopped on close. The finished list of the last walk is kept for the same workspace root, so a later opening answers from it at once while the new walk runs and swaps in when done; the first opening shows results as folders arrive, re-ranked at most every 120 ms. A failed root listing keeps the previous list.

Ranking: the query is lowercased with spaces removed and backslashes turned into slashes. A file is a candidate only when the query is an in-order subsequence of its path. Without a slash in the query, a name match scores 1000 plus `fuzzyScore` on the file name, plus 20 when the name starts with the query and 40 when the name or the name without its extension equals it; otherwise the path is scored with `fuzzyScore` alone, so every name match sorts above every path-only match. `fuzzyScore` already rewards contiguous runs and word starts (after `/`, `.`, `-`, `_`, a capital) over scattered letters and slightly prefers shorter text. Recently opened files get 8; ties go to the shorter path, then alphabetical. When a typed query extends the previous one and the list has not changed, only the previous matches are scored. An empty query lists recently active files (tracked from the store's `active` event, newest first, 50 at most, cleared when the workspace changes) followed by open tabs not yet in that list.

Rows: ranking keeps the best 500; 50 are shown and 50 more are added when the selection comes within two rows of the end or the list is scrolled to its last two rows. Rows reuse the palette's slot pool (index-keyed, only grows, extra slots hidden), with the plain command row layout: the file icon, the name, and the folder as meta, the full path as the title. The result box keeps its fixed twelve-row height. `mark()` now keeps the selected row in view in every mode, not only symbol modes, so a list scrolled in file mode does not hide the first commands after switching with `>`. "Listing files..." is shown only after 250 ms with no rows during a first walk, and stays put once shown instead of re-arming on every progress render.

A `:line` or `:line:col` suffix is parsed off the query; Enter then opens through the workbench's `revealLine` (which opens the file first when it is not open), otherwise through `openEditorTab`, the call the Files panel makes. File picks are not added to the command recents.

Measured on a 2,000-file, 216-folder scratch workspace in headless Chrome at 4x CPU throttling with 40 ms network latency: the first walk took 2.8 s (213 tree requests), typing `command` a letter at a time cost 77, 47, 31, 13, 19, 12 and 14 ms of script per key (the first key also creates the 50 row nodes, the only nodes ever added), and no layout shift was recorded while the palette was in use.

### frontend/src/ui/palette/files.ts · FileIndex.run reads the flat list

- refers-to: frontend/src/ui/palette/files.ts :: FileIndex.run, FileIndex.walk, FileIndex.stop, FileIndex.abort; frontend/src/io/workspace.ts :: listFiles, WorkspaceFiles; backend/app/routers/workspace.py :: list_files, _list_files
- kind: rationale
- logged: v0.22.0 · 2026-11-22

The engine now has `GET /api/workspace/files` (see backend/app/routers/HASHOUT_LOG.md), so `FileIndex.run` asks for the whole list in one request, passing the `hiddenFolders` preference as repeated `hide` parameters, and fills `fresh` and `truncated` from the answer; the constructor's completion (swap into the cache, `done`, one `changed()`) is unchanged, as are ranking, recents, the per-root cache and paging. `stop()` now also aborts that request. Only a 404 (an engine older than the route) falls back to the tree walk, which is the previous `run` body renamed `walk(hide)` and kept whole with its caps, its six parallel requests and its progressive `changed()` calls, since those still serve that case; any other failure sets `failed` as a failed root listing did. Nothing of the walk was removed, because the fallback still uses all of it. The route skips symbolic links, where the walk listed linked files and followed linked folders (up to its caps), so a linked file or folder no longer appears in Go to File.

Measured on the same kind of 2,000-file, 216-folder scratch workspace in headless Chrome at 4x CPU throttling with 40 ms latency and 1.6 Mbit/s: the first opening made one files request and no tree requests; the list arrived 486 ms after Mod+P and the first match for `mod25file8` was on screen 560 ms after Mod+P (the walk took 2.8 s and 213 requests). With the route answered 404 by the DevTools Fetch domain the walk ran instead (217 tree requests) and found the same rows, with no console errors.
