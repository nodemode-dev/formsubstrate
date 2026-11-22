# HASHOUT_LOG · frontend/src/ui/i18n (interface languages) · formsubstrate

Living log for frontend/src/ui/i18n.ts, frontend/src/ui/i18n/ (the language list and the tables), the LANG_ALIASES map in frontend/src/ui/prefs.ts, frontend/scripts/i18n-check.mjs and the `./formsubstrate i18n` command. Source files stay comment-free; what they would have said lives here.

Current build version: v0.20.0
Last updated: 2026-11-22

### frontend/src/ui/i18n/langs.ts · LANG_CODES, LANG_NAMES, RTL_LANGS, LANG_PARENT

- refers-to: frontend/src/ui/i18n/langs.ts :: LANG_CODES, LANG_NAMES, RTL_LANGS, LANG_PARENT, isLang; /home/claude/nodemode-dev/formvis/frontend/src/ui/i18n/langs.ts
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

Owner decision: every interface language the family ships ships with Substrate. The list is FormVis's, in the family's order and with each language in its own name: en, es, es-MX, pt-BR, fr, fr-CA, de, it, nl, da, fi, nb, sv, ru, pl, cs, hu, uk, tr, el, sr-Latn, zh-CN, zh-TW, ja, ko, id, th, vi, ar, hi. Arabic is the one right-to-left language; es-MX falls back to es and fr-CA to fr. The file has no imports so prefs.ts and i18n.ts can both read it. Removed:

```
export const LANG_CODES = ['en'] as const;
export const LANG_NAMES: ReadonlyArray<readonly [Lang, string]> = [['en', 'English']];
export const RTL_LANGS: ReadonlySet<Lang> = new Set<Lang>([]);
export const LANG_PARENT: Partial<Record<Lang, Lang>> = {};
```

### frontend/src/ui/i18n.ts · PARTS, partOf, hasTable, load

- refers-to: frontend/src/ui/i18n.ts :: PARTS, exportName, partOf, hasTable, load, t, tn, setLanguage, startLanguage, startPageTranslator; frontend/src/app.ts :: startApp
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

Removed: `const LOADERS: Record<string, () => Promise<Table>> = {};` and, in load, `const loader = LOADERS[code]; if (!loader) continue; tables.set(code, await loader());`.

Each language's table is its own lazily loaded chunk, as in FormVis, but the loaders come from one `import.meta.glob` over `./i18n/*.ts`, `./i18n/more/*.ts` and `./i18n/extra/*.ts` (langs.ts excluded) instead of FormVis's three hand-written maps. A worker adding a language only adds files; i18n.ts does not change. The module for code `xx-YY` exports its table as `xxYY` (es-MX as esMX, pt-BR as ptBR, sr-Latn as srLatn, zh-CN as zhCN), the same names FormVis uses, and each part file of a language exports the same name. A language loads its main file and its `more` and `extra` parts at once and merges them with the main file winning where they share a key, as FormVis does. A listed language with no file at all is not an error: load skips it and t() returns English.

Lookup is FormVis's: the current table, then the parent's (LANG_PARENT), then the English. A trailing "..." or a single trailing ":" is set aside before the lookup and put back after, so "Save As..." and "Size:" share the entries "Save As" and "Size"; tables never hold the trailing "..." or ":". tn() takes the English one and other forms with `{n}`; a table may add `<other form>#<plural category>` entries for languages with more categories.

Zero flash: startApp awaits startLanguage before the shell is mounted, so the stored language's table (and its parent's) is loaded and current before the first text is built, and `lang` and `dir` are set on the root before paint. From the mount to startPageTranslator the boot is synchronous, so the translator's first walk also runs before paint. A change in Preferences waits for the table, then the onLanguage listeners patch their own text and the page translator patches text nodes and title, aria-label and placeholder attributes in place, keeping the English per node; no container is rebuilt.

### frontend/src/ui/prefs.ts · LANG_ALIASES

- refers-to: frontend/src/ui/prefs.ts :: LANG_ALIASES, systemLang
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

Removed: `const LANG_ALIASES: Record<string, Lang> = {};`. It is now FormVis's map, so a system language with no exact code lands on the family's choice: zh-Hant, zh-HK and zh-MO to zh-TW, zh to zh-CN, pt to pt-BR, no and nn to nb, sr to sr-Latn, es-419 and es-US to es-MX. The `language` preference type already came from langs.ts (`Lang`), and the Language row in settings.ts already lists `languages()`, so neither needed a change.

### frontend/src/ui/i18n/es.ts · es, esMX, fr, frCA, de, ptBR tables

- refers-to: frontend/src/ui/i18n/es.ts, es-MX.ts, fr.ts, fr-CA.ts, de.ts, pt-BR.ts; frontend/src/ui/i18n/more/es.ts, fr.ts, de.ts, pt-BR.ts; /tmp/substrate-i18n/reuse/
- kind: rationale
- logged: v0.20.0 · 2026-11-22

Six languages are complete at this version. A full table is split alphabetically by key: the main file holds the keys up to "Reload" and `more/` the rest, so no file passes 40 kB. es-MX and fr-CA hold only what they say differently and have no `more` part.

Wording found in FormVis (first) or FormDeck under the identical English key is reused verbatim so the family reads the same, except where the English word means something else here: an image editor's channel, edge, path, key and light are a chat channel, a graph edge, a file path, an API key and the light theme in Substrate, and push is git push. Those keys were translated for Substrate (for example fr Channel is Canal, not Couche; es Path is Ruta, not Trazado). German keeps Einstellungen for Preferences, the word the rest of its table uses.

Vocabulary follows each language's established IDE wording. Spanish: confirmar for commit, enviar for push, preparar for stage, rama, árbol de trabajo, punto de interrupción, servidor de lenguaje, instantánea; usted throughout. French: valider for the commit action and commit for the noun, envoyer for push, indexer and désindexer, branche, arbre de travail, point d’arrêt, serveur de langage, pas à pas principal, détaillé and sortant; vous; a no-break space (written  ) before : ; ? ! and between a number and its unit. German: committen, pushen, bereitstellen and Bereitstellung aufheben, Branch, Worktree, Haltepunkt, Sprachserver, Einzelschritt, Prozedurschritt, Rücksprung; Sie. Brazilian Portuguese: fazer commit, enviar for push, preparar, o branch, árvore de trabalho, ponto de interrupção, servidor de linguagem, Intervir, Contornar, Sair; você implied.

Strings the code assembles around a value ("{n} min ago", "Restore <path> to its state before this turn?", "Ports A to B") are fragments, so the translations are written to sit in the same place: es and pt-BR use "min atrás", fr "min auparavant", de "Min. her"; where Spanish would need an opening ¿ before a value the fragment ends with a full stop instead.

es-MX changes vocabulary only: agregar for añadir, computadora for equipo, la terminal, Configuración for Ajustes, vínculo for enlace, presione for pulse, the simple past for the present perfect (No se pudo, Se encontró). It keeps usted from es so a screen never mixes the two forms. fr-CA follows OQLF use as FormDeck does: no space before ; ? !, courriel, Paramètres, à partir de for depuis, Web with a capital.

Product names, keys, file names, commands and code stay as written in every language: Substrate, Substrata, Studio, Cogentics, formslot, formskills, FormPortal, Claude Code, Bash, git, MCP, debugpy, the tool names Read, Grep, Glob, Edit and Write, edge labels and option values such as accept, revise, each, done, true, false, error and route, and every {placeholder} and {{template}}.

### frontend/scripts/i18n-check.mjs · extract, main

- refers-to: frontend/scripts/i18n-check.mjs :: lex, Resolver, extract, readLangs, readTable, main; setup/i18n_check; setup/i18n_check.bat; formsubstrate; formsubstrate.bat
- kind: rationale
- logged: v0.20.0 · 2026-11-22

The check reads the sources and writes nothing. It lexes every .ts file under frontend/src (string, template and regex literals, comments, template substitutions kept as a flat token stream) and collects each English text that reaches t() or tn() (the one and other forms): literal arguments and both branches of a ternary, and, when the argument is a name, what that name can hold: its initialiser (a map or a list of tuples, taking the destructured position), the call sites of the function, method or constructor whose parameter it is, the values of a Map it iterates, the return values of a called function, label, title, hint, help, tip, description, sub, note, placeholder and empty properties anywhere, data- attributes and the option values of a select. Strings in conditions, comparisons, index expressions and arguments of DOM and string helpers are not keys. Keys are normalised as t() does (trailing "..." or ":" removed).

It then takes the language list from langs.ts. A listed language with no table file is printed as having no table yet and is not required. A language with a table must have no key the source no longer has, no placeholder that differs from its key, no duplicate key across its parts, no empty translation and no em dash; a full table (one with no LANG_PARENT) must have every key. A t() argument whose English the check cannot see (a value from the engine) is counted and listed with `--unresolved`; `--keys` prints the key list and `--sources` each key with the places it comes from. `./formsubstrate i18n` and `formsubstrate.bat i18n` run it through setup/i18n_check and setup/i18n_check.bat; exit 1 means the FAIL lines need fixing.

### frontend/src/extensions/search/index.ts · paintCount plural forms

- refers-to: frontend/src/extensions/search/index.ts :: SearchPanel.paintCount; frontend/src/ui/i18n.ts :: tn
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

Removed: ``tn(this.hits.length, '1 result', `${this.hits.length} results`)`` and ``tn(files, '1 file', `${files} files`)``. The forms were built with the number already in them, so no table could ever match them. They are now `tn(this.hits.length, '{n} result', '{n} results')` and `tn(files, '{n} file', '{n} files')`, which show the same English.

### frontend/src/ui/toast.ts · English strings now passed to t()

- refers-to: frontend/src/app.ts :: SHELL; frontend/src/extensions/sessions/index.ts :: remove action; frontend/src/ui/command-palette.ts :: list; frontend/src/ui/panels/controls.ts :: sliderRow reset title; frontend/src/ui/path-picker.ts :: hiddenToggle; frontend/src/ui/tabs.ts :: tab close button; frontend/src/ui/toast.ts :: toast close button; /tmp/substrate-i18n/unwrapped.txt
- kind: removed-code
- logged: v0.20.0 · 2026-11-22

These texts reached the window without t(), so no table could list them. Removed literals: `aria-label="Main menu"` (app.ts SHELL), `'Remove anyway'` (the confirm button of removing a session with uncommitted changes), `aria-label="Commands"` (command palette list), `q(root, 'span').title = 'Double-click to reset'` (controls.ts), `aria-label="Show hidden files"` (path picker), `aria-label="Close tab"` (tabs.ts), `title="Dismiss" aria-label="Dismiss notice"` (toast.ts). Each is now `t('...')`; controls.ts, tabs.ts and toast.ts gained `import { t }`. The SHELL string is built at module load, before the table is current, so its aria-label is set in English and the page translator puts the translation in before paint. Texts in files other workers own are listed in /tmp/substrate-i18n/unwrapped.txt and were not touched.
