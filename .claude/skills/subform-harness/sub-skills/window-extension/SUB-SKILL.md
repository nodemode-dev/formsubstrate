---
name: window-extension
description: Add or change a window panel, command, menu entry or search provider in subform's TypeScript frontend through the extension registry, with keyed lists, tokens, z-index layers, icons and t() strings. Use for any frontend edit under src/extensions, src/ui, src/io or src/styles.
---

# window-extension

The window lives in `frontend/src`: `app.ts` and `main.ts` boot; `extensions/` hold feature panels; `ui/` holds shell modules; `io/` is the only code that talks to the engine; `styles/` holds CSS split by area with `tokens.css` as the one source of values.

## Where things go

| Concern | Place |
| --- | --- |
| A feature panel with its own sidebar section | `extensions/[name]/index.ts`, imported for side effect in `app.ts` |
| HTTP, SSE or WebSocket to the engine | `io/[name].ts`, built on `io/api.ts` `request` |
| Shell parts (menus, dialogs, tabs, status, home, prefs) | `ui/` |
| CSS for a feature | `styles/[name].css`, tokens only |
| Icons | `ui/icons.ts`, inline SVG with currentColor |
| DOM helpers | `ui/dom.ts` |

## Adding a panel

1. Create `extensions/[name]/index.ts` and call `register({ id, name, description, required?, setup(ctx, shell), dispose? })` from `extensions/registry.ts`. A duplicate id throws.
2. In `setup`, call `shell.sidebarSection({ id, title, icon, render(host) })`. The returned section has `reveal()`. `shell.rightSection` and `shell.splitHost` exist as optional members for the right rail and split stage.
3. Register commands with `ctx.commands.add({ id, label, keys?, enabled?, run })`. Keys are written in Alt, Shift, Mod order.
4. A search provider: `shell.registerSearchProvider({ id, prefix?, label, query })`.
5. Add `import './extensions/[name]';` to the import block at the top of `app.ts`. Order there is activation order.
6. Add an `io/[name].ts` client and, if the engine needs a route, follow `engine-route`.
7. Enabled state is stored under the localStorage key `subform.ext.disabled`; `required: true` extensions cannot be disabled. Disabling calls `dispose` and asks for a reload.
8. Cross-extension messages are `window` CustomEvents named `subform:[thing]`, exported as constants beside their owner (for example `GIT_CHANGED`, `FORMSLOT_OPEN`, `SESSION_SELECTED`).

## Zero flash patterns (ui/dom.ts)

- `mountOnce(host, html)` builds a container once and throws if the host already has children. Use it in `render`.
- `el(html)` makes a node; `q(root, selector)` finds a required child.
- Change state in place: `setText`, `setClass`, `setHidden`, `setDisabled`, `setTitle`, `setValue`, `setChecked`, `setStyleVar`. They write only when the value differs.
- Keyed lists: `patchList(container, items, { key, create, update })`. It reorders and removes by `dataset.key` and never rebuilds the container.
- `reserve(el, box)` fixes size before content arrives; `delayedIndicator` and `pendingClass` hold a spinner back 300 ms and keep it at least 250 ms.
- Never assign `innerHTML` on a live container. `setHtml(node, html, key)` is the keyed exception.
- Anything that appears late (banners, cards) needs its space reserved or must overlay, or layout shift will be above 0.

## Tokens, layers, strings

- z-index only through the `--z-*` tokens in `styles/tokens.css` (`--z-raised`, `--z-rail`, `--z-chrome`, `--z-menu`, `--z-modal`, `--z-settings`, `--z-context`, `--z-toast`, up to `--z-debug`). Pick the nearest existing layer; add a token only when none fits.
- Colours, spacing and radii from tokens; check `light-mode.css` and the theme profiles in `ui/themes.ts` so a new surface works in both modes.
- User-visible text goes through `t(english)` or `tn(n, one, other)` from `ui/i18n.ts`; the English string is the key.
- Icons: add a case to `ui/icons.ts`; no icon library, never the three-star sparkle.
- Workspace trust gates anything that would run workspace-local programs; see `lsp-and-debug` and `references/security-model.md`.

## Gate

Typecheck, build to scratch, and a throttled Playwright pass with layout shift 0; see `run-and-verify`. Log any rationale in the HASHOUT_LOG beside the code (`extensions`, `ui`, `io` each have one).
