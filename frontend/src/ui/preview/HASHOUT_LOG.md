# HASHOUT_LOG · frontend/src/ui/preview (Markdown preview, media tabs) · formsubstrate

Living log for the Markdown preview and the image, video, audio and PDF tabs: sanitize.ts, markdown.ts, md-preview.ts, media.ts, media-tab.ts, index.ts and styles/preview.css. Source files stay comment-free; what they would have said lives here.

Current build version: v0.25.1
Last updated: 2026-11-22

### frontend/src/ui/preview/sanitize.ts · sanitizeHtml

- refers-to: frontend/src/ui/preview/sanitize.ts :: sanitizeHtml, stripUrl, safeLink
- kind: warning-context
- logged: v0.8.0 · 2026-10-30

substrata ran marked output through DOMPurify. This port builds the output instead: the marked HTML is parsed by DOMParser into an inert document (no script runs, no image loads), and a new tree is created element by element from an allowlist of tags with a per-tag allowlist of attributes. Anything not on the list is dropped, so there is no blocklist to fall behind. Script, style, iframe, object, svg, math, form controls and media elements are dropped with their content; unknown wrapper tags such as section are unwrapped. Every event handler, style, id and class is gone (class survives only on code as language-x, and ids are made by the renderer). URLs have [\u0000- ] and the other invisible code points removed before the scheme is read, so java\tscript: and similar splits are seen as javascript:; links may be http, https, mailto or relative, images http, https, a relative path that must resolve to an image extension, or data:image of a raster type (never svg). A protocol-relative or backslash start is refused. Only a checkbox input survives, forced disabled.

### frontend/src/ui/preview/markdown.ts · patch

- refers-to: frontend/src/ui/preview/markdown.ts :: patch, renderMarkdown
- kind: rationale
- logged: v0.8.0 · 2026-10-30

Live update never rebuilds the pane. Each render makes a detached fragment, and patch walks it against the live tree: the equal prefix and suffix of the children are skipped by isEqualNode, and the middle is matched by position, with text updated by data, attributes synced, and a different tag replaced. An untouched block keeps its nodes, so its images do not reload, its selection stays, and scroll does not move. Fenced code is highlighted with the lezer language registry the editor uses and the classHighlighter token classes, which preview.css maps to the --syn tokens; a language that is not loaded yet leaves the block plain and re-renders once when it arrives, patched in place. Link titles carry the target so the status line is not needed for hover.

### frontend/src/ui/preview/md-preview.ts · MarkdownPreview

- refers-to: frontend/src/ui/preview/md-preview.ts :: MarkdownPreview
- kind: rationale
- logged: v0.8.0 · 2026-10-30

The editor stays the document; the preview is a second pane in the same editor area, shown by classes on the area (is-md-side moves the editor host to the left half with one right offset, is-md-only hides it with visibility so CodeMirror keeps its size). The pane and the two toolbar buttons are built once; the toolbar is hidden unless the active tab is a Markdown file, and sits over the top right corner at the raised layer. The buttons carry data-cmd so the shell's own chrome sync gives them disabled state, titles and translated labels. Mode and scroll are kept per file. A first render for a file waits up to 260 ms for its images to decode before the pane is revealed, so images do not pop in and shift the text; later renders patch in place after a 140 ms debounce and one animation frame. Links never navigate: a fragment scrolls the pane, a relative path opens that file as a tab, anything with a scheme only reports in the status line (no external open helper exists in the shell yet).

### frontend/src/ui/preview/index.ts · installPreview chord

- refers-to: frontend/src/ui/preview/index.ts :: installPreview
- kind: warning-context
- logged: v0.8.0 · 2026-10-30

Ctrl+K V is a chord and Mod+K already opens the command palette. While a Markdown tab is active, Mod+K is captured and waits 700 ms for the next key: V opens the preview to the side, any other key or the timeout opens the palette instead, so the palette is 700 ms later only in a Markdown tab. Shift+Mod+V is an ordinary command key for the full-pane preview toggle.

### frontend/src/ui/preview/media-tab.ts · MediaTab

- refers-to: frontend/src/ui/preview/media-tab.ts :: MediaTab
- kind: rationale
- logged: v0.8.0 · 2026-10-30

A media file opens as a view tab (id media:path) through Views, so the text editor never reads it; app.ts routes by extension in openInEditor, the one choke point every opener already uses. The bar, stage and footer are built once with fixed heights, the footer slots have minimum widths, and the image is invisible until it has loaded, so loading changes no layout. Fit is object-fit contain in a flex stage, 100% lifts the max size and scrolls. Media is paused when the tab is hidden (a MutationObserver on hidden, because Views has no deactivate) and its source is cleared on dispose to stop the stream. The URL carries the file's mtime so Reload from disk bypasses the cache. A PDF uses the webview's own viewer in an iframe when navigator.pdfViewerEnabled is not false, otherwise shows a message.

### frontend/src/ui/preview/index.ts, command-palette.ts · Ctrl+K chord

- refers-to: frontend/src/ui/preview/index.ts :: installPreview; frontend/src/ui/command-palette.ts :: PALETTE_CHORD
- kind: rationale
- logged: v0.11.0 · 2026-10-30

Ctrl+K in a Markdown tab used to be swallowed and the palette opened 700 ms later unless V followed. Now Ctrl+K opens the palette at once (the preview only notes the time). If V is the first key typed into the still empty palette within 700 ms, the palette sends a cancelable window event with the key and a close callback; the preview answers by closing the palette and running Open Preview to the Side. Any other key just types. Measured: palette visible 85 ms after the key at 4x throttle, chord V closes it and opens the side preview.

### frontend/src/ui/preview/external.ts · openExternal

- refers-to: frontend/src/ui/preview/external.ts :: openExternal; frontend/src/ui/preview/md-preview.ts :: MarkdownPreview.click; src-tauri/capabilities/default.json :: shell:allow-open
- kind: rationale
- logged: v0.11.0 · 2026-10-30

External links in the preview now do something and never navigate the window. Only http, https and mailto pass. In the desktop app the link goes to the shell plugin's open command through `invoke('plugin:shell|open')` from the Tauri core API already installed (no new npm dependency; the Rust plugin was already registered), which needed one capability line, shell:allow-open, in src-tauri/capabilities/default.json; the plugin's default scope accepts only http, https, mailto and tel. If that fails, or in a browser, the link is copied and a toast says so. The desktop path could not be run in this session (no desktop build); the browser path was measured: the page URL is unchanged, the clipboard holds the link and the toast reads Link copied.

### frontend/src/ui/preview/external.ts · checked, openExternal

- refers-to: frontend/src/ui/preview/external.ts :: checked, openExternal
- kind: rationale
- logged: v0.11.0 · 2026-10-30

review L5. The link is parsed with `new URL()`; anything with whitespace or a control character, any scheme other than http, https and mailto, and an http link without a host are refused, and the normalised `href` is what is handed to the shell and shown. The toast shows the destination (cut at 200 characters) as text through `textContent` via `toast`. `src-tauri/tauri.conf.json` pins `plugins.shell.open` to `^(https?://[^\s]+|mailto:[^\s]+)$`, which drops `tel:` that the plugin default allowed.

### frontend/src/ui/preview/media-tab.ts · DASH

- refers-to: frontend/src/ui/preview/media-tab.ts :: DASH
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

The placeholder for a missing dimension or size was an em dash: `const DASH = '<U+2014>';`, the character itself between the quotes (named here by its code point, since Markdown in this repository carries no em dash). The family writes no em dash and no en dash in UI text, and its own readouts show a missing value as a hyphen-minus (FormVis's ruler readouts, Substrate's console cards), so DASH is now `'-'`. After the change `git grep` finds no U+2014 anywhere in the repository.
