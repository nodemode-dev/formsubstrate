# HASHOUT_LOG · frontend/src/ui/editor · subform

Living log for the code editor (editor.ts, languages.ts, theme.ts) and styles/editor.css. Source files stay comment-free; what they would have said lives here. The shell-wide log is frontend/HASHOUT_LOG.md.

Current build version: v0.4.0
Last updated: 2026-10-30 · Phase F4

### frontend/src/ui/editor/theme.ts · gutters

- refers-to: frontend/src/ui/editor/theme.ts :: editorTheme
- kind: rationale
- logged: v0.4.0 · 2026-10-30

The gutter and the active-line gutter paint --bg-primary, not transparent: with word wrap off, a line scrolled sideways otherwise showed its text through the line numbers (seen in the F4 exit check after a search hit opened at a far column). The gutter element has --space-4 on its right so numbers never touch the text.

### frontend/src/ui/editor/editor.ts · EditorHost (single view, one state per document)

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Ported from substrata frontend/src/ui/components/editor.ts (MIT, owner's), restructured. Substrata built one EditorView per tab and toggled `.active` on sibling bodies. Here there is exactly one EditorView and one EditorState per open document; showing a document is `view.setState(doc.state)`. Why this shape: (1) the history() field lives inside EditorState, so every document keeps its own undo stack for free and `setState` swaps it atomically; (2) the host never gains or loses a node on a switch, only CodeMirror's own content DOM is rebuilt synchronously inside one task, so there is no paint with an empty or half state (measured: host box identical, .cv-editor, .cv-editor-mount, .cm-editor, .cm-scroller, .cm-content are the same nodes after twelve switches, zero childList mutations on the host); (3) one view means one set of observers and one measure loop instead of N hidden views. Before a swap the outgoing `view.state` is stored back on its Doc and `view.scrollSnapshot()` is saved; after the swap the snapshot is dispatched, so scroll position and selection return per document. Layout-shift observer: the only reported shifts on a switch are about 0.004 each on `.cm-gutterElement` nodes inside CodeMirror's own content (line heights re-measured in its measure pass); the host box itself never moves.

### frontend/src/ui/editor/editor.ts · EditorHost.open, show, close

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.open
- kind: explainer
- logged: v0.4.0 · 2026-10-30

open() loads once (a pending map de-duplicates concurrent opens of one path), builds the state, then shows it unless a newer open/show superseded it (`showSeq` counter), so a slow load can never steal the view from a document the user already switched to. The previous document stays on screen while loading: no empty frame. show(path) for a document that is not loaded yet calls open(path). A load error is reported through deps.onStatus and open() resolves without throwing (the shell tab for it still exists in WorkspaceStore; the integrator may close it). close(path) drops the Doc; if it was the shown one the view gets a read-only blank state and the empty message (`.cv-editor-empty`) is revealed by the hidden flag, nothing is removed. Integrator closing one doc and showing the next in the same task never paints the empty state.

### frontend/src/ui/editor/editor.ts · dirty tracking

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.syncDirty
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Substrata set dirty on any doc change. Here a Doc keeps `saved: Text` (the immutable CodeMirror Text at last load or save) and dirty is `!state.doc.eq(saved)`, a structural comparison that shares tree nodes so it is cheap. Consequences: undoing back to the saved text clears dirty; typing during an in-flight save keeps the document dirty (the saved snapshot is the Text captured when save began, not the latest). onDirty fires only when the flag flips.

### frontend/src/ui/editor/editor.ts · line endings

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.save
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

CodeMirror splits on \r\n, \n and \r and `doc.toString()` joins with \n, so a naive save would silently convert CRLF files to LF. Each Doc records the dominant ending at load (CRLF if \r\n lines outnumber bare \n lines) and save uses `doc.sliceString(0, length, eol)`. A file with mixed endings is normalised to the dominant one on save. Lone \r endings are treated as \n. Checked: a CRLF file saved as `xone\r\ntwo\r\n`.

### frontend/src/ui/editor/editor.ts · save conflict

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.resolveConflict
- kind: rationale
- logged: v0.4.0 · 2026-10-30

A rejection whose message starts with "409" opens confirmAction with Overwrite (danger button, ok result) and Reload (the cancel button). confirmAction returns false for Reload, Escape, the close button and a scrim click alike, so the false branch must never be destructive. Reload therefore does not throw the text away: it loads the disk copy and applies it as one ordinary transaction replacing the whole document (userEvent input.reload), so history keeps the user's text and Ctrl+Z restores it (the doc then reads dirty again against the new baseline). Overwrite re-sends with expectedMtime null. save() returns true only when text reached disk. Other save errors only report through onStatus and return false.

### frontend/src/ui/editor/editor.ts · extensionsFor

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.extensionsFor
- kind: todo
- logged: v0.4.0 · 2026-10-30

Extension point for later phases (LSP, diagnostics, breakpoints, diff markers). `extensionsFor` is a public field defaulting to `() => []`; it is read when a document's state is built, into a per-document `extra` Compartment. Assign it before the first open, or call `refreshExtensions(path)` later to reconfigure an already-open document (that updates the live view or the stored state, no history entry). Substrata's lspExtensionsFor, lspFormatBeforeSave and breakpointExtensionsFor are removed with their imports; format-before-save needs a hook in save() when the LSP phase lands.

### frontend/src/ui/editor/editor.ts · removed substrata features

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost
- kind: removed-code
- logged: v0.4.0 · 2026-10-30

Removed from substrata's mountEditor: the graph tab and the Engine (loadFromText, toText, changed events, GRAPH_LS), the tab strip and tab buttons (the shell's `.cv-doc-tabs` renders WorkspaceStore docs), the preview modes (split, preview only, pop-out float window, vsplit drag, registerPreview, EditorPreview type), the media tabs (openMedia, mediaKindFor, MEDIA_EXT: EditorDeps.load returns text, so there is no byte source for a blob URL; binary extensions are refused with a status line instead of showing garbage; todo for a later phase: add a `url(path)` or `loadBlob` dep and a hidden `<img>` that is patched in place), file drop (openDropped, ed-dropping), insertAtCursor and reveal (replaced by revealLine), the localStorage keys for wrap and float geometry (options now come from the caller via setOptions; prefs persistence belongs to the preferences module), the window event `substrata:editor-wrap` and `substrata:editor-active`, and the `cmView` debug hook. All DOM construction by innerHTML is gone: the host is built once with `el`.

### frontend/src/ui/editor/editor.ts · setOptions

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.setOptions
- kind: explainer
- logged: v0.4.0 · 2026-10-30

fontSize (clamped 8 to 32) is a CSS variable `--cv-editor-fs` on `.cv-editor`, read by the theme, followed by `view.requestMeasure()`; no state change. tabSize (1 to 8, sets EditorState.tabSize and indentUnit) and wordWrap go through per-document Compartments. Because inactive documents hold stale states, each Doc has an `optsRev`; `swapTo` reconfigures a stale state just before `setState`, in the same task, so the user never sees the old setting. Defaults 13, 4, false.

### frontend/src/ui/editor/editor.ts · status line

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.reportPosition
- kind: explainer
- logged: v0.4.0 · 2026-10-30

onStatus receives `Ln N, Col M` when the shown document's selection or text changes (deduplicated) and one-off messages (Saved x, Reloaded x, errors). The status bar owner should treat the stream as latest-wins.

### frontend/src/ui/editor/editor.ts · keymap and search phrases

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.buildState
- kind: explainer
- logged: v0.4.0 · 2026-10-30

Keymap: Mod-s save, closeBrackets, completion, search (Mod-f, F3 and Mod-g, Mod-d next occurrence, Mod-Shift-l all occurrences, Mod-Alt-g go to line), history, Tab indents, defaults. Folding and rectangular selection are not enabled (fold markers need an icon and are a later decision). The search panel's English phrases are passed through `t()` with `EditorState.phrases` so a future translation table localises it. defaultHighlightStyle is deliberately not added as a fallback: it carries literal colours.

### frontend/src/ui/editor/languages.ts · languageFor

- refers-to: frontend/src/ui/editor/languages.ts :: languageFor
- kind: explainer
- logged: v0.4.0 · 2026-10-30

Ported from substrata frontend/src/ui/components/languages.ts (MIT, owner's). Eager table extended with jsonc, pyi, mts, cts and rs (lang-rust). Lazy long tail via @codemirror/language-data: the returned `later` promise resolves to the extension, which editor.ts dispatches into the document's `lang` Compartment (to the live view if shown, else to the stored state). `extOf` now treats a leading dot as no extension (".gitignore") and splits on both slash kinds. `legacyLanguage` removed (EditorTabOpts.language is gone). A Vite 8 build of the harness emitted 112 JS files (the 362 kB entry plus lazy chunks, e.g. sql 36.8 kB, javascript 17.0 kB).

### frontend/src/ui/editor/theme.ts · editorHighlight, editorTheme

- refers-to: frontend/src/ui/editor/theme.ts :: editorTheme
- kind: rationale
- logged: v0.4.0 · 2026-10-30

loomHighlight from substrata editor.ts, renamed. Every colour is a `var(--syn-*)` or a shell token; the new --syn-* and --font-code tokens are in EDITS.md. Theme: CodeMirror's `.cm-*` classes restyled through EditorView.theme with CSS-variable strings only (selection uses --accent-soft and --accent-glow when focused, active line --bg-hover, search panel and tooltips --surface-2 and the glass tokens, z-index of tooltips var(--z-temp)). `{ dark: true }` only picks CodeMirror's fallback rules, all of which are overridden, so the same theme object serves light profiles because the variables change under it. Fonts: `--font-code` puts JetBrains Mono first (it is already imported by fonts.css).

### frontend/src/styles/editor.css · .cv-editor

- refers-to: frontend/src/styles/editor.css :: .cv-editor
- kind: explainer
- logged: v0.4.0 · 2026-10-30

`.cv-editor` fills the host with `contain: layout paint` so CodeMirror's measurement can never move siblings. The mount and the empty message are both absolutely positioned and swap by the `hidden` attribute. Scrollbars: scrollbars.css already hides every scrollbar with `scrollbar-width: none !important` and the webkit pseudo-elements; CodeMirror's `.cm-scroller` sets `overflow: auto` only and adds no bar of its own. Checked in Chromium: scroller offsetWidth minus clientWidth is 0, computed scrollbar-width none.
