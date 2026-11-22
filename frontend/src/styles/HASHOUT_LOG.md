# HASHOUT_LOG · frontend/src/styles (tokens, theme boot, theme profiles) · formsubstrate

Living log for tokens.css, light-mode.css and the theme code that writes their variables: the theme-boot script in frontend/index.html and src/ui/themes.ts. Source files stay comment-free; what they would have said lives here. Older entries for these files are in frontend/HASHOUT_LOG.md.

Current build version: v0.20.0

### index.html · theme-boot default theme and accent

- refers-to: frontend/index.html :: theme-boot script (DEFAULT_THEME, DEFAULT_ACCENT); frontend/src/ui/themes.ts :: DEFAULT_THEME, DEFAULT_ACCENT
- kind: decision
- logged: v0.20.0 · 2026-11-22

Owner decision: the default theme is the suite's Studio Dark (`studio`, FormVis's default profile) and Substrate's accent is #a077e0 everywhere. Substrata stays a profile a person can choose. Removed from the boot:

```
  var DEFAULT_THEME = 'substrata';
  var ACCENTS = { 'substrata': '#c661ff' };
  var DEFAULT_ACCENT = '#f97316';
  ...
  if (!accent) accent = ACCENTS[theme] || DEFAULT_ACCENT;
```

and from themes.ts `accent: '#c661ff'` on the substrata profile, `DEFAULT_THEME = 'substrata'` and `DEFAULT_ACCENT = '#f97316'`. The per-profile `accent` field and `accentFor` stay so a profile can carry its own accent again; no profile does now. The hexToRgba fallback for an unreadable accent became rgba(160,119,224) (#a077e0) instead of the old lavender rgba(171,160,211). tokens.css --accent-color and --accent-color-dim carry #a077e0 too. --brand-orange stays: it is the brand colour, not an accent default.

### index.html · theme-boot appearance generations

- refers-to: frontend/index.html :: theme-boot script (APPEARANCE, GEN3_DEFAULT_ACCENTS, OLD_DEFAULT_ACCENT); frontend/src/ui/themes.ts :: APPEARANCE, GEN3_DEFAULT_ACCENTS, readChoice
- kind: rationale
- logged: v0.20.0 · 2026-11-22

FormVis's appearance rule, as its index.html line 76 and themes.ts readChoice apply it: a saved choice carries a generation number; the current generation keeps theme, accent and intensity; the previous generation keeps the theme and any accent chosen on purpose, the old default accent becoming the new default. Substrate moves to generation 4 for the #a077e0 accent. Generation 3 (every choice Substrate saved up to v0.19.0) keeps theme and intensity; its accent is kept unless it is #f97316 or #c661ff, the two values Substrate wrote by itself (setTheme stores accentFor(theme), so an untouched accent was saved as one of them), which become #a077e0. A person who picked exactly one of those two by hand gets #a077e0 too; the two cannot be told apart, as in FormVis's own #aba0d3 step. Generation 2 behaves as FormVis's: #aba0d3 becomes the default, intensity resets. A choice with no generation and a known theme is read as generation 3, not set aside as FormVis does, because a person who already chose a theme keeps it (this replaces the v0.1.0 entry "theme-boot legacy gate"). The boot and readChoice implement the same table; the next saveChoice writes generation 4.

### index.html · theme-boot old default pin

- refers-to: frontend/index.html :: theme-boot script (ran, PINNED, OLD_DEFAULT_THEME)
- kind: decision
- logged: v0.20.0 · 2026-11-22

A person who used Substrate before v0.20.0 and never chose a theme saw Substrata, the old default. They keep it: on the first v0.20.0 load the boot writes `{ theme: 'substrata', appearance: 4 }` to nodemode_ui_settings before the first paint, so the window shows what it showed before and nothing repaints. Someone counts as an earlier user when nodemode.formsubstrate.migrated was already set before this load or old subform. keys were carried across in it (`ran`). The pin runs once: nodemode.formsubstrate.theme-default is set on the first v0.20.0 load for everyone, so a new person stays on Studio Dark on every later load. Both keys sit outside the formsubstrate. prefix on purpose: Preferences > Reset removes formsubstrate.* and nodemode_ui_settings, and after a reset the window comes up on Studio Dark rather than being pinned again. Their accent follows generation 4, so it is #a077e0 (it was #c661ff), as the owner's accent decision asks.

### index.html · theme-boot system appearance

- refers-to: frontend/index.html :: theme-boot script (PREFS_KEY, AUTO_LIGHT, AUTO_DARK); frontend/src/ui/prefs.ts :: followSystemTheme
- kind: rationale
- logged: v0.20.0 · 2026-11-22

Preferences > Appearance > Follow system appearance (themeAuto, themeLight, themeDark in formsubstrate.prefs) used to take effect only when followSystemTheme ran after the bundle loaded, so a system scheme that changed between two sessions repainted the window once on load. The boot now reads the same prefs and matchMedia('(prefers-color-scheme: dark)') before the first paint and, when the pick differs from the saved theme, writes it as setTheme would (theme, the resolved accent and intensity, generation 4). readChoice then returns that theme and followSystemTheme finds nothing to change. The validation mirrors loadPrefs: themeLight must be a light profile, themeDark a dark one, else the DEFAULT_PREFS pair. AUTO_LIGHT and AUTO_DARK must equal DEFAULT_PREFS.themeLight and themeDark in prefs.ts ('light' and 'substrata' today); change them together.

### index.html, themes.ts · amoled profile

- refers-to: frontend/index.html :: PROFILES.amoled, OLED, critical style html[data-oled] body; frontend/src/ui/themes.ts :: THEMES.amoled, ThemeProfile.oled, applyTheme; frontend/src/styles/tokens.css :: :root[data-oled]
- kind: explainer
- logged: v0.20.0 · 2026-11-22

AMOLED Black, as FormVis defines it: the same eleven values in the boot row and the themes.ts vars, `oled: true`, the data-oled attribute on documentElement set by the boot before the first paint and kept in step by applyTheme, the critical style painting body pure black for it, and the :root[data-oled] token block (hover, soft border, surface-1, line-0). The profile names are now FormVis's 29 plus substrata, 30 in both the boot and themes.ts.

### tokens.css · FormVis token names

- refers-to: frontend/src/styles/tokens.css :: :root
- kind: rationale
- logged: v0.20.0 · 2026-11-22

Every custom property FormVis's tokens.css declares is now declared here with FormVis's value: 154 FormVis names; 34 were missing before (202 declared here), none after (240 declared here, the four --diff-* included). Added: --node-shadow, --grid-size, --node-opacity, --connection-width, --canvas-bg-image, the thirteen --handle-* colours, --z-under, --z-local-2, --z-local-4, --z-local-5, and --cv-layers-w, --cv-row-h, --cv-thumb, --cv-checker-a, --cv-checker-b, --cv-ants-a, --cv-ants-b, --cv-pixel-grid, --cv-handle-fill, --cv-doc-edge, --cv-action-blue, --cv-action-violet. This reverses the drop listed in the frontend log entry for tokens.css (the canvas, node and layers names), so family sheets ported later find their names. Layout variables set by script at runtime are left undeclared on purpose: --cv-wrap-indent (editor/wrap.ts line decoration), --flip-x and --tab-progress (tab settle and busy progress, read with fallbacks in shell.css).

### tokens.css, review.css · --diff-* tokens

- refers-to: frontend/src/styles/tokens.css :: --diff-add, --diff-add-strong, --diff-del, --diff-del-strong; frontend/src/styles/review.css
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

The four diff tints review.css reads now live in tokens.css :root, built from --ok and --danger. They were declared at the top of review.css, scoped to the diff and review views; that block is removed, the values are unchanged:

```
.cv-diff, .cv-rv {
  --diff-add: color-mix(in srgb, var(--ok) 13%, transparent);
  --diff-add-strong: color-mix(in srgb, var(--ok) 30%, transparent);
  --diff-del: color-mix(in srgb, var(--danger) 13%, transparent);
  --diff-del-strong: color-mix(in srgb, var(--danger) 30%, transparent);
}
```

### index.html · light profiles at the first frame

- refers-to: frontend/index.html :: critical style, theme-boot script
- kind: explainer
- logged: v0.20.0 · 2026-11-22

A light profile paints light from the first frame: the critical style paints html and body #0a0a0a, but the boot sets html's own background to the profile's --bg-primary, and tokens.css (a render-blocking stylesheet in the head) paints body with var(--bg-primary) before anything is shown; theme-light reaches body through the MutationObserver as body is inserted, still before paint. Measured headless with CPU throttling 4 and a slow network: a stored sand choice gives rgb(239, 232, 218) on root and body at the first animation frame and after load, with no change in between and CLS 0.

### frontend/index.html · AUTO_DARK; frontend/src/ui/prefs.ts · DEFAULT_PREFS.themeDark

- refers-to: frontend/index.html :: AUTO_DARK; frontend/src/ui/prefs.ts :: DEFAULT_PREFS
- kind: rationale
- logged: v0.20.0 · 2026-11-22

The dark half of Auto, and the theme the title bar's light and dark toggle goes back to, was `'substrata'` in both places. Both are now `'studio'`, the suite's default (the owner's decision). The two values change together because the boot and the preferences must agree, or the window repaints after load. A person who chose a dark theme for Auto keeps it; only someone who never chose gets Studio Dark there.

### frontend/src/styles/tokens.css, editor.css, git.css · conflict tokens and rules

- refers-to: frontend/src/styles/tokens.css :: --conflict-*; frontend/src/styles/editor.css :: .cm-conflict-*; frontend/src/styles/git.css :: .cv-sc-row[data-group="merge"], .cv-rv-conflict, .cv-rv-resolve
- kind: rationale
- logged: v0.23.0 · 2026-11-22

Conflict tokens sit beside the `--diff-*` ones, in VS Code's colours: current is green (`--ok`), incoming is blue (`--conflict-incoming-ink`, #3b9eff dark and #1d6fd8 light), the base is the muted grey, each with a stronger tint for its marker line. The light theme sets its own ink and tints in `body.theme-light`, because a custom property resolved on `:root` would keep the dark ink. `--conflict-actions-h` is `1lh`, one editor line, so the action line under each block header takes exactly the height CodeMirror reserved for it. The review pane's conflict note and Open to Resolve button are styled in git.css with their `[hidden]` rules (`.cv-rv-act` is `inline-flex`, which would otherwise beat `hidden`).
