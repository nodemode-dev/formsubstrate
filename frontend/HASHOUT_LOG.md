# HASHOUT_LOG · frontend · subform

Current build version: v0.1.0
Last updated: 2026-10-30 · Phase F1

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
    main.ts               F1 boot: placeholder shell, fonts wait, revealApp
    ui/
      dom.ts              zero-flash DOM helpers and revealApp
    styles/
      base.css            font faces, box sizing, body font, placeholder region
```

## Table of contents

- index.html
- public/splash.html
- src/main.ts
- src/ui/dom.ts
- src/styles/base.css
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

The preload hrefs point at /node_modules/@fontsource/... which resolves in the dev server only; in a production build the bundler does not rewrite them and they miss. Kept as formvis has them because the built app hashes the font files and the cost is one failed preload. Revisit if the console noise matters.

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

Runtime: @fontsource/inter 5.3.0, @fontsource/jetbrains-mono 5.3.0, @tauri-apps/api 2.11.1 (formvis's pin). Dev: @tauri-apps/cli 2.12.4 (verified on npm), typescript 7.0.2, vite 8.3.5. No test runner and no test script by rule.

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
