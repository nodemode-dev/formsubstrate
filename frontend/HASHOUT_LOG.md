# HASHOUT_LOG · frontend · subform

Current build version: v0.4.0
Last updated: 2026-10-30 · Phases F3 and F4

## Org-navi-map

```
frontend/
  package.json            package manifest, pins, scripts (dev, build, preview, typecheck, tauri)
  package-lock.json       npm lockfile, committed
  tsconfig.json           strict TypeScript, bundler resolution, src only
  vite.config.ts          dev 5650, preview 5651, host false, /api proxy to the engine
  index.html              critical inline style, theme-boot script, font preloads, mount roots
  boot_frontend           starts the Vite dev server
  oc_install              installs npm dependencies
  HASHOUT_LOG.md          this log
  public/
    splash.html           splash card shown by the desktop shell before the main window
  src/
    main.ts               entry: calls startApp
    app.ts                F2 shell: commands, menus, title bar, tabs, status, palette, reveal
    io/
      api.ts              engine client (/api/health) for the status bar
      workspace.ts        workspace, files and search client (log: src/extensions/HASHOUT_LOG.md)
      secrets.ts          secret names and presence through the engine keyring
    extensions/           registry, files tree, search (own log: src/extensions/HASHOUT_LOG.md)
    ui/
      dom.ts              zero-flash DOM helpers and revealApp
      icons.ts            inline currentColor SVG icons
      themes.ts           the family theme profiles, accent, applyTheme
      prefs.ts            workbench preferences, ui scale and font size
      i18n.ts             t, tn, page translator (English only this phase)
      i18n/langs.ts       language codes and names
      dialogs.ts          modal Dialog, confirm, prompt, save changes
      dialog-history.ts   undo, Tab order and Reset inside dialogs
      toast.ts            bottom notices
      dropdown.ts         native select shown as the glass menu
      number-fields.ts    arithmetic, scrub and pop-up slider for number fields
      brand.ts            the three-bar mark and wordmark
      commands.ts         command registry and key bindings
      menu.ts             in-window menu bar and popup menus
      native-menu.ts      macOS menu bar in the desktop app
      command-palette.ts  fuzzy command palette
      caption-buttons.ts  Windows and Linux title bar buttons
      titlebar-tools.ts   theme toggle, command search, agent and terminal buttons
      tabs.ts             document tab row and window title
      status.ts           status bar slots
      jobs-list.ts        background jobs popup
      workspace-store.ts  shell state: workspace, documents, jobs, sessions
      home.ts             Home: Start, Recent, Workspaces, Sessions
      home-files.ts       Recent and Workspaces lists
      open-folder.ts      folder picker (desktop dialog or typed path) and open
      settings.ts         Preferences dialog, eleven sections
      workbench.ts        activity rail, side panel, editor area (log: src/extensions/HASHOUT_LOG.md)
      editor/             CodeMirror 6 editor host (own log: src/ui/editor/HASHOUT_LOG.md)
      panels/
        controls.ts       slider, select, check, toggle, colour and number rows
    styles/
      fonts.css           Inter and JetBrains Mono imports
      tokens.css          tokens, z-index scale, resets, liquid glass
      shell.css           app grid, title bar, menus, tabs, status, toasts, palette
      dialogs.css         scrim, dialog frame, rows, Preferences
      light-mode.css      light-profile shadow overrides
      scrollbars.css      no scrollbar drawn anywhere
      home.css            Home and its lists (.cv-home*, .cv-hf*, .cv-drop)
      workbench.css       rail, side panel, tree, search (.cv-wb-*, .cv-tree-*, .cv-search-*)
      editor.css          editor host (.cv-editor*)
```

## Table of contents

- index.html
- public/splash.html
- src/main.ts
- src/ui/dom.ts
- src/styles/base.css (removed in v0.2.0)
- src/styles (tokens, fonts, scrollbars, light-mode, shell, dialogs)
- src/ui leaf modules (icons, themes, prefs, i18n, dialogs, dialog-history, toast, dropdown, number-fields, brand, panels/controls)
- src/ui shell modules (commands, menu, native-menu, command-palette, caption-buttons, titlebar-tools, tabs, status, jobs-list, workspace-store) and src/app.ts
- F2 integration (index.html links, main.ts, io/api.ts, fixes)
- F2 review fixes (v0.2.1)
- F3 Home and Preferences (v0.4.0)
- F4 integration (v0.4.0); editor, workbench and extensions have their own logs
- vite.config.ts
- package.json
- boot_frontend and oc_install

## index.html

### index.html · critical inline style

- refers-to: frontend/index.html :: style block
- kind: rationale
- logged: v0.1.0 · 2026-10-30

html and body are dark (#0a0a0a) before any stylesheet loads, #app is visibility hidden until body.app-ready, so the window never shows an unstyled or half built frame. revealApp in src/ui/dom.ts is the only thing that adds app-ready. The .hidden rule is the family helper class.

### index.html · theme-boot script

- refers-to: frontend/index.html :: inline script in head
- kind: explainer
- logged: v0.1.0 · 2026-10-30

Ported from the stylized-nodemode theme-boot v0.10.0 as used in formvis. It must stay inline, after the critical style and before any stylesheet link. It runs synchronously before the body exists, reads the shared family key nodemode_ui_settings, and puts the saved profile colours, shadow, accent and intensity on documentElement before the first paint. That is the whole mechanism behind no theme flash on hard reload. The PROFILES table must stay in sync with themes.ts (the same ids) once themes.ts is ported; only surface-visible variables are set here and themes.ts re-applies everything when the bundle loads. For light profiles the body class theme-light is applied by a MutationObserver the instant body appears, still before paint, and theme-light-pending is on the root until then.

### index.html · theme-boot legacy gate

- refers-to: frontend/index.html :: theme-boot script
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

formvis only honoured a saved theme and accent when the saved settings carried appearance 2 or 3 (a choice saved before the Studio Dark redesign was set aside once), and ignored the old lavender accent #aba0d3 on appearance 2. Removed: subform has no pre-redesign data. A saved theme is accepted when its id exists in PROFILES, the accent when present, the intensity when numeric (clamped 0 to 1.5).

### index.html · user skin lookup

- refers-to: frontend/index.html :: theme-boot script
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

formvis read localStorage formvis_user_skin and, when its id matched the saved theme and its palette had more than nine entries, registered it in PROFILES (and in LIGHT when flagged light). Removed: custom skins are a formvis feature. If subform adds skins later, use a key with the prefix subform. and restore this lookup.

### index.html · no-skin query switch

- refers-to: frontend/index.html :: theme-boot script
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

formvis skipped the saved settings when the URL carried ?no-skin. Removed with the skin lookup.

### index.html · terminal dock boot script

- refers-to: frontend/index.html :: second inline script in formvis
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

formvis set data-ft-dock, data-ft-dock-h and --ft-dock-size on documentElement from localStorage formvis.terminal before first paint so terminal.css reserved the dock row and nothing moved on open. Removed in F1 (no terminal yet).

### index.html · terminal dock boot script return

- refers-to: frontend/index.html :: head
- kind: todo
- logged: v0.1.0 · 2026-10-30

When the terminal dock lands, add the same pre-paint script reading the key subform.terminal (fields open, h; h accepted between 120 and 2000, default 280) and add the dock stylesheet link.

### index.html · icons and stylesheets

- refers-to: frontend/index.html :: head links
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

Removed the favicon.ico, favicon.svg and apple-touch-icon links (no icon files exist in F1; add them with the icon assets in a later phase) and the stylesheet links tokens, shell, panels, dialogs, relight, generate-panel, boxes, light-mode, terminal, scrollbars (tokens and shell CSS arrive in F2; the image tool sheets do not apply). fonts.css became base.css.

### index.html · font preloads

- refers-to: frontend/index.html :: preload links
- kind: warning-context
- logged: v0.1.0 · 2026-10-30

The preload hrefs point at /node_modules/@fontsource/..., which the dev server serves directly; `vite build` rewrites them to the hashed files in `dist/assets` (checked in review: `dist/index.html` preloads `/assets/inter-latin-*-normal-<hash>.woff2`), so the preloads work in both. Kept as formvis has them.

## public/splash.html

### public/splash.html · splash card

- refers-to: frontend/public/splash.html :: body
- kind: explainer
- logged: v0.1.0 · 2026-10-30

Binding values from the splash and boot map: the card is the body itself (background #0a0a0a, border 1px rgba(255,255,255,0.09), radius 16px, overflow hidden), html transparent, flex column with gap 18px, text 13px #a8a8b8, track 180 by 3 px #1f1f26, fill gradient 90deg #3A7BFF, #9A5CFF 30%, #FF4F7A 62%, #FFAE2B. The CSS radius must equal the native radius set in src-tauri reveal.rs round_splash.

### public/splash.html · bar animation

- refers-to: frontend/public/splash.html :: .fill, @keyframes load
- kind: rationale
- logged: v0.1.0 · 2026-10-30

The fill animates with transform scaleX only (0.04 to 0.92 over 2.6 s, cubic-bezier(0.25, 0.6, 0.35, 1), then holds). The finish hook freezes the fill at its current computed transform, adds .done (0.2 s ease-out to scaleX(1)) and clears the inline transform on the next frame so the transition runs from the frozen value.

### public/splash.html · window.subformSplashDone

- refers-to: frontend/public/splash.html :: window.subformSplashDone
- kind: warning-context
- logged: v0.1.0 · 2026-10-30

Renamed from window.formvisSplashDone. The shell in src-tauri/src/reveal.rs show_main calls this exact name. Rename both sides together.

### public/splash.html · icon

- refers-to: frontend/public/splash.html :: svg
- kind: explainer
- logged: v0.1.0 · 2026-10-30

Inline copy of assets/subform_icon.svg at 72 by 72 (viewBox 1024). The gradient id g became splash-paint so it cannot collide if the page is ever embedded. The paint colours match the bar gradient.

### public/splash.html · formvis icon

- refers-to: frontend/public/splash.html :: svg
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

The formvis mark (clip paths, tile, rim, sheen, cover and grip gradients) was removed and replaced by the subform icon.

## src/main.ts

### src/main.ts · F1 boot

- refers-to: frontend/src/main.ts :: buildShell, fontsReady
- kind: explainer
- logged: v0.1.0 · 2026-10-30

Builds one placeholder region in #app (created with createElement, appended once, never rewritten), waits for document.fonts.ready or 2.5 s (FONT_WAIT_MS, the family constant from the boot map) and calls revealApp once. F2 and later replace the placeholder with the real shell, keeping the same order: build everything, wait for fonts, reveal.

### src/main.ts · formvis start order

- refers-to: frontend/src/main.ts :: module body
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

formvis ran carryOver() (data saved before the rename moved across), then startLanguage() (the language table is loaded before the interface is built so nothing shows in English first), then startApp() and startPageTranslator(). All removed: subform has no legacy data and no language tables yet.

### src/main.ts · language and startApp return

- refers-to: frontend/src/main.ts :: module body
- kind: todo
- logged: v0.1.0 · 2026-10-30

When i18n lands, load the saved language table before building the shell, as formvis did, so nothing flashes in English.

## src/ui/dom.ts

### src/ui/dom.ts · module purpose

- refers-to: frontend/src/ui/dom.ts :: module
- kind: explainer
- logged: v0.1.0 · 2026-10-30

Ported whole from formvis (stylized-nodemode dom-stable.ts v0.10.0). The helpers behind the zero-flash law: delayedIndicator (no spinner for the first 300 ms; once shown, held 250 ms), patchList (keyed reconcile: update, insert, remove; never clear and refill), swapMedia (decode off-screen, swap on load, the old frame stays), setText (write textContent only when changed), reserve (set a box before async content arrives), revealApp (flip body.app-ready once). Import these instead of writing innerHTML into a live container. Every helper is framework free; render a container once, then patch it.

### src/ui/dom.ts · delayedIndicator

- refers-to: frontend/src/ui/dom.ts :: delayedIndicator
- kind: explainer
- logged: v0.1.0 · 2026-10-30

Shows an indicator only if the wait outlasts delay; once visible it stays at least minVisible so it cannot blink. Returns the dismiss function. The numbers 300 and 250 are the app's own.

### src/ui/dom.ts · pendingClass

- refers-to: frontend/src/ui/dom.ts :: pendingClass
- kind: explainer
- logged: v0.1.0 · 2026-10-30

Convenience over delayedIndicator for an element that carries .ns-pending: toggles .is-shown so the element keeps its reserved box while hidden.

### src/ui/dom.ts · patchList

- refers-to: frontend/src/ui/dom.ts :: patchList, PatchListOptions
- kind: explainer
- logged: v0.1.0 · 2026-10-30

key is a stable identity for each item, never an array index. create builds a new node for an item that does not exist yet. update changes an existing node in place and touches only what changed. Existing nodes are updated in place so scroll, focus, selection and in-progress input survive; missing nodes are created, extra nodes removed, order corrected with insertBefore only where it differs.

### src/ui/dom.ts · swapMedia

- refers-to: frontend/src/ui/dom.ts :: swapMedia
- kind: explainer
- logged: v0.1.0 · 2026-10-30

Replaces an image source without a blank frame: decode off-screen, then swap src in one write. Resolves when the swap happened, rejects on load failure.

### src/ui/dom.ts · setText

- refers-to: frontend/src/ui/dom.ts :: setText
- kind: explainer
- logged: v0.1.0 · 2026-10-30

Writes text only when it differs. Numeric readouts should also carry .ns-tabular and a reserved width so neighbours never shift.

### src/ui/dom.ts · setClass

- refers-to: frontend/src/ui/dom.ts :: setClass
- kind: explainer
- logged: v0.1.0 · 2026-10-30

Toggles a class only when the state differs (no attribute churn).

### src/ui/dom.ts · reserve

- refers-to: frontend/src/ui/dom.ts :: reserve
- kind: explainer
- logged: v0.1.0 · 2026-10-30

Reserves a box before content lands. Width and height in px, or an aspect ratio string such as '16 / 9'.

### src/ui/dom.ts · revealApp

- refers-to: frontend/src/ui/dom.ts :: revealApp
- kind: explainer
- logged: v0.1.0 · 2026-10-30

#app is visibility hidden from the critical inline style. Call this exactly once after the first render is in the DOM. Two animation frames so fonts and layout settle before the single reveal. Inside the desktop shell (when __TAURI_INTERNALS__ is on window) one more frame passes and then the Tauri command app_ready is invoked, which makes src-tauri reveal.rs show the window whole after the splash minimum. The command needs allow-app-ready in the capability because the page is a remote origin. The invoke is dynamically imported so the browser build never loads the Tauri API.

### src/ui/dom.ts · mountOnce

- refers-to: frontend/src/ui/dom.ts :: mountOnce
- kind: warning-context
- logged: v0.1.0 · 2026-10-30

Mounts a fresh subtree from a template string once into an empty host. It refuses to overwrite a host that already has rendered children (the mistake the zero-flash law forbids); patch instead. Changed from formvis: the string is parsed in a template element and appended, instead of assigning host.innerHTML, so no innerHTML is written on a live container.

### src/ui/dom.ts · el, q, setHtml

- refers-to: frontend/src/ui/dom.ts :: el, q, setHtml
- kind: warning-context
- logged: v0.1.0 · 2026-10-30

el and setHtml parse markup in a detached template, never on a live container; setHtml skips the write when the key matches and swaps children with replaceChildren. Use only with trusted or escaped strings (escapeHtml).

### src/ui/dom.ts · mountOnce comment

- refers-to: frontend/src/ui/dom.ts :: mountOnce
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

The trailing comment "fresh" on the innerHTML assignment was removed along with the assignment.

## src/styles/base.css

### src/styles/base.css · scope

- refers-to: frontend/src/styles/base.css :: file
- kind: explainer
- logged: v0.1.0 · 2026-10-30

F1 only: the five font imports that formvis kept in fonts.css (Inter 400, 500, 600; JetBrains Mono 400, 700), border-box sizing, the body font and colours read from the variables the theme-boot script sets, and the placeholder region. The fallbacks inside var() match the nodemode-dark profile so the page is correct even if the boot script did not run. Tokens, z-index layers and shell CSS arrive in F2 (tokens.css, shell.css).

### src/styles/base.css · removed

- refers-to: frontend/src/styles/base.css :: file
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Removed in F2. The font imports moved to fonts.css, box sizing and the body font to the resets in tokens.css, and the placeholder region gave way to the shell (.cv-app in shell.css). index.html links the six F2 sheets instead.

## src/styles

### src/styles/tokens.css · header and rules

- refers-to: frontend/src/styles/tokens.css :: :root, body.theme-light
- kind: rationale
- logged: v0.2.0 · 2026-10-30

Ported whole from formvis tokens.css (itself the NodeMode base plus the formvis block). Rules the file encodes: colour comes from a token, never a literal; semantic literals (ok, warn, danger, success and danger fills, brand orange, cta) are the only literal colours and live here as named tokens so they stay greppable; every z-index in the app is a var(--z-*) from the scale; dark is the default and light is body.theme-light as an override layer. Token NAMES are the ones NodeMode's own sheets read, so family sheets work unchanged. VALUES are the base dark profile (Studio Dark); themes.ts overwrites the theme-owned ones at runtime and the theme-boot script does the same before first paint.

### src/styles/tokens.css · color-scheme

- refers-to: frontend/src/styles/tokens.css :: :root color-scheme
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Native controls (checkboxes, dropdowns, scrollbars) are drawn dark, as the target's; the light profiles set color-scheme: light through body.theme-light.

### src/styles/tokens.css · accent

- refers-to: frontend/src/styles/tokens.css :: --accent-color, --accent-color-dim, --accent-color-hover
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Settings-driven in the app; --accent-color-dim is the accent plus 33 alpha. The default is the target's orange #f97316 (the formvis source comment called it the target's lavender in one place; the value is orange).

### src/styles/tokens.css · theme-owned surfaces

- refers-to: frontend/src/styles/tokens.css :: --bg-primary, --bg-secondary, --bg-tertiary, --bg-node, --border-color, --border-light, --text-primary, --text-secondary, --text-muted, --canvas-bg, --grid-color
- kind: explainer
- logged: v0.2.0 · 2026-10-30

The Studio Dark profile's values, measured from the target (formvis UI_SPEC.md). Theme-owned: themes.ts writes them on documentElement.

### src/styles/tokens.css · derived surfaces and Phase 21 semantic tokens

- refers-to: frontend/src/styles/tokens.css :: --bg-input, --bg-hover, --bg-scrim, --surface-*, --line-*, --accent-soft, --accent-line, --accent-glow, --accent-ink, --accent-wash
- kind: explainer
- logged: v0.2.0 · 2026-10-30

v7.3.0 light-mode pass: body.theme-light flips the derived surfaces. Phase 21 semantic tokens: every surface, line and accent tint the redesign uses, derived from the theme's own variables and the accent, so all profiles (the light ones too) are right and nothing is hardcoded. --accent-intensity (Preferences > Interface, 0 to 1.5) scales how strongly the accent tints what it marks. --text-on-cta is the homepage New Flow button: black on accent. The redesign's black header strips and white primary buttons are what body.theme-light replaces with theme-relative values.

### src/styles/tokens.css · z-index scale

- refers-to: frontend/src/styles/tokens.css :: --z-base .. --z-debug
- kind: rationale
- logged: v0.2.0 · 2026-10-30

Bands mirror NodeMode's verified registry (.docs/ADDING_NODES_AND_UI.md section 6.2.2) so a companion surface next to the app never collides. Component CSS uses var(--z-*) only; never a raw number, never 9999. Meanings: raised 8 hovered card lift; selected 9 selected card; rail 10 mini icon rail; chrome 100 top and bottom bars and selection box; menu 200 dropdown menus anchored to chrome and the overlay root; temp 500 transient drag artifacts; companion 800 floating panels (navigator 800, chat 810); taskbar 900 floating taskbar; modal 1000 gallery and dialog scrim band; settings 1500 settings popout; context 2000 context menus, dropdown lists, number pop-ups; toast 3000 (added by formvis, between context and portal); portal 4000 extension panels 4000 to 6999; home 10000 the homepage root (formvis Home itself uses calc(var(--z-menu) - 1)); home-modal 10010; home-preview 10100; account-panel 10500; overlay 50000 full-screen editors; overlay-modal 60000; debug 100000 development only.

### src/styles/tokens.css · layout tokens

- refers-to: frontend/src/styles/tokens.css :: --cv-titlebar-h, --cv-options-h, --cv-tabs-h, --cv-status-h, --cv-rail-w, --ft-dock-h
- kind: explainer
- logged: v0.2.0 · 2026-10-30

formvis layout tokens kept under their family names (the maps are written against them). --cv-rail-w only sizes the brand cell in the tab row (max of it and 44px). --ft-dock-h is new and is 0px in F2: the grid row for the F5 terminal dock already exists between main and status. The formvis source said these were "app tokens appended to the NodeMode base: layout sizes, the canvas paint colors the stage reads per draw, and the toast band".

### src/styles/tokens.css · liquid glass

- refers-to: frontend/src/styles/tokens.css :: --glass-*, .cv-menu, .cv-dd-pop, .cv-search-pop
- kind: rationale
- logged: v0.2.0 · 2026-10-30

Liquid glass (the owner's walkthrough): one look for every menu, dropdown and flyout, built from the theme's own surface so it holds in light themes. --glass-bg is dense enough (82 percent) that nothing behind reads through. The rule uses !important because the menu sheets set their own background and border later. The selector list was .cv-menu, .cv-dd-pop, .cv-flyout, .cv-search-pop, .cv-props-fly; the last two flyouts are not in this repo.

### src/styles/tokens.css · resets

- refers-to: frontend/src/styles/tokens.css :: *, body, button, input, .icon, @keyframes spin, body.animations-disabled
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Resets exactly as the app ships them. formvis set user-select: none globally because it is an editor; here buttons and role=button opt out and inputs opt in. body.animations-disabled is the switch for settings animationsEnabled=false. prefers-reduced-motion collapses all durations.

### src/styles/tokens.css · tokens added for this repo

- refers-to: frontend/src/styles/tokens.css :: --space-0, --space-1h, --space-2h, --space-3h, --radius-hair, --radius-ctl, --radius-input, --radius-2xl, --shadow-pop, --shadow-dialog, --shadow-thumb, --shadow-inset-hl, --shadow-ink, --scrim-blur
- kind: rationale
- logged: v0.2.0 · 2026-10-30

formvis used raw 2px, 6px, 10px and 14px spacing, raw 2px, 7px, 9px and 14px radii and raw rgba shadows in shell.css and dialogs.css. The rule here is tokens only, so each value became a named token with the same number. Where a raw value had no exact twin it was mapped to the nearest token: .cv-key radius 5px became --radius-sm (4px); the preferences range thumb radius 5px 5px 4px 4px became --radius and --radius-sm (6px 6px 4px 4px); the toggle knob shadow (0.4 alpha) and the range thumb shadow (0.5 alpha) share --shadow-thumb; the number pop-up shadow became --shadow-sm; the jobs list and options pop shadow (0 10px 30px) became --shadow-lg; --bg-scrim now carries the final formvis scrim colour (8, 6, 14 at 45 percent) that dialogs.css used to override with a literal.

### src/styles/tokens.css · dropped tokens

- refers-to: frontend/src/styles/tokens.css :: removed tokens
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Dropped because only the image canvas, node graph or layer panels read them: --node-shadow, --grid-size, --node-opacity, --connection-width, --canvas-bg-image (NodeMode canvas), all thirteen --handle-* colours (node connector colours), --cv-layers-w, --cv-row-h, --cv-thumb (layers panel), --cv-checker-a, --cv-checker-b (transparency checker), --cv-ants-a, --cv-ants-b (marching ants), --cv-pixel-grid, --cv-handle-fill, --cv-doc-edge (canvas paint colours), --cv-action-blue, --cv-action-violet (image action colours). Also dropped: body.nm-home .nm-canvas-surface { display: none !important } (the NodeMode view gate for body-mounted canvas surfaces) and the .ns-no-select helper class (the companion-site opt-out; the app uses role=button and button instead). The duplicate body.theme-light { color-scheme: light } is merged into the main light block.

### src/styles/fonts.css · imports

- refers-to: frontend/src/styles/fonts.css :: @import
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Inter 400, 500, 600 and JetBrains Mono 400, 700 from @fontsource. --font-ui lists system fonts first and Inter fourth, so the packaged fonts only render where the system stack does not resolve; the Inter files are also preloaded by index.html. Ported unchanged, same as base.css had them.

### src/styles/scrollbars.css · zero scrollbars

- refers-to: frontend/src/styles/scrollbars.css :: *, ::-webkit-scrollbar, html, body
- kind: rationale
- logged: v0.2.0 · 2026-10-30

No scrollbar is ever drawn, anywhere (the owner's rule: zero scrollbars). Everything still scrolls by wheel, trackpad, touch and keys; only the bar is gone. !important so no later rule can bring one back; both engines' ways, since WebKit (the macOS app) and Chromium read ::-webkit-scrollbar and Firefox reads scrollbar-width.

### src/styles/light-mode.css · menu, dialog and toast shadows

- refers-to: frontend/src/styles/light-mode.css :: body.theme-light .cv-menu, .cv-dialog, .cv-toast
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Shadow override for the light profiles; the real light-mode work is body.theme-light in tokens.css and the profile variables themes.ts writes.

### src/styles/light-mode.css · layer thumbs

- refers-to: frontend/src/styles/light-mode.css :: body.theme-light .cv-layer-thumb, .cv-layer-mask
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

The second formvis rule (thumb and mask background in light themes) belongs to the layers panel, which this repo does not have. Left out.

### src/styles/shell.css · app grid

- refers-to: frontend/src/styles/shell.css :: .cv-app, .cv-app > .cv-titlebar, .cv-app > .cv-main, .cv-app > .cv-status
- kind: rationale
- logged: v0.2.0 · 2026-10-30

formvis ended with rows title bar, main, dock (--ft-dock-h, from terminal.css), status. Here the four rows exist already with the dock row at 0px and the three children are placed by explicit grid-row, so F5 adds the dock element in row 3 without touching this rule and the status bar never falls into the dock row. The app root never scrolls: overflow: clip stops a focused control sliding the whole window sideways (formvis D06). user-select is off on the shell.

### src/styles/shell.css · title bar

- refers-to: frontend/src/styles/shell.css :: .cv-titlebar, .cv-tb-doc, .cv-tb-app, :root.has-overlay-titlebar, .has-caption-buttons .cv-titlebar
- kind: rationale
- logged: v0.2.0 · 2026-10-30

formvis spread the title bar over three layers (a base grid at line 10, the Phase 21 gradient override at line 365, the final four-column grid at lines 391 to 394); here they are folded into the final cascade: columns auto minmax(0,1fr) auto auto, menu bar column 1, zoom group column 3, title tools column 4, gradient from --surface-2 to --surface-1, bottom border --line-0, position relative (anchor for .cv-caption and the absolute centre text). Under the overlay title bar (macOS) the bar is 38px (matches Rust traffic_lights ROW) and the left padding is 78px (LEFT 14 plus three buttons) so the lights are cleared. The window's title: the document ("dot name") at the left, the app name centred on the window. They give way (truncate, then hide) before they would reach the menus or the tools. The document name shows only where the menus are the system's (the in-window menu bar leaves no room left of the centre; the tab shows the name). Hide rules: both texts under 1259px; the centred text under 1419px for the overlay bar without native menus, and under 1499px with caption buttons. The base-layer text colour tokens (--bg-secondary and --border-color on the bar) are replaced by the gradient and --line-0 exactly as formvis's last layer does.

### src/styles/shell.css · caption buttons

- refers-to: frontend/src/styles/shell.css :: .cv-caption, .cv-caption-btn
- kind: explainer
- logged: v0.2.0 · 2026-10-30

The desktop app's own title bar (Windows and Linux): Minimize, Maximize and Close at its right end, each as wide as the bar is tall; Close hovers --danger.

### src/styles/shell.css · menu bar and popups

- refers-to: frontend/src/styles/shell.css :: .cv-menubar, .cv-menu-btn, .cv-menu, .cv-menu-item, .cv-menu-sub, .cv-menu-check, .cv-menu-keys, .cv-menu-sep, .has-native-menus
- kind: explainer
- logged: v0.2.0 · 2026-10-30

The menu popups were in formvis panels.css (line 112 and following), not shell.css; they are in shell.css here because the menu bar is a shell region. With formvis's menus in the macOS menu bar (the desktop app), the in-window menu bar gives way: .has-native-menus hides .cv-menubar and shows the document name. Alt-mnemonics underline the first letter through .is-menu-mnemonics on the root element. The popup background and border are overridden by the liquid-glass rule in tokens.css.

### src/styles/shell.css · tab row

- refers-to: frontend/src/styles/shell.css :: .cv-doc-tabs, .cv-brand, .cv-tabs, .cv-tab-strip, .cv-tab, .cv-tab-name, .cv-tab-dot, .cv-tab-mode, .cv-tab-close, .cv-tab-pin
- kind: rationale
- logged: v0.2.0 · 2026-10-30

The document tabs sit in their own row above the stage, as the target's: the name, an asterisk when unsaved, the mode dimmed, a circled close; the title bar keeps the brand, menus, zoom and its tools. Document tabs have rounded top corners and the active one is raised. The dirty dot is a text asterisk drawn by ::after on .cv-tab-dot. Tabs and the new-document button moved by a tab arriving or leaving ease into place (ui/tabs.ts render) through --flip-x and .is-settling; a busy tab shows an accent progress line that pulses (or holds, in reduced motion) and takes --tab-progress when set. The brand cell is the Home button: it is a button by role (cursor pointer) with a divider drawn by ::after. body.large-tabs enlarges the row to 44px.

### src/styles/shell.css · main grid and options bar

- refers-to: frontend/src/styles/shell.css :: .cv-main, .cv-options, .cv-opt, .cv-opt-title, .cv-opt-sep, .cv-stage
- kind: rationale
- logged: v0.2.0 · 2026-10-30

formvis .cv-main was a five-column grid (rail, stage, properties, resizer, layers) with three rows. Here it is one column. The options row exists only when .cv-main contains a direct .cv-options (:has), so a shell without an options bar leaves no empty 40px row. The options bar is the quiet row (--surface-0, --line-0) with the tool's name as a raised chip; the app root never scrolls, so the bar scrolls itself. Rows shown only sometimes are hidden by attribute and the rows' own display must not override it (.cv-options [hidden]). .cv-stage is a plain --bg-primary region that fills the rest.

### src/styles/shell.css · status bar

- refers-to: frontend/src/styles/shell.css :: .cv-status, .cv-st-*, .cv-jobs*
- kind: rationale
- logged: v0.2.0 · 2026-10-30

Fixed widths so cycling and updates never reflow: .cv-st-info is 196px wide and 20px tall, .cv-st-busy is 296px, .cv-st-steps has a 84px minimum, the engine, GPU and memory slots have flex bases of 150, 84 and 140px with ellipsis, the hint takes the rest. .cv-st-busy is shown by .is-shown (the status code uses pendingClass with a 300 ms delay and a 250 ms minimum so quick jobs never flash) and is clickable to toggle the jobs list. The formvis rule listed display: inline-flex then display: none in the same declaration block; only the effective display: none remains. The memory slot turns a warning colour past 85 percent of the budget: formvis used var(--warning-color, #f59e0b), here var(--warn) from tokens. The error hint keeps formvis's documented fallback var(--danger, #e5484d). The jobs list mounts in #overlay-root on the menu layer so it opens above the Working indicator and below dialogs.

### src/styles/shell.css · toasts and overlay roots

- refers-to: frontend/src/styles/shell.css :: #overlay-root, #toast-root, .cv-toast*
- kind: rationale
- logged: v0.2.0 · 2026-10-30

formvis first placed #toast-root bottom right and then, in panels.css, forced it to the canvas centre (never over the panels). Here it is centred at the bottom, above the status bar by --cv-status-h plus --space-3, on --z-toast. #overlay-root is a click-through full-window layer on --z-menu; only its children take the pointer. Toasts take no pointer except their action and close buttons.

### src/styles/shell.css · command palette

- refers-to: frontend/src/styles/shell.css :: .cv-palette-box, .cv-palette-list, .cv-palette-row, .cv-palette-icon, .cv-palette-empty, .cv-list-row, .cv-list-meta
- kind: explainer
- logged: v0.2.0 · 2026-10-30

formvis kept these in dialogs.css (lines 84 to 105). The palette is a dialog with a 12-row list box (12 rows of --ctl plus the 2px gaps, padding and border) so it never resizes as the filter narrows; rows are .cv-list-row buttons with an icon, a name and a right-aligned shortcut column of 250px.

### src/styles/shell.css · dropdown

- refers-to: frontend/src/styles/shell.css :: .cv-dd-native, .cv-dd-btn, .cv-dd-pop, .cv-dd-search, .cv-dd-head, .cv-dd-item
- kind: explainer
- logged: v0.2.0 · 2026-10-30

A select shown as the target's menu (ui/dropdown.ts): the native select stays in the DOM, one pixel and invisible; the button, a rounded list on the context layer, grey headings and a tick on the chosen item. The pop-up is also covered by the liquid-glass rule.

### src/styles/shell.css · full-screen and narrow

- refers-to: frontend/src/styles/shell.css :: .cv-app.is-screen-menu, .cv-app.is-screen-full, @media (max-width: 719px)
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Screen modes: menu-bar-only and full-screen set the status and tab heights to 0 and hide those regions; full screen also zeroes the title bar. Under 720px the title bar collapses to minmax(0,1fr) 0 auto, the title tools and the zoom buttons wait in the menus and Preferences, the menu bar and the options bar scroll sideways, and nothing may be wider than the screen (a tap would scroll the page sideways).

### src/styles/shell.css · buttons and keys

- refers-to: frontend/src/styles/shell.css :: .cv-btn, .cv-btn-primary, .cv-btn-ghost, .cv-btn-danger, .cv-icon-btn, .cv-sep, .cv-key
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Ported from the top of formvis shell.css. .cv-key is the key cap used by Home's hero buttons and the dropdown flyouts; adjacent caps overlap by one --space-1.

### src/styles/shell.css · left out: canvas and tools

- refers-to: frontend/src/styles/shell.css :: .cv-rail*, .cv-tool*, .cv-flyout*, .cv-colors, .cv-swatch*, .cv-swap, .cv-reset, .cv-color-input, .cv-canvas, .cv-scene*, .cv-ruler*, .cv-sb*, .cv-pills, .cv-pill, .cv-welcome*, .cv-mark, .cv-stage-col*, .cv-view-tiles, .cv-gutters, .cv-gutter*, .cv-view-tile*, .cv-float*, .cv-type-editor*, .cv-seg, .cv-opt-tool, .cv-opt-icon, .cv-mode-btn
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Image-editor only. Includes the tool rail and its two-column mode, tool groups and flyouts (and their .cv-tool.has-group dot), colour swatches, the canvas and scene layers, rulers, canvas scrollbars, status pills, the welcome card (subform has Home), arrange tiles and gutters, floating views, the type editor and its kinds, native-GPU transparency rules (.is-native-canvas), the stage pasteboard dot grid (1px dots every 22px in --grid-color) and the stage drop highlight (.cv-stage.is-layer-drop). The stage is plain.

### src/styles/shell.css · left out: panels and docks

- refers-to: frontend/src/styles/shell.css :: .cv-props-col, .cv-layers, .cv-resizer, .cv-selmask-*, .cv-taskbar, .cv-tb-*, .cv-sheet-btn, .cv-tb-cols, .cv-edit-toolbar, .cv-edit-tool, .cv-vtl*
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Panel columns, the properties and layers dock and the resizer between them; panel-hiding screen modes (.is-panels-hidden, .is-peek-left, .is-peek-right, .is-dock-hidden, .is-rail-hidden, .is-options-hidden) and the compact layout's sheets (under 720px the rail, properties and layers became sheets over the canvas, moved by transform; the sheet buttons .cv-sheet-btn sat in the title bar); the selection-mask workspace; the contextual task bar (a pill over the canvas on the chrome layer: solid, not frosted, because a backdrop blur over the canvas is redrawn with every canvas frame, which the desktop window's WebKit pays for on each brush dab and pan; only its own box takes the pointer; the sets share one cell so the More button never moves); Edit Toolbar's list; and the video timeline (.cv-vtl*, fixed height 220px so scrubbing changes nothing around it). The title bar dock-drop outline on the tab row (.cv-doc-tabs.is-dock-target) goes with float docking.

### src/styles/shell.css · left out: options bar internals

- refers-to: frontend/src/styles/shell.css :: .cv-options-edge, .cv-opt-group, .cv-opt-more, .cv-opt-pop, .cv-opt-select, .cv-readout, .cv-face-list, .cv-face-row, .cv-face-head, .cv-opt-color, .cv-opt input[type=range]
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

The options bar's scroll-edge buttons, overflow popover (.cv-opt-pop, on the menu layer, with its More button), per-group visibility, select and range controls, the font-face list, and the colour swatch input belong to tool options. F2 keeps only .cv-options, .cv-opt, .cv-opt-title and .cv-opt-sep. The "bar ends at the open column's edge" margin rule (panels.css) went with the properties column.

### src/styles/shell.css · left out: Home and files browser

- refers-to: frontend/src/styles/shell.css :: .cv-home*, .cv-hf*, .cv-drop, .cv-zoom note
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

.cv-home* (lines 109 to 169) and .cv-hf* (171 to 221) and .cv-drop are Home CSS; F3 ports them into a Home sheet. The Home root sits at calc(var(--z-menu) - 1) so menus and the jobs list still open above it, and with the terminal dock open its bottom becomes calc(var(--cv-status-h) + var(--ft-dock-h)) (formvis terminal.css line 8), which F5 must reproduce. Also left out: .cv-comfy-dot and the comfy graph rules, .cv-ref-*, .cv-clone-*, the reference viewer and the Comfy frame (image-editor integrations).

### src/styles/shell.css · left out: miscellaneous

- refers-to: frontend/src/styles/shell.css :: .cv-seg, .cv-st-par, .cv-tool svg, :root --cv-props-w
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

.cv-st-par (pixel aspect) has no rule in formvis either. --cv-props-w and --cv-props-open-w are not defined. The mobile rule that hid [data-cmd="zoom-out"], zoom-in and fit in .cv-st-tools is kept in case the status bar keeps those buttons.

### src/styles/dialogs.css · scrim and dialog frame

- refers-to: frontend/src/styles/dialogs.css :: .cv-scrim, .cv-dialog, .cv-dialog-head, .cv-dialog-title, .cv-dialog-body, .cv-dialog-foot
- kind: rationale
- logged: v0.2.0 · 2026-10-30

A dialog is at least its set width (--cv-dialog-w, default 440px) and grows to keep its button row on one line (formvis 1.86.0); only a window too narrow for the row wraps it. The head and body are size-contained so long text never widens the frame, only the buttons do. The scrim is the app blurred behind a rounded card with a hairline border (Phase 21, UI_SPEC.md sections 4 and 7): the one primary action is white (--cta-bg), the others dark and bordered; the foot has no top border. Replaced content (canvas, img) never outgrows the body (zero specificity, so a dialog's own sizing still wins). Live mode (cv-scrim-through, cv-scrim-side): no backdrop, clicks pass through the scrim and only the dialog takes them, the dialog pushed right with 16px padding; cv-scrim-hosted hides a scrim whose dialog is hosted elsewhere. The formvis sheet had the base layer (bg-secondary, radius-lg, shadow-window, 14px title) and then a Phase 21 layer that overrode it; here only the final values are kept: surface-2, --line-3, --radius-2xl, --shadow-dialog and a 16px title. The preferences title is 16px too, as formvis's cascade resolved it (the settings map says 14px, which was the pre-Phase 21 value).

### src/styles/dialogs.css · rows and controls

- refers-to: frontend/src/styles/dialogs.css :: .cv-field, .cv-dialog-row, .cv-row-actions, .cv-input, .cv-note, .cv-note-head, .cv-num, .cv-slider*, .cv-numpop*, .cv-check, .cv-toggle*, .cv-color
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Rows built as label.cv-dialog-row with a span and controls had no rule in formvis at first and fell back to inline flow; they line up with .cv-field now, the controls sharing the second column. .cv-field is a 124px label column and a control column. .cv-slider is a range plus a number box (72px); the label can be a scrub handle (.cv-scrub, drag to change). .cv-numpop is the pop-up slider of number fields (ui/number-fields.ts) on the context layer. .cv-toggle is a 36 by 20 switch: the checkbox is invisible on top and the track and knob follow :checked. .cv-num is the options-bar number box in formvis shell.css (56px by --ctl-sm); it moved here so the slider and the number fields share it. .cv-input and .cv-note moved from the same place to the dialog sheet; shell.css carries no input rule.

### src/styles/dialogs.css · Preferences

- refers-to: frontend/src/styles/dialogs.css :: .cv-prefs-dlg, .cv-prefs*, .nm-theme-grid, .nm-theme-swatch
- kind: rationale
- logged: v0.2.0 · 2026-10-30

Preferences: a rail of section tabs on the left of the dialog (absolute, outside the frame; the 240px left margin of the frame leaves room for it), cards in one scrolling column on the right. The rail tab does not switch pages: it scrolls the pane to the card. The pane (.cv-prefs-pages) is the only scroller and keeps scrollbar-gutter: stable; scrollbars are hidden app-wide by scrollbars.css. The current card has an accent ring (55 percent). A card folds by its head; fold state is not persisted. The connector line is an SVG (.cv-prefs-wire, a shade path and a line path, drawn by drawWire) from the active tab's right edge along a trunk to a round port on the dialog's left edge at the header divider; its box is 1 by 1 pixel with overflow: visible and no pointer events, on --z-base; the shade is 6px of --shadow-ink at 45 percent offset 3px down, the line is 2px of --text-muted, the port a 14px ring with a 6px dot. The rail collapses to 76px with 44 by 44 icon-only tabs (is-rail-collapsed), and the fold button's icon rotates 180 degrees. Controls in the dialog are 30px high with the dialog's own range slider (2px track filled to --pct, thumb 10 by 18px, focus ring as a 3px box-shadow of --accent-color-dim). Theme swatches are 32 by 32 in the dialog and 28 by 28 elsewhere; .is-fav shows an accent dot at a corner. .cv-prefs-tab and .cv-prefs-page are the older page-switching selectors, kept because the maps list them.

### src/styles/dialogs.css · left out

- refers-to: frontend/src/styles/dialogs.css :: .cv-newdoc*, .cv-savechanges, .cv-preset-row, .cv-note-text, .cv-api-key-paste, .cv-matrix, .cv-meta-pairs, .cv-scrim-brushset, .cv-scrim-lstyle, .cv-scrim-tpreset, .cv-scrim-size, .cv-cstyle-opts, .cv-export-preview, .cv-liquify-*, .cv-grad-*, .cv-mask-canvas, .cv-fill-*, .cv-histo, .cv-curves, .cv-shape-*, .cv-anchor-grid, .cv-stops, .cv-stop-*, .cv-run-bar, .cv-comfy-report, .cv-about-notices, .cv-list, .cv-notices-list, .cv-notice-*, .cv-keys-row, .cv-size-checks, .cv-dialog-note
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Everything in formvis dialogs.css (lines 253 to 491 and the image-specific rows) that belongs to a specific image dialog: New Document, Save Changes, presets, export preview, Liquify, gradients, histogram and curves, shape curves, anchor grids, stops, the run bar, the matrix editor and the key list (.cv-keys-row, to return with the shortcuts dialog), the notices list (.cv-notices-list, .cv-notice-*, to return with the notices dialog) and the About notices disclosure. Each arrives with the dialog that needs it. .cv-list (a bare list box) and .cv-list-empty were also not carried: the palette needs only .cv-list-row and .cv-list-meta, which are in shell.css. The old .cv-dialog input checkbox and radio accent rule is kept.

## src/ui leaf modules

### src/ui/icons.ts · ICONS

- refers-to: frontend/src/ui/icons.ts :: ICONS
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Dropped every image-only icon from formvis: cursor, moveSel, marquee and all selection tools, brushes and retouch tools (t* family), pen and shape tools, align and distribute edges, layer and mask icons (layers, mask, clipMask, invertLayer, merge), colour and level icons (levels, histogram, invert, gradient, bucket), lights (light*, relight), view and canvas icons (zoomIn, zoomOut, fitView, pan, hand, canvasGrid, quickMask, screenMode, artboard), transform icons (rotate, flipH, flipV, transform, crop), pfCamera, pfTransparency, pfGuides, pfCursor, pfType, pfUnits, pfGestures, pfScratch, pfPlace, pfLog, pfHistory, and the gen* family (genNodes, genKey, genReplace, genPlug, generate, fill, upscale, removeBg, feather, expandCanvas; send kept). The generate family was dropped because the workbench has no image generation.

### src/ui/icons.ts · icon

- refers-to: frontend/src/ui/icons.ts :: icon
- kind: explainer
- logged: v0.2.0 · 2026-10-30

icon(name, size) wraps the SVG in span.icon with an inline width and height; an unknown name falls back to info. The stroke icons share the S attribute string (viewBox 0 0 24 24, stroke 1.6, round caps) so new 24-unit icons match. The menu icon was changed from formvis's vertical dots to a three-line hamburger; dots keeps the vertical dots.

### src/ui/icons.ts · slot

- refers-to: frontend/src/ui/icons.ts :: slot
- kind: rationale
- logged: v0.2.0 · 2026-10-30

New workbench icons: code, branch, diff, terminalTab, session, slot, play (kept from formvis), bug, file, shell, status, dialog, gitNeutral. slot is a stack of three rounded bars (the formslot mark idea); brand.ts draws the same bars. The three-star sparkle icon is banned app-wide and was not added under any name; formvis names that carried it (generate and the gen* family) were dropped with the rest.

### src/ui/themes.ts · THEMES

- refers-to: frontend/src/ui/themes.ts :: THEMES
- kind: warning-context
- logged: v0.2.0 · 2026-10-30

Profile objects are kept byte-identical to formvis (which keeps them byte-identical to NodeMode) so the family renders the same surfaces for the same id. STORAGE_KEY 'nodemode_ui_settings' is shared across the family on purpose; do not prefix it. Boot order that guarantees zero theme flash: an inline script in index.html applies the persisted profile and accent before body paints, then this module re-applies the same values once the bundle loads (idempotent) and owns later changes. Never call applyTheme() from a component's first render, that is a second paint.

### src/ui/themes.ts · applyTheme

- refers-to: frontend/src/ui/themes.ts :: applyTheme
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Applies profile vars first, then the derived --bg-node and --shadow-lg that profiles do not declare, then the accent and its dim, hover, tint variants. Writing an unchanged custom property does not repaint anything that did not change. APPEARANCE generation 3: a choice saved before Studio Dark lacks it and is set aside once; a generation 2 choice keeps its theme and any deliberate accent, the old lavender default (OLD_DEFAULT_ACCENT) becoming orange. index.html's boot script must agree with this.

### src/ui/themes.ts · readChoice

- refers-to: frontend/src/ui/themes.ts :: readChoice
- kind: rationale
- logged: v0.2.0 · 2026-10-30

A saved choice with a known theme id is honoured even without the appearance marker. The theme-boot script in index.html applies any known theme from 'nodemode_ui_settings' before first paint and never looks at the marker, so a choice written by the boot path or by a family app that does not stamp the marker was painted light by the boot script and then flipped to Studio Dark at reveal when this module set it aside. Found by the throttled paint check (frame 1 light, reveal frame dark); with this line both agree and the reveal is a single paint.

### src/ui/themes.ts · registerSkins

- refers-to: frontend/src/ui/themes.ts :: registerSkins
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Removed the formvis user-skin machinery: registerSkins, UserSkin, USER_SKIN_KEY ('formvis_user_skin'), cacheUserSkin, skinCssProblem, applySkinCss (the fv-skin-css style element), the ThemeProfile.css field, and the ?no-skin escape (skinEscape, skinEscaped). Skins load from the data folder's skins folder in formvis, which subform does not have. If skins return, port them with the engine lint and a subform storage key; the pre-paint script would also need to read the cached skin colours. setTheme, setIntensity and setAccent lost their skinEscape = false line with it.

### src/ui/themes.ts · themeSwatchesHtml

- refers-to: frontend/src/ui/themes.ts :: themeSwatchesHtml
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Returns swatch markup in the app's .nm-theme-swatch recipe: background is the profile's --bg-secondary, the active swatch borders in the accent, every other swatch in its own --border-color. It returns a string for a detached template; a picker must patch classes on the built swatches, not re-set this on a live container.

### src/ui/prefs.ts · Prefs

- refers-to: frontend/src/ui/prefs.ts :: Prefs
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Re-authored small. formvis prefs.ts (571 lines) imported about 20 engine, gpu, io and extension modules (Engine, previewMode, gpuDabPrefs, renderCache, tiled, band-pool, composite-bands, frame-trace, api, colour-lut, smart-object-ops, transform, text, engine/types, io/disk, extensions/tools/slice, io/raw-sharpen, gpu/probe, colour-settings). Removed with them: applyPrefs(engine, prefs), openResolution, resendScratch and setScratchFolder, keepDisplayServer, keepGraphicsBackend, PagePrefs and PAGE_DEFAULTS, and every image-editing field: history states and memory, caches, region redraws, GPU and renderer, worker threads, engine device, tool options (toolOptions, cleanToolOptions; ToolOptionValue is kept as a type only), snapshots, cursors, checkerboard, rulers, guides, grid, slices, gamut, colour settings and presets, profile mismatch, raw defaults, pressure curve, fonts and type, measurement points, spell words, toolbar layout, place and transform options, zoom wheel, scratch folder, comfyui and nodemode URLs, agentsAllowed, restoreSession, display server and graphics backend, interpolation. Also removed the constants tied to them (GRAPHICS_BACKENDS, DISPLAY_SERVERS, CANVAS_BORDERS, PRESSURE_*, INTERPOLATIONS, LINE_*, CHECKER_*, RULER_UNITS, GRID_UNITS, gridUnitPx, ENGINE_CHOICES, MEASURE_POINTS, RAW_WB_CHOICES, FONT_PREVIEWS). Added workbench fields: editorFontSize, editorTabSize, editorWordWrap, terminalFontSize, agentDefaultModel, formslotEnabled, formslotAutoStart, gitSignOnCommit, recoveryMinutes. recoveryMinutes replaces formvis recoverySeconds (the workbench keeps unsaved editor buffers, minutes are the useful unit; default 1, range 1 to 60).

### src/ui/prefs.ts · loadPrefs

- refers-to: frontend/src/ui/prefs.ts :: loadPrefs
- kind: rationale
- logged: v0.2.0 · 2026-10-30

Every field is validated and clamped on load (num, flag, plain, strings helpers); an unreadable blob returns defaults with language 'en'. Language falls back to systemLang() only when the saved value is not a known code, so the first launch picks the system language. Rebound keys (shortcuts) are validated by cleanBindings: command id to up to 8 strings of at most 40 characters. showTooltips keeps the formvis name. Storage key is 'subform.prefs'; formvis's 'formvis.prefs' is not read, so no formvis preference migrates.

### src/ui/prefs.ts · systemLang

- refers-to: frontend/src/ui/prefs.ts :: systemLang
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

The formvis LANG_ALIASES table (zh-hant, zh-hk, zh-mo to zh-TW, zh to zh-CN, pt to pt-BR, no and nn to nb, sr to sr-Latn, es-419 and es-us to es-MX) is emptied because only English exists this phase. Restore it when the language tables return.

### src/ui/prefs.ts · applyUiFontSize

- refers-to: frontend/src/ui/prefs.ts :: applyUiFontSize
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Scales the font-size tokens --fs-9 to --fs-18 to the chosen size, and also scales the stylesheet rules that still write a literal pixel font size, from one generated style element (data-role ui-font-scale) that follows them, rebuilt only when the factor changes (the sheet itself is left out of the walk). Cross-origin sheets that cannot be read are skipped. A change after the first call fires nm:ui-settings-changed with key fontSize. Prefer --fs-* tokens in new CSS so this walk has little to do.

### src/ui/prefs.ts · setUiScale

- refers-to: frontend/src/ui/prefs.ts :: setUiScale
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Interface scale is the whole window zoomed (CSS zoom on the root in a browser, the web view's own zoom in the desktop app), kept under 'subform.uiZoom' and announced with the window event 'subform:ui-zoom' (formvis used 'formvis.uiZoom' and 'formvis:ui-zoom'). autoUiScale: a display the system already scales (devicePixelRatio above 1, divided by the shell zoom from setShellZoom) stays at 100%; one reported at 1 that is 3000 pixels wide or more gets 150%, from 3800 pixels 200%.

### src/ui/prefs.ts · followSystemTheme

- refers-to: frontend/src/ui/prefs.ts :: followSystemTheme
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Was a private helper called from applyPrefs(engine, prefs). It is now exported and the shell calls it after loading or changing prefs. With themeAuto on, it sets the light or dark theme of the pair now and again whenever the system appearance changes.

### src/ui/prefs.ts · updateAtStart

- refers-to: frontend/src/ui/prefs.ts :: updateAtStart
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Whether the desktop app looks for a new version at start (on unless turned off), key 'subform.updateAtStart' ('0' or '1').

### src/ui/prefs.ts · recalled

- refers-to: frontend/src/ui/prefs.ts :: recalled
- kind: explainer
- logged: v0.2.0 · 2026-10-30

recalled and remembered read and write one value a dialog keeps under a name inside Prefs.dialogValues; nothing is written when the value is already what is kept. Dialog.remember() uses the same store, keyed by the dialog's English title and the control label.

### src/ui/i18n.ts · t

- refers-to: frontend/src/ui/i18n.ts :: t
- kind: explainer
- logged: v0.2.0 · 2026-10-30

English is the source text and the identity: t(english) returns its input while the current language is 'en'. For other languages a trailing "..." or ":" is set aside before the lookup and put back after, so "Save As..." and "Save As" share one entry and "Size:" shares "Size". Lookup order: own table, parent table (LANG_PARENT), English.

### src/ui/i18n.ts · tn

- refers-to: frontend/src/ui/i18n.ts :: tn
- kind: explainer
- logged: v0.2.0 · 2026-10-30

tn(n, one, other) picks the plural form by Intl.PluralRules; a table may hold a form per category under the English other plus "#" and the category ("{n} records#few"); a missing category falls back to the translation of other, then to the English forms. The number is written in the language's own digits and grouping.

### src/ui/i18n.ts · LOADERS

- refers-to: frontend/src/ui/i18n.ts :: LOADERS
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Removed the 29 language loaders and the MORE and EXTRA part tables (formvis split each language into part a, part b "filters, adjustments, dialog fields, tooltips" and part c "strings the app assembles at run time"; the first part wins where parts share a key) plus all imports of ./i18n/*.ts tables. LOADERS is now an empty Record of loaders. To add a language later: add its code to LANG_CODES and LANG_NAMES in i18n/langs.ts, add a loader here, and merge parts as formvis did. Regional variants (es-MX, fr-CA) keep only the words that differ and name a parent in LANG_PARENT. RTL languages go in RTL_LANGS (the window takes dir="rtl").

### src/ui/i18n.ts · startPageTranslator

- refers-to: frontend/src/ui/i18n.ts :: startPageTranslator
- kind: rationale
- logged: v0.2.0 · 2026-10-30

Interface text not set through t() (panel bodies, dialog notes, buttons built once, tooltips) is translated where it lands, by exact match on the English, from a MutationObserver whose callbacks run before paint, so English is never shown first. Each touched text node or attribute keeps its English, so a later language change puts the right text back. Text the person owns is never touched: inputs, text areas, editable text, canvas, and anything inside [data-no-i18n]. Attributes follow a narrower rule: a field's placeholder, title and aria-label are interface text even though its value is the person's. In English the observer returns at once; switching back walks the page once. The SKIP selector lost formvis's layer, channel, path, style and timeline name classes and gained .cv-code-editor and .cv-terminal-body (editor and terminal contents are never translated).

### src/ui/i18n/langs.ts · LANG_CODES

- refers-to: frontend/src/ui/i18n/langs.ts :: LANG_CODES
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Reduced from 30 codes to ['en']. Removed: es, es-MX, pt-BR, fr, fr-CA, de, it, nl, da, fi, nb, sv, ru, pl, cs, hu, uk, tr, el, sr-Latn, zh-CN, zh-TW, ja, ko, id, th, vi, ar, hi with their native names in LANG_NAMES, RTL_LANGS = {ar} and LANG_PARENT = {es-MX: es, fr-CA: fr}. The shape is kept. This file has no imports so prefs and i18n can both read it.

### src/ui/dialogs.ts · Dialog

- refers-to: frontend/src/ui/dialogs.ts :: Dialog
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Modal shell: scrim, titled frame, body, footer button row. Keys: Escape closes, backdrop pointerdown closes, Tab moves between text and number fields only, Mod+Z and Shift+Mod+Z undo and redo settled field values (DialogHistory), Alt turns Cancel into Reset on the newest open dialog, arrow keys move between footer buttons. Focus returns to where it came from on close; focus left inside a hidden dialog used to keep shortcuts from reaching the app until the browser moved it a frame later (formvis 1.53.6: a rebound key did nothing after Keyboard Shortcuts closed), so close() blurs it first. Dialogs are built once, often before a language change, so each open() relabels title, Close tooltip, footer buttons (data-en and data-shown) and body labels in .cv-field and .cv-dialog-row. A button whose text its owner replaced is left alone. The title bar drags the dialog; offsets from centre are kept per English title under 'subform.dialogSpots' so the next opening finds it where it was left. The frame offset is applied as the CSS translate property.

### src/ui/dialogs.ts · remember

- refers-to: frontend/src/ui/dialogs.ts :: Dialog.remember
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Call once the controls are built: every slider, number, checkbox, colour and select in the body (not text fields, which hold names and prompts) is put back to its last value when the app has finished building and again each open, firing the controls' own handlers, and kept in Prefs.dialogValues as it changes. skip lists controls that show live state and must not be put back. extra carries a value no form control holds: read returns it, write takes it back, onChange hands over what the dialog calls when it moves. Keyed by the dialog's English title and the control label (aria-label, the span's data-en, or text), kind prefix, and a count for repeats.

### src/ui/dialogs.ts · live mode classes

- refers-to: frontend/src/ui/dialogs.ts :: Dialog
- kind: todo
- logged: v0.2.0 · 2026-10-30

formvis dialogs.ts sets no live mode classes itself (its scrim and frame carry only cv-scrim, cv-dialog and the added cv-savechanges); dialogs.css carries cv-scrim-through, cv-scrim-side and cv-scrim-hosted. A dialog that needs live mode adds the class on dialog.scrim at the call site.

### src/ui/dialogs.ts · confirmAction

- refers-to: frontend/src/ui/dialogs.ts :: confirmAction
- kind: explainer
- logged: v0.2.0 · 2026-10-30

confirmAction, promptName and askSaveChanges(All) fall back to window.confirm and prompt when #overlay-root is missing or building the dialog throws, so the question is never lost. A destructive confirm opens with Cancel focused so Return alone never confirms it. Unsaved Changes (Phase 21, UI_SPEC section 7): the question names the file in bold, a line says what is lost, Don't Save sits apart at the left, Cancel and Save (primary) at the right; closing it any other way is Cancel, so nothing is discarded by accident. The wording changed from "document" to "file" in the window.confirm fallback. SaveChoice is a new exported type for the { choice, all } answer.

### src/ui/dialog-history.ts · DialogHistory

- refers-to: frontend/src/ui/dialog-history.ts :: DialogHistory
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Per-dialog field behaviour, once for every dialog: undo and redo of settled values (a run of changes to one control within half a second is one step, up to 100 steps, with controls that moved as a result linked to the step), Tab and Shift+Tab through the text and number fields only (past the first or last field focus leaves by the normal order so buttons and checkboxes stay reachable), and Alt+Cancel as Reset to the values at open. Undo defers to the field's own typing history while the focused field holds typing still to undo. The Cancel button is found by data-en="Cancel", so the footer must be built with Dialog.button.

### src/ui/toast.ts · toast

- refers-to: frontend/src/ui/toast.ts :: toast
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Nothing floats over the work: a notice sits at the bottom, lets every click through, and clears away (opacity only, nothing moves, class is-away) from a pointer that is over the central work area within 24px of it. The central area is found with .cv-stage (formvis class, kept so the styles match); app.ts gives the centre region that class. The same text already showing is kept in place and its timer re-armed rather than stacked a second time, which would push the others up the screen. Max 4 notices. Default time: noticeSeconds pref, else 3.6s info and 6s error, 10s with actions. History keeps the last 100, repeats counted.

### src/ui/dropdown.ts · enhanceSelect

- refers-to: frontend/src/ui/dropdown.ts :: enhanceSelect
- kind: rationale
- logged: v0.2.0 · 2026-10-30

A native select shown as the glass menu: a button with the chosen label and a chevron, a rounded list with optional search, optgroups as small headings, a tick on the chosen item, arrows, Enter and Esc. The select stays underneath and stays the truth: a choice sets its value and fires change, so owning code is unchanged; values and disabled set in code show on the button (the value and disabled accessors are wrapped; options replaced in code are watched with a MutationObserver). The select's own classes size the button. onHover hears the value under the pointer or arrow keys as a live preview, null when the menu closes. Changed from formvis: fill() used to clear the list and rebuild it (list.textContent = ''), including on every search keystroke. It now patches keyed rows in place with patchList (keys g:label and o:value), updating text, is-chosen and aria-selected, so a visible list never flashes. Group labels are set as text, not interpolated into markup.

### src/ui/dropdown.ts · enhanceAllSelects

- refers-to: frontend/src/ui/dropdown.ts :: enhanceAllSelects
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Every select in the app shown as the glass list (native menus cannot be glass, the system draws them): those present now and any added later. Opt out with data-native; multiple and list-box (size) selects are left alone. Only needed when the select is not built through selectRow with onHover.

### src/ui/number-fields.ts · installNumberFields

- refers-to: frontend/src/ui/number-fields.ts :: installNumberFields
- kind: rationale
- logged: v0.2.0 · 2026-10-30

Every number field in the window, built or not yet built: typed arithmetic (100+20, 50%*2), a draggable label and unit, and a pop-up slider. One set of delegated listeners on the document, installed once (guard window.__numFieldsInstalled); no field is rebuilt. While focused a field is a text box (a number input refuses operators); on leaving it is a number input again and the owner's handlers hear one ordinary value. Native input and change events from a box in text mode are swallowed and the settled value is fired as a synthetic event (flag __numfield). In a dialog the focus stays inside the frame so Mod+Z, Tab and Escape still reach it. Dragging a field's label or unit moves its value: Shift ten times faster, Alt ten times finer. Changed from formvis: the pop-up slider node is made with el() instead of innerHTML on a created div.

### src/ui/number-fields.ts · evalExpr

- refers-to: frontend/src/ui/number-fields.ts :: evalExpr
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Evaluates + - * / ( ) with unary signs and a trailing % (a percentage of pct). Accepts x, the multiplication sign and the division sign as operators, and a comma as decimal point. Returns null when the text is not arithmetic. A % is a hundredth of 100 in a field that is itself a percentage (label or aria-label contains %), else a hundredth of the value the field held.

### src/ui/modifier-keys.ts · ModifierKeysPanel

- refers-to: frontend/src/ui/modifier-keys.ts :: ModifierKeysPanel
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Not ported. number-fields does not import it; it holds sticky Shift, Alt and Ctrl for pen and touch users on canvas gestures (stickyModifiers, ModifierKeysPanel), which the workbench has none of. Port from formvis ui/modifier-keys.ts if a touch story arrives.

### src/ui/brand.ts · brandMark

- refers-to: frontend/src/ui/brand.ts :: brandMark
- kind: rationale
- logged: v0.2.0 · 2026-10-30

formvis's brandMark returned its gradient app mark with per-copy id namespacing (counter copies, placeholders for clip paths and gradients) so two marks on screen never shared ids. subform's mark is three rounded currentColor bars (the slot icon idea, with fading opacity), no ids, so no namespacing is needed and it takes the colour of its container. brandMark(size, label) keeps the formvis signature; brandWordmark(size) adds the text "subform" for the tab row (classes cv-wordmark and cv-wordmark-text). No image is used. The desktop icon is separate art.

### src/ui/panels/controls.ts · matrixRow

- refers-to: frontend/src/ui/panels/controls.ts :: matrixRow
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Removed matrixRow (a size by size grid of integer inputs for convolution kernels) and curveRow (an SVG curve box with draggable points built on curveValue from engine/filters-lib/distort) because both are image-filter controls, and the Engine import (clamp from ../../engine) is replaced by a local clamp. Remaining: sliderRow, selectRow, checkRow, toggleRow, toggleOf, colorRow, numberRow, fmt, Row.

### src/ui/panels/controls.ts · sliderRow

- refers-to: frontend/src/ui/panels/controls.ts :: sliderRow
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Logarithmic option: the track runs 0 to 1000 and a position maps to min * (max / min) ^ (position / 1000), so small values get room; requires min above 0. A horizontal drag on the label moves the value across the slider's span in about 250 px (Shift ten times faster, Alt ten times finer); double-click on the label or track resets to limits.def. Each control is named for assistive technology (aria-label). selectRow now escapes option values and labels before they enter the template.

## src/ui shell modules and src/app.ts

### src/ui/commands.ts · Commands

- refers-to: frontend/src/ui/commands.ts :: Commands
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Ported from formvis. onRun is called after each command with its label as it read before running, so a recorder can name it. onChange fires after commands are added or removed. setKeys rebinds a command and takes each key from whichever command had it (used by a later Keyboard Shortcuts dialog). gate is what the document allows before a command's own test. blocked returns the reason a command is off for a cause outside the document; app.ts uses it to give disabled-until-later commands the tooltip "Not available yet". call waits for a background command and returns its result. The catalogue fields group, description, when, params, mutates, risky are kept for the later agent command catalogue; risky means Undo cannot reverse it.

### src/ui/commands.ts · formatKeys

- refers-to: frontend/src/ui/commands.ts :: formatKeys
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Glyphs for the Apple menu style. A combo ending in ++ means the plus key itself. comboOf gives the text a key event stands for in the form saved bindings use, for example Alt+Shift+Mod+S; Mod is Cmd on macOS and Ctrl elsewhere.

### src/ui/commands.ts · comboOf

- refers-to: frontend/src/ui/commands.ts :: comboOf
- kind: rationale
- logged: v0.2.0 · 2026-10-30

Comma and Period were added to CODE_KEYS so Mod+, (Preferences) has a name.

### src/ui/menu.ts · MENU_KEEP

- refers-to: frontend/src/ui/menu.ts :: MENU_KEEP
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Commands that stay in the menus whatever the person hides under Edit > Menus, so the way back is never lost. setMenuStyle(hidden, colors) sets the hidden command ids and the colour name each item is drawn in. trimMenu drops hidden commands, a submenu left empty, and any leading, trailing or doubled separator.

### src/ui/menu.ts · PopupMenu

- refers-to: frontend/src/ui/menu.ts :: PopupMenu
- kind: warning-context
- logged: v0.2.0 · 2026-10-30

A scrolled menu moves its rows, so a submenu opened beside one would no longer line up: the scroll handler closes the submenu. A standalone menu closes on a press anywhere outside it; the menubar's menus are closed by the menubar, which owns their buttons. openAt opens below and right of the pointer when it fits, otherwise above or to the left, so the pointer sits at a corner and never over an item (clamping alone could put a submenu under it, opening it). relabel re-labels rows in place after a language change; no node is rebuilt.

### src/ui/menu.ts · MenuBar

- refers-to: frontend/src/ui/menu.ts :: MenuBar
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Keyboard: F10, or Alt with a menu's first letter, opens a menu; Alt pressed and released alone puts focus on the first menu; Alt held underlines first letters (class is-menu-mnemonics on html, not on macOS). Arrows move through a menu and across the bar, Enter runs a row, Escape steps back, letters jump to the next row that starts with them.

### src/ui/native-menu.ts · NativeMenus

- refers-to: frontend/src/ui/native-menu.ts :: NativeMenus
- kind: explainer
- logged: v0.2.0 · 2026-10-30

The menus in the macOS menu bar when running as the desktop app. Built from the same MenuDef list and command registry as the in-window MenuBar, so the two never differ. An application menu comes first as macOS expects (About, Preferences, Hide, Quit). Only on macOS: there the menu bar owns the shortcuts so a key never runs twice. A shortcut Tauri cannot express is left off its item rather than failing the menu. Builds that overlap are folded into one more build. State refresh is a 150 ms grouped pass so a burst of changes is one pass.

### src/ui/native-menu.ts · TEXT_EDITS

- refers-to: frontend/src/ui/native-menu.ts :: TEXT_EDITS
- kind: warning-context
- logged: v0.2.0 · 2026-10-30

The Edit commands whose keys a focused text field needs for itself: while one has focus the menu sends the standard edit action to it through the shell's text_edit command, so Cmd+V pastes into the field. Without this the menu's Edit accelerators swallow Cmd+Z, X, C, V and A before the field can use them (formvis 1.96.2).

### src/ui/native-menu.ts · MENUS_IN_WINDOW_KEY

- refers-to: frontend/src/ui/native-menu.ts :: MENUS_IN_WINDOW_KEY
- kind: explainer
- logged: v0.2.0 · 2026-10-30

The person's choice to keep the menus in the window on macOS (View > Menus in Window); it applies at the next start.

### src/ui/command-palette.ts · fuzzyScore

- refers-to: frontend/src/ui/command-palette.ts :: fuzzyScore
- kind: explainer
- logged: v0.2.0 · 2026-10-30

How well query names text (case ignored), or null when its letters are not all in text in order. The best placing wins: each letter scores 1, 7 more when it directly follows the one before, 5 more at the start of a word (after a space or a mark, or a capital after a small letter), a little less the further in it lies; an eighth of the text's length is taken off so shorter names rank first.

### src/ui/command-palette.ts · CommandPalette

- refers-to: frontend/src/ui/command-palette.ts :: CommandPalette
- kind: rationale
- logged: v0.2.0 · 2026-10-30

Every command with its place in the menus and its keys, ranked by fuzzyScore as the query is typed (on its name, or 10 behind on name and menu path together). The twelve best are listed; Up and Down choose, Enter or a click runs one (a disabled one shows dimmed and does not run), Escape closes. With no query what was last run from here comes first. The rows are twelve slots patched in place, so typing moves neither the dialog nor a row.

### src/ui/command-palette.ts · tool search

- refers-to: frontend/src/ui/command-palette.ts :: CommandPalette
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Removed: the Engine constructor parameter, the toolList() loop that added every image tool and tool variant as palette rows, the recent-heading command skip, and the tool: keys. subform has no tools; only commands are searched.

### src/ui/caption-buttons.ts · CaptionButtons

- refers-to: frontend/src/ui/caption-buttons.ts :: CaptionButtons
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Windows and Linux in the desktop app can draw their own title bar: the system frame is taken off and the title bar carries Minimize, Maximize or Restore and Close at its right end, with a drag on its empty parts and a double click that maximizes. macOS keeps its frame and traffic lights. The buttons are built once; turning the option on or off shows or hides them and calls the window. Close goes through the window's close request, so unsaved documents are asked about first. On macOS the title bar is an overlay (src-tauri/src/main.rs), so the page's title row is the window's title row; its empty parts drag and zoom through Tauri's drag regions.

### src/ui/caption-buttons.ts · look

- refers-to: frontend/src/ui/caption-buttons.ts :: CaptionButtons
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Removed: b.innerHTML = icon(...) in look() and the box.innerHTML assignment in the constructor. The maximize button now holds both icons (.cv-cap-max, .cv-cap-restore) and look() toggles their hidden flags, so no node is rebuilt.

### src/ui/titlebar-tools.ts · TitleTools removed

- refers-to: frontend/src/ui/titlebar-tools.ts :: TitleTools
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Removed from the formvis version: WORKSPACES (six image panel arrangements), Workspace, RENAMED, custom workspaces (formvis.customWorkspaces), choose, addCustom, removeCustom, syncCustom, the dock-syncing syncDock, the Lock Workspace button with its lock and unlock icons and TitleToolsDeps (arrange, locked, setLocked, dock). The workspace select stays as a hidden empty select.cv-tt-select until the workspace switcher (F3). The Claude Code and terminal buttons now run the commands agent-new and terminal-toggle instead of calling a dock.

### src/ui/titlebar-tools.ts · TitleTools

- refers-to: frontend/src/ui/titlebar-tools.ts :: TitleTools
- kind: explainer
- logged: v0.2.0 · 2026-10-30

The title bar's right-hand tools: a theme toggle (sun and moon, studio and light); a search that finds and runs any enabled command by name with its shortcut shown (up to eight, patched by command id so typing does not rebuild rows); the Claude Code and terminal buttons, disabled while their command is.

### src/ui/tabs.ts · Tabs

- refers-to: frontend/src/ui/tabs.ts :: Tabs
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Removed from the formvis version: pinned documents (pinnedIds, togglePin, isPinned), drag reordering (dragTab), the context menu hook, busy progress under a tab, the colour-mode badge (cv-tab-mode) and its tooltips, the FLIP settle animation for tabs after an arriving or leaving one, tabName, and every Engine and Project dependency. Tabs now render OpenDoc rows from the workspace store.

### src/ui/tabs.ts · windowTitle

- refers-to: frontend/src/ui/tabs.ts :: Tabs
- kind: warning-context
- logged: v0.2.0 · 2026-10-30

The window title goes through the shell's set_window_title command, not Tauri's own setter, because that command places the macOS traffic lights again after AppKit lays the title bar out anew (src-tauri/src/traffic_lights.rs). The title is the document name with a bullet while unsaved, then the app name: "name - subform".

### src/ui/status.ts · StatusBar

- refers-to: frontend/src/ui/status.ts :: StatusBar
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Removed from the formvis version: the history and zoom tools group (cv-st-tools, undo, redo, zoom field, fit), document size and pixel aspect (cv-st-dims, cv-st-par), the cycling document info readout (cv-st-info, INFO_KEY, INFO_KINDS, docBytes), GPU (cv-st-gpu, setGpu), memory (cv-st-mem, syncMemory), proof badge (cv-st-proof, setProof), the tool hint with segment fitting (fitHint, getTool), setAgentNote, and the 16 engine calls. New slots: branch, workspace name, problems, formslot, sessions.

### src/ui/status.ts · SERVICE_NOTE

- refers-to: frontend/src/ui/status.ts :: SERVICE_NOTE
- kind: explainer
- logged: v0.2.0 · 2026-10-30

The one note when the engine service is not running: the status bar's engine slot title. The text was rewritten for subform's own features. The Engine slot shows "Engine version · desktop" or "Engine offline".

### src/ui/status.ts · flashError

- refers-to: frontend/src/ui/status.ts :: StatusBar
- kind: rationale
- logged: v0.2.0 · 2026-10-30

An error sits in the hint slot in the danger colour for six seconds, then the normal hint comes back; nothing blinks. The Working indicator is shown through pendingClass (delay 300 ms, minimum 250 ms) so quick jobs never flash; a click toggles the jobs list.

### src/ui/jobs-list.ts · JobsList

- refers-to: frontend/src/ui/jobs-list.ts :: JobsList
- kind: explainer
- logged: v0.2.0 · 2026-10-30

Every running background job as a row with name, bar, percent and a Stop of its own. Built once; a row is made when a job starts, patched in place as it steps (bar, percent and button only) and removed when it ends. Esc and a click outside close it. Rows are keyed by job id. The Stop button is hidden unless the job carries a cancel function.

### src/ui/jobs-list.ts · escape

- refers-to: frontend/src/ui/jobs-list.ts :: JobsList
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Removed: the engine jobs length condition on the Escape handler (formvis let Escape cancel a running job first when jobs were present), EngineJob, engine.cancelJob, the cancelled "Stopping" state.

### src/ui/workspace-store.ts · WorkspaceStore

- refers-to: frontend/src/ui/workspace-store.ts :: WorkspaceStore
- kind: rationale
- logged: v0.2.0 · 2026-10-30

Replaces formvis's image Engine for the shell: current workspace, open documents, active document, jobs, sessions summary and a typed on(event, fn) emitter. No engine logic; later phases feed it. A finished job lingers 8 seconds before it is removed so a list that is open can show it complete.

### src/app.ts · startApp

- refers-to: frontend/src/app.ts :: startApp
- kind: rationale
- logged: v0.2.0 · 2026-10-30

The shell is mounted once with mountOnce before the reveal and never rebuilt; text, classes and hidden flags are patched in place. The fonts race moved here from main.ts so the shell is built, then fonts are awaited (2500 ms cap), then revealApp.

### src/app.ts · soon

- refers-to: frontend/src/app.ts :: startApp
- kind: todo
- logged: v0.2.0 · 2026-10-30

Commands whose feature lands later are registered through soon(), which sets enabled to false and gives the command the tooltip "Not available yet" via commands.blocked. Each later phase replaces its soon(...) with the real command: open-folder, open-recent (F4), save, save-all, find, select-next, select-all-occurrences, go-to-file (editor phase), settings (F3), terminal-toggle, terminal-new, agent-new, agent-sessions (F5), git-status, git-commit (F6), run-task, run-stop, help, report-issue.

### src/app.ts · applyUiZoom

- refers-to: frontend/src/app.ts :: applyUiZoom
- kind: removed-code
- logged: v0.2.0 · 2026-10-30

Removed from the formvis version: the Tauri ui_zoom command path (web view zoom through the shell, setShellZoom, the shellZoomed promise chain) because subform's shell has no ui_zoom command yet; interface zoom is CSS zoom on the root. The watchRatio listener for Auto was also left out and is a todo for when Auto scale is exposed in Preferences. Also removed from the app wiring: right-to-left layout, pasteboard, favourite-theme command, checker colours, tooltips toggle, option memory, Stage and Dock preferences.

### src/app.ts · editAction

- refers-to: frontend/src/app.ts :: startApp
- kind: warning-context
- logged: v0.2.0 · 2026-10-30

Edit commands act on a text field. A menu click moves focus off the field before the command runs, so the last focused text field is remembered and refocused first. Keys for the six edit commands are left to the browser while a field has focus, and always to the native menu on macOS, so a key never runs twice.

## F2 integration

### index.html · stylesheet links

- refers-to: frontend/index.html :: link rel=stylesheet
- kind: explainer
- logged: v0.2.0 · 2026-10-30

The base.css link became six links in cascade order: fonts, tokens, shell, dialogs, light-mode, scrollbars. light-mode follows the component sheets so its overrides win; scrollbars is last so nothing brings a bar back. The critical inline style and theme-boot script are unchanged, so the first frame still paints the theme background before any sheet loads.

### src/main.ts · entry

- refers-to: frontend/src/main.ts :: startApp
- kind: explainer
- logged: v0.2.0 · 2026-10-30

main.ts is now only the entry: it calls startApp from app.ts. The F1 placeholder region, fonts wait and revealApp call moved into app.ts.

### src/io/api.ts · request and systemStatus

- refers-to: frontend/src/io/api.ts :: request, systemStatus
- kind: explainer
- logged: v0.2.0 · 2026-10-30

The engine client. request sends JSON with Accept and, for a body, Content-Type, to a same-origin path (the Vite /api proxy in dev); a non-2xx answer throws "status detail" using the engine's detail field when present, and 204 returns nothing. systemStatus reads GET /api/system/status (app, version, engine, data folder, git and claude probes); the status bar shows its version and shows "Engine offline" when it throws.

### src/styles/shell.css · status slots added at integration

- refers-to: frontend/src/styles/shell.css :: .cv-st-branch, .cv-st-branch-name, .cv-st-ws, .cv-st-problems, .cv-st-formslot, .cv-st-sessions, .is-attention, [hidden]
- kind: rationale
- logged: v0.2.0 · 2026-10-30

The shell agent's StatusBar added five slots that had no rules in the ported sheet. Each has a fixed flex basis with ellipsis so a branch name or a count changing never reflows the bar; .is-attention colours the sessions slot with the accent when a session waits on the person. The [hidden] rules keep a slot's own display from overriding the attribute. .cv-stage-empty is the plain stage text before Home lands; .cv-about-head and .cv-about-name lay out the About dialog's mark and name.

### src/styles/shell.css · .cv-tb-app width

- refers-to: frontend/src/styles/shell.css :: .cv-tb-app
- kind: rationale
- logged: v0.2.0 · 2026-10-30

max-width raised from 120px to 168px. formvis's app name is shorter; "subform 2026" was truncated with an ellipsis at the default window width in the F2 paint check, and shows whole at 168px. The hide rules for narrow windows are unchanged.

## F2 review fixes (v0.2.1)

### src/app.ts · key order in declared shortcuts

- refers-to: frontend/src/app.ts :: commands.add
- kind: warning-context
- logged: v0.2.1 · 2026-10-30

`comboOf` (ui/commands.ts) names a key event in the family's fixed order Alt, Shift, Mod, then the key, and bindings are matched by that exact text. Redo, Select All Occurrences, Command Palette, Run Task and New Claude Code Session were declared as `Mod+Shift+...`, so they could never match and Ctrl+Shift+P did nothing (fresh-context review). They are now `Shift+Mod+...`. Write every new shortcut in that order; `Alt+Mod+...` is already in order. `comboOf` was left as formvis has it so saved bindings stay compatible across the family.

### src/app.ts · usable last field

- refers-to: frontend/src/app.ts :: startApp
- kind: rationale
- logged: v0.2.1 · 2026-10-30

The remembered text field counts only while it is still laid out (`getClientRects` not empty). The palette and dialog inputs live in scrims that stay connected while hidden, so after one visit to the palette every Mod+A, C, V, X and Z outside a field was taken by the edit commands and then dropped, and the browser's own copy never ran.

### src/app.ts and src/ui/titlebar-tools.ts · light test

- refers-to: frontend/src/app.ts :: toggleTheme; frontend/src/ui/titlebar-tools.ts :: syncTheme
- kind: rationale
- logged: v0.2.1 · 2026-10-30

Light is the profile's `light` flag, not the id `light`, so Sand, Duck and the other light profiles show the sun state and toggle to Studio Dark. Checked under throttling with Sand saved: `aria-pressed` true.

### src/ui/dialogs.ts · trapTab

- refers-to: frontend/src/ui/dialogs.ts :: trapTab
- kind: rationale
- logged: v0.2.1 · 2026-10-30

A dialog is `aria-modal`, so Tab and Shift+Tab wrap inside its frame once DialogHistory has had its turn with the text and number fields; before, Tab left the dialog for the menu bar behind the scrim, where Enter would act. Only laid-out, enabled controls count; a dialog with none keeps focus where it is.

### src/styles/shell.css · busy slot keeps its space

- refers-to: frontend/src/styles/shell.css :: .cv-st-busy
- kind: rationale
- logged: v0.2.1 · 2026-10-30

The Working indicator went from display none to inline-flex at 296px, which reflowed every status slot when a job started. It now always takes its 296px and turns visible with `.is-shown` (hidden boxes take no pointer), so a job starting moves nothing.

### src/styles/shell.css · stage text hides

- refers-to: frontend/src/styles/shell.css :: .cv-stage-empty[hidden]
- kind: explainer
- logged: v0.2.1 · 2026-10-30

`.cv-stage-empty` sets `display: grid`, which beat the hidden attribute, so the "open a folder" text stayed over the stage once a workspace was set. Added to the shared `[hidden]` rule. The error hint also lost its literal fallback colour; `--danger` is always defined in tokens.css.

### carried from the review

- refers-to: frontend/src/ui/tabs.ts :: Tabs; frontend/src/app.ts :: startApp; frontend/src/ui/themes.ts :: THEMES
- kind: todo
- logged: v0.2.1 · 2026-10-30

Not changed in v0.2.1: document tabs have no roving tabindex or arrow keys (F3, with Home); `installNumberFields`, `enhanceAllSelects`, `startLanguage`, `startPageTranslator` and `followSystemTheme` are not called yet and are wired when Preferences lands (F3), before first paint; the theme tables in themes.ts and the boot script in index.html keep literal colours, the documented exception that makes the first frame right.

## F3 Home and Preferences (v0.4.0)

### src/ui/home.ts · Home

- refers-to: frontend/src/ui/home.ts :: Home
- kind: explainer
- logged: v0.4.0 · 2026-10-30

Ported from formvis ui/home.ts (HomeScreen, Apache-2.0, owner's) per FORMVIS_HOME_MENUBAR_TITLEBAR_STATUSBAR_MAP.md section A: one section.cv-home built once into .cv-stage, pages toggled by hidden, nav item is-active, greeting from getHours (before 12 morning, before 18 afternoon, else evening) written when Home becomes visible, Back shown only while a workspace is open. Pages Start, Recent, Workspaces, Sessions; Create items New Form app, Open folder, Clone repo, New agent session; foot Back, Preferences, Help. Home runs its own data-cmd buttons and stops the click so the root handler in app.ts does not run them twice; syncChrome still sets their disabled state and titles.

### src/ui/home.ts · visibility rule

- refers-to: frontend/src/ui/home.ts :: Home.sync
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Home is open while forced (brand, View > Home) or while no workspace is open; the store's workspace event clears forced, so opening a folder closes Home. There is no auto-show preference as formvis had. Esc is the app's home-back command, enabled only while Home is open and a workspace is open (the formvis "Esc leaves Home while a document is open" rule through the command registry).

### src/ui/home.ts · brand covered while Home is open

- refers-to: frontend/src/styles/home.css :: .cv-home
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

The map fixes Home at top var(--cv-titlebar-h), so it covers the tab row and the .cv-brand Home button: the pointer cannot reach the brand while Home is open; Tab to it and Enter, Back, Esc and View > Home all work. This matches formvis. Changing top to calc(var(--cv-titlebar-h) + var(--cv-tabs-h)) would expose the brand; nothing else depends on it.

### src/ui/home.ts · drop handling

- refers-to: frontend/src/ui/home.ts :: Home.wireDrop
- kind: rationale
- logged: v0.4.0 · 2026-10-30

A DOM drop gives files without a folder path, so the desktop window now lets Tauri handle drops (main.rs no longer calls disable_drag_drop_handler) and Home listens to tauri://drag-enter, drag-leave and drag-drop; the first path is opened while Home is open. The whole Home is the target because the payload position is in physical pixels and ignores the page zoom. Side effect: the desktop webview no longer receives DOM file drops; Home is the only drop target so far. In a browser a drop shows the toast that browsers do not reveal folder paths. Not run in a desktop build here.

### src/ui/home.ts · HomeSessions

- refers-to: frontend/src/ui/home.ts :: HomeSessions
- kind: todo
- logged: v0.4.0 · 2026-10-30

Placeholder for B07's sessions grid: groups needs input, working, done, each hidden when empty, shared empty state "No agent sessions yet". setSessions(list) patches cards by id and is the F5 hook. Idle, failed and stopped fold into done until F5 decides.

### src/ui/home-files.ts · HomeFiles

- refers-to: frontend/src/ui/home-files.ts :: HomeFiles
- kind: explainer
- logged: v0.4.0 · 2026-10-30

Ported from formvis ui/home-files.ts: thumbnails became rows of folder name, path, last opened and a Form-repo badge; filter, sort (Most recent, Name) and grid or list view kept (localStorage subform.home in try/catch); rows patched by path. Home fetches the recent list once and feeds every list. Workspaces lists entries marked formRepo plus the workspace open now. The item area has a min-height and the empty note sits over it, so rows arriving from the engine move nothing (layout shift 0 under 4x throttling).

### src/ui/open-folder.ts · openFolderPrompt

- refers-to: frontend/src/ui/open-folder.ts :: openFolderPrompt
- kind: explainer
- logged: v0.4.0 · 2026-10-30

Desktop: @tauri-apps/plugin-dialog open({ directory: true }) through a dynamic import, with dialog:allow-open added to the capability. Browser: promptName asks for an absolute path. openFolderAt opens through the engine and then sets the store's workspace, which closes Home; it rethrows so Home's rows and drops show their own toast.

### src/styles/home.css · rules

- refers-to: frontend/src/styles/home.css :: .cv-home
- kind: explainer
- logged: v0.4.0 · 2026-10-30

Ported from formvis shell.css (the .cv-home*, .cv-hf* and .cv-drop rules) onto tokens; fixed layout constants as in the map (232px nav, 1180px content). z-index calc(var(--z-menu) - 1). The dock-aware bottom rule formvis keeps in terminal.css lives here until terminal.css lands in F5.

### src/ui/settings.ts · SettingsDialog

- refers-to: frontend/src/ui/settings.ts :: SettingsDialog
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Ported from formvis app-dialogs.ts SettingsDialog per FORMVIS_SETTINGS_MAP.md: rail (fold key subform.prefsRailCollapsed), wire with trunk at 45 percent of the rail width and radius 10, port, scroll spy (edge 24, mute 700 ms), card fold, change and sync, section loop over General, Interface, Workspace, Editor, Terminal, Agents, Git and Identity, formslot, Language Servers, Keys, Updates. It wraps a Dialog because Dialog.open(focus) clashes with open(section?). Built once at start; rows are patched in sync(); the Keys list is patchList keyed by command id. The theme swatches come from a detached template once.

### src/ui/settings.ts · Reset and secrets

- refers-to: frontend/src/ui/settings.ts :: SettingsDialog
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

Reset removes only localStorage keys starting with subform. plus nodemode_ui_settings, then reloads. The API key field is a password input sent to PUT /api/secrets/anthropic-api-key and cleared; only presence is ever read back; it never reaches prefs or localStorage. With no system keyring the engine answers 503 and the row says so. Custom title bar and menus-in-window rows run the existing commands, which own their keys. Git author name and email are empty read-only fields until the git phase exposes an identity route.

### src/ui/prefs.ts · fields added in v0.4.0

- refers-to: frontend/src/ui/prefs.ts :: Prefs
- kind: todo
- logged: v0.4.0 · 2026-10-30

largeTabs (applied as body.large-tabs), reopenLastWorkspace and hiddenFolders (stored; nothing reads them yet), sidebarWidth (180 to 600, default 280, read by the workbench).

### src/app.ts · pre-paint wiring

- refers-to: frontend/src/app.ts :: startApp
- kind: explainer
- logged: v0.4.0 · 2026-10-30

startLanguage and followSystemTheme run before mountOnce; installNumberFields, enhanceAllSelects and startPageTranslator run just before revealApp, after every dialog and its selects exist. This closes the F2 review carry-over. Because every select is now shown as the glass list, the hidden title-bar workspace select carries data-native, or its empty button showed in the title bar (found in the F4 screenshot).

## F4 integration (v0.4.0)

### src/app.ts · editor and workbench wiring

- refers-to: frontend/src/app.ts :: startApp
- kind: rationale
- logged: v0.4.0 · 2026-10-30

The Workbench is mounted into .cv-stage before the reveal and the empty-stage note moves into its editor area. The EditorHost mounts on .cv-editor-host; its deps load and save through io/workspace.ts and report dirty state into the store. The Workbench's editor() adapter opens a file in the editor and then adds the tab (store.openDoc, id equals the workspace-relative path), so a file that cannot open never gets a tab. The store's active event shows that file in the editor; closing a tab closes its buffer; a rename or delete from the files tree closes buffers under the path. Save, Save All, Find, Add Next Occurrence and Select All Occurrences are real commands on the editor; CodeMirror handles Mod+S itself inside the editor and prevents the default, so the global handler never saves twice. Menu-clicked Undo and Redo still go through execCommand, which CodeMirror does not follow; keyboard Undo and Redo work. To fix with the editor command bridge.

### src/app.ts · review fixes (v0.4.1)

- refers-to: frontend/src/app.ts :: startApp; frontend/src/ui/open-folder.ts :: openFolderAt; frontend/src/ui/editor/editor.ts :: EditorHost.open
- kind: rationale
- logged: v0.4.1 · 2026-10-30

From the fresh-context review. Opening another folder asks first when any file has unsaved changes, then closes every open file of the previous folder (paths are workspace-relative, so a same-named file in the new folder used to show and save the old folder's text). `EditorHost.open` returns whether the file is now showing; a tab is added only then, so a binary or unreadable file leaves no phantom tab and a slow open that a newer one overtook does not take the tab back. A search hit in an already-open file now activates its tab (the shell's revealLine goes through the same open path). A rename or delete in the tree closes only files without unsaved changes; a changed one stays open with a notice. Quit asks when files are unsaved, and the page refuses to unload with unsaved files (this also guards Preferences Reset); the desktop close request still needs its own check (F5, with session restore). Esc in a text field no longer closes Home. Home's layer is the token --z-home-root (199, just under --z-menu), not arithmetic in home.css. Not changed: dismissing the save-conflict dialog chooses Reload (the user's text stays in undo history); mixed line endings are written back with the dominant one; reopenLastWorkspace, recoveryMinutes and hiddenFolders are stored but not read yet; two listings of one folder can arrive out of order.

### F4 exit check

- refers-to: frontend/src/app.ts :: startApp
- kind: explainer
- logged: v0.4.0 · 2026-10-30

With the real engine on a copy of formvis, under 4x CPU throttling: Home at start; Ctrl+O, path, Enter opened the workspace and closed Home; frontend, frontend/src and frontend/src/ui expanded; dom.ts opened, edited, saved with Ctrl+S (the text reached the disk); Shift+Ctrl+F revealApp gave 10 results in 6 files from ripgrep; a hit opened its file; layout shift 0 during all of it and after a reload; no page errors.

## vite.config.ts

### vite.config.ts · ports and proxy

- refers-to: frontend/vite.config.ts :: FRONTEND_PORT, BACKEND_PORT
- kind: rationale
- logged: v0.1.0 · 2026-10-30

Dev 5650 and preview 5651 with strictPort, so a port clash fails loudly instead of moving. host is false (localhost only), mandatory. /api is proxied to http://127.0.0.1:5655, overridable with SUBFORM_BACKEND_PORT (for example a closed port to run the browser build with no engine).

### vite.config.ts · plugin worker policy

- refers-to: frontend/vite.config.ts :: formvis-plugin-worker-policy
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

formvis served files named plugin-worker*.ts or .js with a closed Content-Security-Policy in dev (default-src none; script-src blob: and self; connect-src self and the dev websocket; worker-src, frame-src, img-src, style-src none), because the sealed folder-plugin worker gets a closed policy and the dev server must also serve the worker's imports from the same origin. Removed: no plugins in subform.

### vite.config.ts · isolation headers

- refers-to: frontend/vite.config.ts :: ISOLATION
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

formvis sent Cross-Origin-Opener-Policy same-origin and Cross-Origin-Embedder-Policy credentialless on dev and preview (cross origin isolation for SharedArrayBuffer; credentialless kept pictures and fonts from other sites loading), switchable off with FORMVIS_ISOLATED=0. Removed: nothing in F1 needs SharedArrayBuffer. Restore if a later feature does.

### vite.config.ts · fs allow and build limits

- refers-to: frontend/vite.config.ts :: server.fs, build
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

Removed server.fs.allow ['..'] (formvis let the dev server read its repository docs folder, one manual copy for the repository and the app) and build.chunkSizeWarningLimit 1200 (image engine bundles). Kept outDir dist, sourcemap true, target es2022.

## package.json

### package.json · dependencies

- refers-to: frontend/package.json :: dependencies
- kind: rationale
- logged: v0.1.0 · 2026-10-30

Runtime: @fontsource/inter 5.3.0, @fontsource/jetbrains-mono 5.3.0, @tauri-apps/api 2.12.4 (moved from formvis's 2.11.1 because `tauri dev` refuses a different minor from the tauri crate, 2.12.5). Dev: @tauri-apps/cli 2.12.4 (verified on npm), typescript 7.0.2, vite 8.3.5. No test runner and no test script by rule.

### package.json · removed dependencies

- refers-to: frontend/package.json :: dependencies
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

Removed from formvis: @xterm/addon-fit 0.11.0 and @xterm/xterm 6.0.0 (return with the terminal phase), ag-psd, fzstd, opentype.js, three, utif2 (image tools), @types/three, vitest 5.0.5 and the test script.

## boot_frontend and oc_install

### boot_frontend · scripts

- refers-to: frontend/boot_frontend :: file
- kind: explainer
- logged: v0.1.0 · 2026-10-30

boot_frontend runs npm run dev from the frontend folder; oc_install runs npm install there. Both are bash with set -e and cd to their own directory.

### boot_frontend · windows wrappers

- refers-to: frontend/boot_frontend :: file
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

formvis shipped boot_frontend.bat and oc_install.bat (cd /d to the folder, then npm run dev or npm install). Not ported in F1.

## Other formvis pieces not carried

### frontend/src/version.ts · VERSION

- refers-to: frontend/src/version.ts :: VERSION
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

formvis has export const VERSION. Not created in F1 (not asked); add it when the About dialog needs it.

### frontend/tests · test files

- refers-to: frontend/tests :: folder
- kind: removed-code
- logged: v0.1.0 · 2026-10-30

formvis's tests folder and vitest setup are not carried: no tests in this repository until the owner asks.
