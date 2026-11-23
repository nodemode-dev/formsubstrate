# HASHOUT_LOG · frontend/src/ui/editor · formsubstrate

Living log for the code editor (editor.ts, languages.ts, theme.ts) and styles/editor.css. Source files stay comment-free; what they would have said lives here. The shell-wide log is frontend/HASHOUT_LOG.md.

Current build version: v0.25.1
Last updated: 2026-11-22

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

### frontend/src/ui/editor/wrap.ts · wordWrap

- refers-to: frontend/src/ui/editor/wrap.ts :: wordWrap
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Word wrap as VS Code has it (the owner's request): on by default, lines wrap at the editor's width, and a wrapped line continues at its own indentation (VS Code's default `wrappingIndent: same`), not at column 0. CodeMirror's lineWrapping alone wraps to column 0, so a view plugin adds a line decoration to each visible indented line carrying `--cv-wrap-indent: <n>ch` (tabs expanded at the tab size, capped at 80 columns); theme.ts turns it into a negative text-indent and an equal extra left padding, so the first row is unchanged and later rows hang under the first non-space character. Decorations are shared per width and rebuilt only on a document, viewport or tab-size change. A line whose indentation is longer than the line itself (whitespace only) is left alone. Measured in Chromium on an indented 300-character line: continuation rows align under the first character of `const`; layout shift 0.

### frontend/src/ui/editor/editor.ts · default wrap

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.options
- kind: explainer
- logged: v0.5.0 · 2026-10-30

The host starts with wordWrap true so the first file opened before prefs are applied already wraps; app.ts then applies the pref. The command toggle-word-wrap (Alt+Z, View > Word Wrap, the same key VS Code uses) flips the pref, applies it to every open file through setOptions (the wrap compartment is reconfigured per document as it is shown), and says so in the status hint; Preferences > Editor > Word wrap is the same pref.

### frontend/src/ui/editor/breakpoints.ts · state

- refers-to: frontend/src/ui/editor/breakpoints.ts :: breakpointExtension
- kind: rationale
- logged: v0.7.0 · 2026-10-30

Ported in idea from substrata frontend/src/ui/components/breakpoints.ts (MIT, owner's). Breakpoints are kept per file path in a module Map (memory only, lost on reload) and mirrored into each document's state as a RangeSet of gutter markers, which maps through edits so a breakpoint follows its line. The field is created from the Map, so closing and reopening a file keeps its breakpoints. Every change of the field is written back to the Map and announced to listeners, which is how the debug panel sends setBreakpoints (for an empty list too, to clear). The gutter uses renderEmptyElements, without which CodeMirror makes no element for lines without a marker and there is nothing to click. The gutter sits in its own `dbg` compartment, first in the list, so it is left of the line numbers.

### frontend/src/ui/editor/breakpoints.ts · current line

- refers-to: frontend/src/ui/editor/breakpoints.ts :: setDebugLocation
- kind: rationale
- logged: v0.7.0 · 2026-10-30

The stopped location is module state read by a view plugin when a document's view is built, so a file that opens after the stop already shows the highlight and scrolls to the line (one-shot reveal), with no empty frame. For the open document the plugin is refreshed by an effect. Scrolling is done here and not through Workbench.revealLine, because that moves the cursor and focuses the editor, which would take the keyboard out of the debug console on every step.

### frontend/src/ui/editor/lsp-workspace.ts · SfWorkspace

- refers-to: frontend/src/ui/editor/lsp-workspace.ts :: SfWorkspace
- kind: rationale
- logged: v0.7.0 · 2026-10-30

EditorHost swaps EditorState per tab with view.setState, which destroys and recreates the lsp-client view plugin on every tab switch. The default workspace would didClose and didOpen on each switch. This workspace keeps a file open from first display until the tab is closed (release()), only unlinking its view in closeFile. If a tab was edited while a previous plugin instance was alive, syncFiles detects that the new plugin's syncedDoc differs from the file's server copy and sends one whole-document change. displayFile opens the target through the editor and returns its view, which is how F12 crosses files; updateFile on a file with no view goes through EditorHost.transact (rename across open tabs). EditorHost gained `onClosed`, `runCommand` and `transact` for this; sf-dap's `dbg` compartment is separate.

### frontend/src/ui/editor/lsp.ts · Session diagnostics

- refers-to: frontend/src/ui/editor/lsp.ts :: Session.pull
- kind: rationale
- logged: v0.7.0 · 2026-10-30

lsp-client 6.3.0 only understands push diagnostics. The session handles textDocument/publishDiagnostics itself (version-checked, mapped through unsynced changes, tried before the library handler) and, when the server advertises diagnosticProvider, pulls after open (with one retry 1.6 s later, since the TypeScript project loads late), and 120 ms after each synced edit. Pulled results are mapped with a workspace mapping so edits during the request do not misplace marks. Hints (severity 4) are underlined but left out of the Problems list and counts.

### frontend/src/ui/editor/lsp.ts · LspManager lifecycle

- refers-to: frontend/src/ui/editor/lsp.ts :: LspManager
- kind: rationale
- logged: v0.7.0 · 2026-10-30

A session per language is created on the first file of that language, is dropped 4 s after its last file closes (closing the socket stops the engine process), and is dropped at once when the workspace changes. A server that was not found removes the plugin from open documents (refreshExtensions); a crashed one marks the status "stopped" and restarts on the next open, never in a loop. window/logMessage from servers goes to console.debug, since the library would print server errors as console errors. Hover HTML from the server is run through a small DOMParser sanitizer (scripts, iframes, on* attributes, javascript: and data: URLs removed). Not done: cross-file rename reaches only open tabs, definitions outside the workspace do nothing, Problems lists open files only, no format-before-save.

### frontend/src/ui/editor/lsp.ts · cleanHtml, copySafe, guardLinks

- refers-to: frontend/src/ui/editor/lsp.ts :: cleanHtml, copySafe, guardLinks, KEEP_TAGS, DROP_TAGS
- kind: rationale
- logged: v0.7.1 · 2026-10-30

The blocklist sanitizer was bypassable: browsers strip tab, newline and leading control characters from a URL before reading its scheme, and SVG animate could set href. It is now an allowlist that builds a fresh tree: only p, pre, code, em, strong, b, i, ul, ol, li, a, br, span, div, h1 to h6, blockquote, hr and table parts are created, text is copied as text, and unknown wrappers are unwrapped while script, style, svg, math, iframe, form, img and similar subtrees are dropped. Attributes are never copied; an anchor gets href only when the value, after removing every character in U+0000 to U+0020, starts with http:, https: or mailto:, and then also target _blank and rel noopener noreferrer. code keeps a class only if it is language-*. No dependency was added. Links never navigate the webview: a capture-phase click and auxclick handler on the document prevents the default for any anchor inside a CodeMirror tooltip. The codebase has no external-open helper, so a click opens nothing; wiring the Tauri opener is a later step.

### frontend/src/ui/editor/lsp.ts · Session rename wrapper, clearPulls, parkIdle

- refers-to: frontend/src/ui/editor/lsp.ts :: Session constructor, Session.clearPulls, LspManager.parkIdle
- kind: rationale
- logged: v0.7.1 · 2026-10-30

The library applies rename edits only to files in the workspace, which holds open tabs only. Session wraps client.request for textDocument/rename and, when the reply names URIs that are not open, shows one toast with the count of files left unchanged. Opening them first was not done because it would create tabs the user did not ask for. Entering unavailable or stopped now clears the pending pull timers, and parkIdle clears an earlier idle timer before storing a new id.

### frontend/src/ui/editor/editor.ts · transact

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.transact
- kind: rationale
- logged: v0.7.1 · 2026-10-30

An edit to a document that is open but not shown (LSP rename or format) only replaced its saved state, and the dirty sync runs from the view update, which never fires for it. transact now calls syncDirty for that document, so the tab shows modified, Save All includes it and closing prompts.

### frontend/src/ui/editor/breakpoints.ts · clearBreakpoints

- refers-to: frontend/src/ui/editor/breakpoints.ts :: clearBreakpoints; frontend/src/extensions/debug/index.ts :: DebugPanel
- kind: rationale
- logged: v0.7.1 · 2026-10-30

Breakpoints live in a module-level map keyed by workspace-relative path, so they leaked into the next workspace. clearBreakpoints empties the map; the debug panel calls it when the workspace path changes. Dots already drawn in an open editor are not removed by it; they leave with that editor when its tab closes.

### frontend/src/ui/editor/editor.ts · extensionsFor (closed, format-before-save stays open)

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.extensionsFor, EditorHost.refreshExtensions; frontend/src/app.ts :: startApp
- kind: rationale
- logged: v0.12.0 · 2026-10-30

Closes the v0.4.0 todo for the extension point: `startApp` assigns `editor.extensionsFor = lsp.extensionsFor` before any document opens and the LSP controller calls `refreshExtensions` through `attach({ refresh })`, so language-server extensions, diagnostics and breakpoints reach every document. The aside about format-before-save is still open on purpose: the LSP phase landed with Format Document as an explicit command (lsp-format, Shift+Alt+F) and `save()` has no hook. Formatting every file on every save would rewrite files the user did not ask to change, so it needs a Preferences switch (default off) and a `beforeSave` dep on `EditorHost` that awaits the server's edits before `deps.save`; that is a feature decision for the owner, not a leftover.

### frontend/src/ui/editor/folding.ts · folding

- refers-to: frontend/src/ui/editor/folding.ts :: folding, indentFolding, marker, foldTheme; frontend/src/ui/editor/editor.ts :: EditorHost.buildState
- kind: rationale
- logged: v0.22.0 · 2026-11-22

Code folding is new in v0.22.0; before it the editor had no fold gutter, no fold keys and no placeholder style. `folding()` sits right after `lineNumbers()` in every document's state, so the order is breakpoints, line numbers, fold arrows, lint. It adds `codeFolding()`, `foldGutter` with a `markerDOM` that draws the icon module's `chevronDown` (open, shown at full strength only while the gutter is hovered, by opacity so nothing moves) and `chevronRight` (folded, always shown), `foldKeymap` (Ctrl+Shift+[ and ] to fold and unfold, Ctrl+Alt+[ and ] for all; Cmd+Alt+[ and ] on macOS, as VS Code), a placeholder styled from tokens, and phrases through `t()`. Every language with a syntax tree folds through its own fold props. Languages without one get indentation folding from a `foldService`: it answers only when the state has no language or a `StreamLanguage` (the legacy modes from language-data, whose trees carry no fold info), so Lezer languages and Markdown keep their own folding. A line folds to the last following line indented deeper, skipping blank lines, scanning at most 20000 lines.

The gutter width cannot change when markers appear: `foldGutter` mounts its `initialSpacer` (a folded marker built by the same `markerDOM`) from the first frame, so the column is 18 px before the language pack loads and after. The `markerDOM` callback gets no view, so its title is set with `t('Fold line')` and `t('Unfold line')` directly. Measured at 4x CPU throttling on a 3,000-line file: the fold gutter stays 18 px from open through language load; folding and unfolding by click and by keys gave layout-shift entries only for the lines below the fold, all flagged hadRecentInput (the content moving because the person folded it).

### frontend/src/ui/editor/cursors.ts · multiCursor

- refers-to: frontend/src/ui/editor/cursors.ts :: multiCursor, crosshair, columnKeys; frontend/src/ui/editor/editor.ts :: EditorHost.buildState
- kind: rationale
- logged: v0.22.0 · 2026-11-22

Before v0.22.0 the editor had the commands for several selections (`selectNextOccurrence`, `selectSelectionMatches` behind EditorHost.selectNext and selectAllOccurrences) and `drawSelection`, but not `EditorState.allowMultipleSelections`, which defaults to false, so the state collapsed every multi-range selection to its main range and those commands only moved one selection. Mouse adding was CodeMirror's default, Ctrl+click (Cmd+click on macOS), and there was no column selection. `multiCursor` turns multiple selections on, makes Alt+click (Option+click on macOS) add a cursor through `clickAddsSelectionRange`, and makes Alt+Shift+drag (Option+Shift) a rectangular selection through `rectangularSelection`, as VS Code does. CodeMirror's `crosshairCursor` watches one key only, so a small view plugin shows the crosshair while Alt and Shift are both held, by toggling the `cv-crosshair` class on the content element from window keydown and keyup and editor mousemove, and clears it on window blur and on destroy (EditorHost swaps states, which recreates plugins). The menu bar's lone-Alt mnemonic is reset by its own pointerdown listener, so Alt+click does not focus the menu.

### frontend/src/ui/editor/brackets.ts · bracketColors

- refers-to: frontend/src/ui/editor/brackets.ts :: bracketColors, build, depthAt, opensAt; frontend/src/ui/editor/editor.ts :: EditorHost.featExt, Doc.feat; frontend/src/styles/tokens.css :: --syn-bracket-1, --syn-bracket-2, --syn-bracket-3
- kind: rationale
- logged: v0.22.0 · 2026-11-22

Bracket pair colouring is new. For each visible range the plugin finds the depth at the range start once (ancestors of the node there that have an opening bracket as their first or second child before that point; the second child covers subscripts such as `a[0]`, where the bracket follows the object), then walks the syntax tree through the range in document order and colours each one-character `(`, `[`, `{` token and its closer by depth, cycling three classes. Brackets inside strings and comments are never tokens of their own, so they are not coloured, and a language without a tree is left alone. Rebuilds happen on doc change, viewport change or a new tree only. The theme targets the mark and its direct span child, so the colour wins over the highlight style's punctuation colour whichever span is outside. It lives in a per-document `feat` Compartment fed by `featExt()`; the setting reconfigures it through the existing optsRev path (current document at once, hidden ones on show), never by rebuilding the view.

The first version resolved every bracket character with `resolveInner` and walked its ancestors. Measured at 4x CPU throttling on the 3,000-line file, that cost about 12 ms of main thread per keystroke over colouring off; the tree walk brought it to about 4 ms (scroll cost equal within noise). Removed code: "const node = tree.resolveInner(pos, 1); if (node.name !== m[0] || node.from !== pos) continue; const depth = depthOf(node);".

Tokens added in `tokens.css`, dark root and `body.theme-light`: `--syn-bracket-1` (#ffd24d, light #8f6400), `--syn-bracket-2` (#e07ae0, light #a3309f), `--syn-bracket-3` (#3fa9ff, light #0b62c4); no existing token gave three hues that read apart on both backgrounds without colliding with keyword and string colours.

### frontend/src/ui/editor/editor.ts · EditorHost auto save and format on save

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.save, saveNow, commitSave, reloadFromDisk, applyEditorPrefs, scheduleAutoSave, cancelAutoSave, flushAutoSave, onUpdate; frontend/src/ui/editor/lsp.ts :: LspManager.formatForSave
- kind: rationale
- logged: v0.22.0 · 2026-11-22

Closes the format-before-save item left open above, as the owner's switch (default off). `save(path, auto)` now queues saves per document (`Doc.queue`), so an auto save and Ctrl+S never send two writes with the same expected mtime, which would answer 409 to the second. A manual save of the shown document, with format on save on and a TypeScript or Python file, first calls `lsp.formatForSave(view, 1500)`: it sends textDocument/formatting itself (Format Document's command returns before the reply, so it cannot be awaited), races it against the time limit, maps the edits through the workspace mapping, drops them if the person typed inside an edited range, and applies them with userEvent `format`. If the server is missing, not ready, has no formatting provider, fails or is late, the file is still written and a quiet info toast (one key, so repeats merge) says formatting was skipped. Other file types save without asking. Auto saves and Save All for hidden tabs never format, as VS Code does not format on delayed auto save.

Auto save (default off) schedules a save of the shown document `editorAutoSaveDelay` ms after its last change while it is dirty, and on window blur saves every dirty document. It never saves a document with no mtime and never a document whose last save answered 409: the existing conflict check is the trigger, but an auto save does not raise the Overwrite or Reload dialog; it sets `Doc.conflict`, shows "Auto save paused: name changed on disk" in the status bar, and stops auto saving that document until a manual save (which shows the usual conflict dialog) or a reload clears it. EditorHost has no untitled documents (every document is a workspace path loaded with an mtime), so the mtime check is the untitled guard. The settings reach the host through `EDITOR_PREFS_EVENT` (see frontend/src/ui/HASHOUT_LOG.md); `app.ts` is unchanged. Removed code from `save`: "try { const r = await this.deps.save(d.path, text, d.mtime); return this.commitSave(d, snapshot, r.mtime); }" now lives in `saveNow` with the auto and format branches.

### frontend/src/ui/editor/lsp.ts · LspManager.extensionsFor keeps the lint gutter

- refers-to: frontend/src/ui/editor/lsp.ts :: LspManager.extensionsFor
- kind: rationale
- logged: v0.22.0 · 2026-11-22

Opening a TypeScript file with no language server installed moved the text 16 px left about 400 ms after open: the first `extensionsFor` added `lintGutter()`, and when the server reported itself unavailable the refresh returned no extensions, removing the gutter. An unavailable or stopped session now still returns `[lintGutter()]`, so the column stays and the open gives no layout shift (measured 0 at 4x throttling; before, one 0.007 entry from `.cm-content`). Removed code: "if (s.state === 'unavailable' || s.state === 'stopped') return [];". Still open, not part of this change: with no TypeScript server installed, lsp-client's initialize request times out after 20 s and surfaces as an unhandled "Request timed out" page error.

### frontend/src/ui/editor/editor.ts · EditorHost.reload, reloadFromDisk, reloadChanges

- refers-to: frontend/src/ui/editor/editor.ts :: EditorHost.reload, EditorHost.reloadFromDisk, reloadChanges, loadDiffer, DIFF_LIMITS; frontend/src/app.ts :: startApp (FILES_WRITTEN listener); frontend/src/extensions/search/index.ts :: FILES_WRITTEN
- kind: removed-code
- logged: v0.22.0 · 2026-11-22

Closes the item left open in frontend/src/extensions/HASHOUT_LOG.md (Replace all with a preview): after Replace all, a clean open tab showed the old text until its next save met the 409 dialog. `app.ts` now listens for `FILES_WRITTEN` and calls the new public `EditorHost.reload(path)` for each written path whose store entry is not `modified`; `reload` answers false for a path that is not open or is dirty and otherwise runs `reloadFromDisk(d, true)`. A tab that became dirty while the file was loading is left alone (checked again after the load), as is a tab closed meanwhile.

`reloadFromDisk` used to replace the whole document in one change. Removed code: "const doc = this.liveState(d).doc; const change = { from: 0, to: doc.length, insert: fresh.text }; if (this.current === d) this.view.dispatch({ changes: change, userEvent: 'input.reload' }); else d.state = d.state.update({ changes: change, userEvent: 'input.reload' }).state; d.eol = dominantEol(fresh.text); d.saved = this.liveState(d).doc;". A whole-document change maps the cursor to the start of the file. It now sends only the changed ranges, computed with `diff` from `@codemirror/merge` (already a dependency, loaded with a dynamic import that starts beside the file read, so the editor chunk does not grow; `scanLimit` 2000 and `timeout` 200 ms, after which `diff` answers a coarser but correct change set; if the import fails the whole-document change is used). The cursor, selection and scroll position therefore stay where they were unless the text under them changed, and nothing is re-mounted: the same `.cm-content` node is patched. `d.saved` is set to the new text (through `state.toText`, so line breaks match the document) before the dispatch, so the update listener's dirty check sees a clean document and the tab's dirty mark never flips; `mtime` comes from the read, so the next save is not a 409. A hidden tab gets the same change on its stored state, and its stored scroll snapshot is mapped through it. The status line "Reloaded name" is shown only for the conflict dialog's Reload, not for these quiet reloads. The change is one undoable step, as before.

Checked in headless Chrome (CPU 4x, network throttled) against a live engine with `notes.txt` (300 lines, every tenth with `alpha`) shown and scrolled to line 121 with the cursor on line 139, and `other.txt` open in a hidden tab: Replace all `alpha` to `omega` showed the new text 418 ms after the confirmation click (including the write), cursor still Ln 139 Col 5, scrollTop unchanged (2443), the same `.cm-content` node, no dirty-mark flips on the tab strip (MutationObserver), no layout shift, both tabs clean; typing and Ctrl+S afterwards saved without a conflict dialog; the hidden tab showed the new text when chosen.

### frontend/src/ui/editor/lsp.ts · Session.connect (was onOpen)

- refers-to: frontend/src/ui/editor/lsp.ts :: Session constructor, Session.connect, Session.onControl; backend/app/routers/lsp.py :: lsp_ws
- kind: removed-code
- logged: v0.22.0 · 2026-11-22

Closes the item above about the unhandled "Request timed out". The session called `client.connect` when the socket opened, before the engine said whether the server program exists. `lsp_ws` always sends `formsubstrate/serverStarted` after spawning the process, or `formsubstrate/serverUnavailable` and closes when it cannot. With no program, `initialize` went to a closing socket and timed out after 20 s; lsp-client chains every queued notification (`didOpen` from `workspace.connected()`, `didChange` from `sync`) on `client.initializing` without a rejection handler, so each became an unhandled rejection, and the session also flipped from "not installed" to "stopped: The language server did not finish starting". Removed code: "this.socket.addEventListener('open', () => this.onOpen());" and the method head "private onOpen(): void { if (this.disposed) return;". The same body is now `connect()`, guarded by `this.client.connected`, and runs only on `formsubstrate/serverStarted`. Until then the client has no transport, so `notification` returns at once and nothing is queued; files opened in that time are registered in the workspace and sent by `workspace.connected()` when the client connects. On `serverUnavailable` the session goes to unavailable without connecting; a socket that closes before `serverStarted` goes to stopped through `onClose`, also without connecting. No global `unhandledrejection` filter was added.

Checked in headless Chrome (CPU 4x) with tsc hidden from the engine's `find_bin`, opening `src/main.ts` and watching 32 s: no page error, status "TypeScript · not installed" from 265 ms on and unchanged. The same run against a build with the previous `lsp.ts` gave the status flip to "stopped" at 20 s and "Error: Request timed out at timeoutRequest" at 30 s. With `tsc --lsp` (TypeScript 7.0.2) present: ready at 372 ms, hover on `Math.hypot` showed its signature, `origin.` completed `x` and `y`, no page error. Still open: a server that starts and then exits or hangs before answering `initialize` is connected, so its queued notifications can still reject unhandled after the 20 s timeout.

### frontend/src/ui/editor/conflicts.ts · conflictField, acceptConflict, ConflictActions, conflicts

- refers-to: frontend/src/ui/editor/conflicts.ts :: conflictField, acceptConflict, conflictBlocks, ConflictActions, scan, update, decorate, heightTracker, conflicts; frontend/src/ui/editor/editor.ts :: EditorHost.buildState
- kind: rationale
- logged: v0.23.0 · 2026-11-22

Inline merge-conflict actions as VS Code has them. `scan` finds blocks from the text: a `<<<<<<<` line, an optional `|||||||` base line, `=======`, then `>>>>>>>`; a second `<<<<<<<` before the end starts the block again, and an unclosed block is ignored. The words git wrote after the markers (HEAD, a branch name, Updated upstream, Stashed changes) are shown in the labels: Accept Current Change (HEAD) | Accept Incoming Change (feature) | Accept Both Changes. Each action is one transaction with `isolateHistory.of('full')`, so one undo brings the block back even when two actions follow quickly; the block's trailing line break is kept right at the end of the file. The state lives in a StateField because block widgets cannot come from a view plugin. On a change the field rescans the whole text only if a changed line, before or after the change, starts with seven marker characters; otherwise it maps the blocks and the decoration set through the change and rebuilds the decorations of the blocks the change touched (typing inside a block, or Enter, gives its new lines the tint). Line tints use `background-image` so the active-line colour still shows beneath. The action line is a block widget of fixed height `--conflict-actions-h` (1lh, one editor line) whose `estimatedHeight` is the view's default line height, so its space is known before it is drawn; widgets compare equal by their labels, so a rescan reuses their DOM. It is in the static extension list of `buildState`, so no editor is rebuilt. Session worktree files open in the diff tab (diff-view.ts), which does not carry this extension yet.

Checked in headless Chrome (CPU 4x) against a live engine and a /tmp merge with a 2,120-line file holding 20 blocks: the widget is 20.14 px, the same as a line; Current, Incoming and Both each removed one block and Ctrl+Z restored it; all 20 resolved, saved, no markers on disk. Script time per key, 3 runs of 20 keys: 38.4 / 26.2 / 19.6 ms inside a block, 36.2 / 25.1 / 31.6 ms outside the blocks, 25.5 / 22.4 / 26.2 ms in a 2,121-line file with no conflicts (whole page, throttled), so no measurable cost. Layout shift outside input: none while opening, typing or scrolling; one 0.00044 shift of gutter elements about 1 s after the last block was resolved, still unexplained (it did not occur after the same deletions in a file without conflicts).

### frontend/src/ui/editor/lsp.ts · LspManager.langOf, loadCustom, extensionsFor, restart, statusFor, supports, symbols; Session.reason
- refers-to: frontend/src/ui/editor/lsp.ts :: LspStatus, LangPick, Session.reason, Session.onControl, LspManager.custom, LspManager.opened, LspManager.attach, LspManager.langOf, LspManager.loadCustom, LspManager.extensionsFor, LspManager.release, LspManager.restart, LspManager.statusFor, LspManager.supports, LspManager.symbols
- kind: rationale
- logged: v0.24.0 · 2026-11-22

Only the regions that choose a server changed. `langOf(path)` replaces every `LANG_OF_EXT[extOf(path)]`: a built-in extension first, then the custom map (extension without its dot to `{ lang: 'custom:<id>', id: languageId, label }`), which `loadCustom` reads from `GET /api/lsp/custom` at attach and again on `formsubstrate:lsp-custom-changed`. After a reload every custom session is disposed and every open file whose extension was or is custom is refreshed through `host.refresh` (a compartment reconfigure), so an edited or removed server takes effect without reopening the file; a session starts lazily from `extensionsFor` on the first such file, as built-ins do. `opened` remembers the paths `extensionsFor` saw until `release`. Before a session is made, `extensionsFor` waits for `trustSynced()`: until the engine has heard the current trust it returns only `lintGutter()` (the gutter keeps its width, so nothing moves) and refreshes the path when `syncTrust()` settles; without this the first file after boot or after a trust change could reach the engine before the announcement and be refused as untrusted. `Session.reason` keeps the `reason` of `formsubstrate/serverUnavailable`, and `LspStatus` gains `label` (empty for built-ins) and `reason`. `restart` also calls `forgetTrustSync()`.

Ran in headless Chrome (CPU 4x) against the engine above: an open `src/main.rs` in the untrusted workspace showed "Rust (rust-analyzer) · needs trust" and no rust-analyzer process; after Trust this workspace the status read "Rust (rust-analyzer) · ready", the hover tooltip showed `fn greet(name: &str) -> String`, F12 on the call moved to line 1, and typing `gre` opened completion with `greet(…)` first.

### frontend/src/ui/editor/lsp.ts · code actions (Session.actions, runAction, unusedImportFixes, onApplyEdit, ACTION_CAPABILITIES)

- refers-to: frontend/src/ui/editor/lsp.ts :: ACTION_KINDS, ACTION_CAPABILITIES, UNUSED_IMPORTS, serverRequest, Session.onMessage, Session.onApplyEdit, Session.stamp, Session.editHost, Session.diagnosticsIn, Session.actions, Session.unusedImportFixes, Session.runAction, Session.paint, LspManager.codeActions, LspManager.actionKinds, LspManager.textOf, LspManager.transact, LspManager.extensionsFor, LspHost.text; frontend/src/app.ts :: startApp (lsp.attach)
- kind: rationale
- logged: v0.24.0 · 2026-11-22

`@codemirror/lsp-client` 6.3.0 asks for no code actions and answers every request a server sends with "Method not implemented", so quick fixes are built beside it on the same client. What follows the LSP 3.17 specification (https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/), sections "Code Action Request" (textDocument/codeAction), "Code Action Resolve Request" (codeAction/resolve), "WorkspaceEdit", "TextEdit[]", "Applies a WorkspaceEdit" (workspace/applyEdit) and "Execute a command" (workspace/executeCommand):

- Declared through one more client extension (`{ clientCapabilities: ACTION_CAPABILITIES }`, merged by the library): `textDocument.codeAction` with `codeActionLiteralSupport` (kinds: empty, quickfix, refactor, refactor.extract, refactor.inline, refactor.rewrite, source, source.organizeImports, source.fixAll), `isPreferredSupport`, `dataSupport`, `resolveSupport.properties: ['edit']`; `workspace.applyEdit`, `workspace.workspaceEdit` with `documentChanges`, `resourceOperations: ['create', 'rename']` and `failureHandling: 'abort'`, and `workspace.executeCommand`. Not declared, so servers must not send them: `disabledSupport`, `honorsChangeAnnotations`, change annotations, the delete file operation.
- `Session.actions` syncs the document, then sends the range (cursor or selection), `context.diagnostics` as the very objects the server sent (kept in `Session.raw`, so `data`, `code` and `tags` go back untouched; overlap is tested in line and character, touching counts), `context.only` when a kind was asked for, and `triggerKind` 1 for Ctrl+., the menus and the commands, 2 for the bulb and the lint tooltip. An abort signal becomes `$/cancelRequest`. Bare `Command` answers are wrapped as actions; `disabled` ones are dropped; with `only`, an answer whose kind is not that kind or below it is dropped; preferred actions sort first, the server's order otherwise.
- `runAction`: the spec says "If a code action provides an edit and a command, first the edit is executed and then the command." An action with no edit is first sent to codeAction/resolve when the server has `resolveProvider`. The command goes to workspace/executeCommand. The server's own workspace/applyEdit request is caught in `Session.onMessage` before the library sees it (a cheap `includes` on the frame, then one parse) and answered with `{ applied }` or `{ applied: false, failureReason }` from the same edit path.
- Version checks. Every answer carries a stamp: the version of each open document when the request was made. Before resolve, execute or an edit, the document is synced again, and if its version is no longer the stamped one the action is refused with a notice ("The file changed since this fix was offered..."); `applyWorkspaceEdit` repeats the check for every open file an edit touches, also against `TextDocumentEdit.textDocument.version`. So typing between asking and choosing never applies an edit to other text.
- `unusedImportFixes`: the native TypeScript 7.0.2 server (`tsc --lsp`, the engine's first choice) answers `[]` to a quickfix request for "'x' is declared but its value is never read" on an import; it only offers the source action `source.removeUnusedImports` (a kind both TypeScript servers use; it is not one of the specification's predefined kinds). When a quick fix request with diagnostics comes back with no quickfix and the server lists that kind, the session asks for it and offers the action only if its edit overlaps a flagged range and no longer contains the flagged text, so the unused-import warning has a fix ("Remove Unused Imports") on both servers, and an unused local variable does not get an unrelated one. With typescript-language-server (tsserver) the real quick fixes arrive ("Remove unused declaration for: 'x'", "Remove import from './util'") and this path is not taken.
- `paint` gives each diagnostic a `renderMessage` (only when the server has a code action provider) so the lint tooltip can offer its fixes; see code-actions.ts.
- `LspHost` gained `text(path)` (one line in `app.ts`, `editor.textOf`): the edit path needs the live text of a tab that is open but not shown. `extensionsFor` returns `actionBulb` next to `lintGutter()` in all three of its answers, so the bulb column is there from the first frame and does not arrive with the server.

Checked in headless Chrome (CPU 4x) against a live engine and a /tmp repository. typescript-language-server 5.x: the unused import shows the bulb 420 to 480 ms after the cursor rests, Ctrl+. lists "Remove unused declaration for: 'helper'" (preferred, first), Enter applies it and one Ctrl+Z restores the line and clears the tab's dirty mark; Organize Imports from the context menu and Alt+Shift+O, one undo; "Export 'hidden' from module './util'" wrote the unopened util.ts on disk; "Move to a new file" (command, then the server's workspace/applyEdit with a create operation) made run.ts and changed main.ts in one undo. Native TypeScript 7.0.2: "Remove Unused Imports" from the bulb, Ctrl+. and Source Action. pyright 1.1 offered no code action for an unresolved import or an undefined name, and `[]` for source.organizeImports. A fake server in /tmp (through a custom server entry) covered: two TextDocumentEdits on one file composed into one undo with same-position inserts in array order, a stale `version` refused with the notice, `changes` on a second file that is unopened (written on disk), the same file open in a hidden tab (edited there, dirty, disk untouched, the server sent the new text), command then applyEdit (`{"applied":true}` back at the server), create and rename, resolve with `data` returned intact, an edit outside the workspace refused, a delete operation refused, a bare Command, and typing while the list is open (refused). Layout shift outside input 0 and no console error in each run.

### frontend/src/ui/editor/lsp-edits.ts · applyWorkspaceEdit

- refers-to: frontend/src/ui/editor/lsp-edits.ts :: applyWorkspaceEdit, stepsOf, changesFor, editsOf, textOf, EditHost, OpenDoc; frontend/src/ui/editor/lsp.ts :: Session.editHost; frontend/src/io/workspace.ts :: readFile, writeFile, renamePath
- kind: rationale
- logged: v0.24.0 · 2026-11-22

One path applies a WorkspaceEdit, whether it came with a chosen action, from codeAction/resolve or in the server's workspace/applyEdit. `documentChanges` wins over `changes` when both are there, as the specification's "WorkspaceEdit" section asks of a client that declared it. No new engine route: files that are not open go through the existing `GET /api/workspace/file`, `PUT /api/workspace/file` (with the read's mtime, so a file that changed in between answers 409 and is refused; `create: true` for a create operation) and `POST /api/workspace/rename`, all behind the window key and the workspace guards. A URI the session cannot map into the workspace refuses the whole edit before anything is touched.

Order of work: (1) read every target that is not an open, versioned document; (2) sync, then check every open target (the stamp, the edit's `version`, and for a tab that belongs to no session of this server, that its text equals the disk text the server read) and refuse the whole edit on any mismatch; (3) apply all open-document edits with no await in between, each file as one transaction (`ChangeSet`s of successive TextDocumentEdits composed, `isolateHistory.of('full')`, userEvent `input.codeaction`), so one undo per file and no keystroke can slip between check and apply; (4) run creates, renames and disk edits in the order given. A failure in step 4 stops there and what ran stays, which is what the declared `failureHandling: 'abort'` promises. Edits of one `TextEdit[]` all refer to the document before the edit; they are sorted by start with the array order kept for equal starts, which is the specification's rule for inserts at one position. Positions are UTF-16 code units, the protocol's default and what the library sends. A disk file keeps its dominant line break.

Not supported, and refused with "The language server sent an edit this editor cannot apply": the delete operation (not declared; a server deleting files was judged not worth the risk for quick fixes) and anything malformed. A create or rename that names a file open in a tab is refused ("Close this file before..."). After disk writes it dispatches `formsubstrate:files-written` (app.ts reloads clean tabs, as Replace all does), `formsubstrate:paths-changed` for a rename and `formsubstrate:git-changed`. Still open: an undo in the editor does not undo what the same fix wrote to an unopened file or the file it created; rename (F2) still goes through the library and skips files that are not open, with its existing notice.

### frontend/src/ui/editor/lsp-workspace.ts · SfWorkspace.pushHidden

- refers-to: frontend/src/ui/editor/lsp-workspace.ts :: SfWorkspace.pushHidden, SfWorkspace.syncFiles; frontend/src/ui/editor/lsp.ts :: Session.editHost (commit)
- kind: rationale
- logged: v0.24.0 · 2026-11-22

`syncFiles` only reports files that have a view, and the editor has one view that swaps states, so a tab that is open but not shown is never synced. An edit applied to such a tab (through `EditorHost.transact`) left the server with the old text until the tab was shown again, and a second fix touching the file would have been computed on it. `pushHidden` sets the file's `doc`, takes the next version and sends one full-text `textDocument/didChange`. It does nothing for a file that has a view. Workspace mappings that are active at that moment are not told about the change (the library's `addChanges` is internal); nothing reads a mapping for a hidden file today.

### frontend/src/ui/editor/code-actions.ts · actionBulb, ChoiceMenu, diagnosticBody, editorMenu

- refers-to: frontend/src/ui/editor/code-actions.ts :: bulbField, setBulb, BulbMarker, bulbPlugin, bulbGutter, actionBulb, steer, ChoiceMenu, showChoices, diagnosticBody, fillFixes, quickFix, sourceActions, organizeImports, bindEditorMenu, contextItems, contextHandler, tooltipRoom, editorMenu; frontend/src/ui/editor/editor.ts :: EditorHost.buildState; frontend/src/ui/menu.ts :: PopupMenu; frontend/src/ui/commands.ts :: Commands
- kind: rationale
- logged: v0.24.0 · 2026-11-22

The window side of code actions. The bulb is its own gutter (`cv-ca-gutter`, fixed width from `--space-4`, with an `initialSpacer`), last before the text, present wherever the lint gutter is, so its 16 px are there before any server answers and showing or hiding the bulb moves nothing (content left edge 441.2 px before and after on the 2,000-line file). `bulbPlugin` asks 300 ms after the cursor, the text, the focus or the diagnostics last changed, only while the editor has focus and the server has a code action provider; a newer change aborts the pending request (`$/cancelRequest`). With an empty selection it asks for `only: ['quickfix']`, so a line without a problem shows no bulb for the refactorings every position has; with a selection it asks for everything. `bulbField` drops the bulb at once when the text changes or the cursor leaves the line, and keeps it while a new answer for the same line is on its way, so it does not blink when the cursor moves within the line.

The list of actions is the window's own `PopupMenu` (the tab strip's recipe: a private `Commands` whose entries have `verbatim` labels, because a server's title never goes through `t()`), with the check mark on preferred actions. `PopupMenu` has no keyboard handling outside the menu bar, so `steer` adds Up, Down, Home, End, Enter, Space, Escape and Tab while the menu is open and returns focus to the editor. Ctrl+. (Cmd+. on a Mac; command `lsp-quick-fix`) opens it at the cursor, a click on the bulb below the bulb.

The editor had no context menu (the webview's own appeared). `editorMenu` is registered once in `buildState` for every document: Quick Fix..., Source Action... and Organize Imports when the server's `codeActionKinds` list a source kind and `source.organizeImports` or a kind below it (typescript-language-server names it `source.organizeImports.ts`), the four language commands when a server is attached, then Cut, Copy, Paste and Select All through the existing commands. A right click outside a selection moves the cursor there first; Shift+F10 and the menu key open it at the cursor with the first row focused. Right clicks on gutters, panels and tooltips are left alone.

The lint tooltip: `diagnosticBody` renders the message and one row of fixed height (`--ctl-sm`, `width: 0; min-width: 100%` so it cannot widen the tooltip), empty until the answer, then the first fix as a button and "More fixes..." (opens the list) or "No quick fixes". The window keeps every tooltip hidden for its first 140 ms (`cv-tip-ready`); in the measured run the tooltip had its final size (274 by 95 px, with the server's hover text above the message) and its two fix buttons while still hidden, and did not change after it became visible. `tooltipRoom` (`tooltips({ tooltipSpace })` with the editor's own box) is part of `editorMenu`: `.cv-editor` clips its children, so a tooltip for the first lines, which is where unused imports are, opened above the line and was cut off under the tab strip (top 8 px in the first run); it now opens below.

Measured in headless Chrome, CPU 4x, a 2,004-line TypeScript file, three runs each, whole page: script time per cursor move 17.9 / 15.1 / 16.3 ms for moves 60 ms apart (a copy of the build without `bulbPlugin`: 18.4 / 16.1 / 15.9 ms, so nothing measurable on the key path), 26.6 / 23.0 / 32.5 ms for moves 600 ms apart, which includes the request and its answer after each rest (without the plugin 21.3 / 19.1 / 20.4 ms). Layout-shift entries without recent input while moving, scrolling, opening the list with Ctrl+., applying and undoing: 0; every entry with recent input was the cursor, the active-line gutter cells or a hover tooltip, the same set as in the copy without the plugin. Still open: the menus do not close when the editor scrolls under them; the bulb's title is translated when it is drawn and does not follow a later language change.

### frontend/src/ui/editor/breakpoints.ts · Breakpoint, Mark, EditWidget, editField, showMenu, ensure, persist
- refers-to: frontend/src/ui/editor/breakpoints.ts (whole file); frontend/src/styles/debug.css :: .cv-bp-dot, .cv-bp-edit, .cv-bp-mode, .cv-bp-input
- kind: rationale
- logged: v0.24.0 · 2026-11-22

A breakpoint is now `{line, enabled, condition, hitCondition, logMessage}`. The gutter marker carries the detail (`Mark.eq` compares it, so a changed condition redraws only that marker) and draws one of three inline `currentColor` shapes: a disc (plain), a disc with an equals sign cut out (condition or hit count), a diamond (logpoint); a disabled one is the same shape in outline and muted. The title lists what is set.

Right-click in the breakpoint gutter opens a `PopupMenu` on a private `Commands`: on an empty line Add Breakpoint, Add Conditional Breakpoint, Add Logpoint; on a breakpoint Edit Condition, Edit Log Message, Remove Breakpoint, Disable or Enable Breakpoint. The handler stops the event so no other context menu opens, and the left-click toggle now ignores other buttons and ctrl-click (it used to toggle on any button). The inline input is a block widget under the line (`editField`, a state field, because block decorations cannot come from a view plugin): fixed height `--ctl-lg`, three tabs (Expression, Hit Count, Log Message) and one input; Enter applies all three values, Escape cancels, the widget keeps its DOM across document changes (`eq` by an id). Text below moves once, by 36px, when it opens and back when it closes, both after input; typing moves nothing. The palette has Add Conditional Breakpoint and Add Logpoint for the cursor line.

`setBreakpointSupport` receives the running adapter's capabilities; tabs and menu entries it does not support are hidden, and with no session everything is offered. Breakpoints are kept per workspace in `localStorage` under `formsubstrate.breakpoints` (`{workspace path: {file: [breakpoint]}}`, 30 workspaces, 200 files, 500 lines), loaded lazily for the open workspace (`ensure`), so they also survive a restart, which they did not before. `clearBreakpoints` only drops the loaded copy.

Checked in headless Chrome, CPU 4x: menu on an empty line, the input opened (line below moved 36px once), `i == 3` typed (0px while typing) and applied, marker `conditional`, storage written; Disable, Add Logpoint; layout shift without input 0 from these actions, no console errors.

### frontend/src/ui/editor/lsp.ts · setExternal, problems

- refers-to: frontend/src/ui/editor/lsp.ts :: LspManager.external, setExternal, problems; frontend/src/ui/tasks.ts :: apply; frontend/src/extensions/lsp/index.ts :: ProblemsPanel.sync, publish
- kind: rationale
- logged: v0.25.0 · 2026-11-22

The window's Problems list and the status bar counts read `lsp.problems()`, which was built from the language-server sessions alone. `setExternal(owner, problems)` keeps one list per owner beside them, `problems()` appends those lists before sorting, and a change emits `diagnostics`, so the panel and the counts repaint through the path they already have. Task problems use the owner `tasks`. They are not merged with a language server's identical row: both are shown, each with its source, as VS Code does. `reset()` leaves them alone; the tasks module replaces them when the workspace changes.
