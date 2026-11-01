# HASHOUT_LOG · frontend/src/ui/palette · subform

Living log for the command palette's symbol search (fuzzy.ts, symbols.ts). Source files stay comment-free; what they would have said lives here. The shell-wide log is frontend/HASHOUT_LOG.md; the palette dialog itself is frontend/src/ui/command-palette.ts.

Current build version: v0.12.0
Last updated: 2026-10-30 · symbol search

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
