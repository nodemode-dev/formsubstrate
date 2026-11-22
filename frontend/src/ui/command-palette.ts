import type { Commands } from './commands';
import { Dialog } from './dialogs';
import { el, isMac, patchList, q, setClass, setHidden, setHtml, setText, setTitle } from './dom';
import { t } from './i18n';
import { icon } from './icons';
import type { MenuDef, MenuItem } from './menu';
import { FILE_PAGE, FileIndex, parseFileQuery, type FileRow } from './palette/files';
import { fuzzyScore } from './palette/fuzzy';
import { filterFileSymbols, loadFileSymbols, scopeOf, searchWorkspaceSymbols, type FileSymbols, type SymbolRow, type SymbolScope, type SymbolView } from './palette/symbols';
import { isAbort } from '../io/lsp';

function pathsOf(menus: MenuDef[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (items: MenuItem[], path: string): void => {
    for (const it of items) {
      if (it === '-') continue;
      if (typeof it === 'object') walk(it.items, `${path} > ${it.label}`);
      else if (!out.has(it)) out.set(it, path);
    }
  };
  for (const m of menus) walk(typeof m.items === 'function' ? m.items() : m.items, m.label);
  return out;
}

interface Hit { key: string; label: string; meta: string; icon: string; enabled: boolean; why?: string; score: number; on?: boolean; sym?: SymbolRow; file?: string; gap?: boolean; run: () => void }

const SHOWN = 12;
const DEBOUNCE_MS = 140;
const SLOW_MS = 250;
const RETRY_MS = 1200;
const RETRIES = 5;
export const PALETTE_CHORD = 'formsubstrate:palette-chord';

export class CommandPalette extends Dialog {
  private readonly input = el<HTMLInputElement>('<input class="cv-input" type="search" placeholder="Search commands" aria-label="Search commands" spellcheck="false" autocomplete="off">');
  private readonly list = el(`<div class="cv-palette-list" role="listbox" aria-label="${t('Commands')}"></div>`);
  private readonly empty = el('<p class="cv-note cv-palette-empty" hidden>No command matches.</p>');
  private hits: Hit[] = [];
  private selected = 0;
  private paths = new Map<string, string>();
  private recent: string[] = [];
  onOpenSymbol: ((path: string, line: number, col: number) => void) | null = null;
  private scope: SymbolScope | null = null;
  private fileAll: FileSymbols | null = null;
  private fileSerial = 0;
  private abort: AbortController | null = null;
  private timer = 0;
  private slow = 0;
  private tries = 0;
  private lastQuery = '';
  private pool = 0;
  onOpenFile: ((path: string, line: number, col: number) => void) | null = null;
  private fileMode = false;
  private viewFiles = false;
  private fileIndex: FileIndex | null = null;
  private fileRows: FileRow[] = [];
  private fileText = '';
  private fileLimit = FILE_PAGE;
  private fileTimer = 0;
  private fileSlow = 0;

  constructor(private readonly commands: Commands, private readonly menus: () => MenuDef[]) {
    super('Search', 560);
    this.onClose = () => { this.stopSymbols(); this.stopFiles(); };
    const box = el('<div class="cv-palette-box"></div>');
    box.append(this.list, this.empty);
    this.body.append(this.input, box);
    this.input.addEventListener('input', () => { this.selected = 0; this.render(); });
    this.list.addEventListener('scroll', () => {
      if (this.viewFiles && this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 2 * this.list.clientHeight / 12) this.pageFiles();
    }, { passive: true });
    this.input.addEventListener('keydown', (e) => {
      const modP = (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p';
      if (modP && !this.fileMode) { e.preventDefault(); this.show('', true); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || modP) {
        e.preventDefault();
        const down = e.key !== 'ArrowUp';
        if (down && this.selected >= this.hits.length - 2) this.pageFiles();
        this.selected = Math.max(0, Math.min(this.hits.length - 1, this.selected + (down ? 1 : -1)));
        this.mark();
      } else if (e.key === 'Enter') { e.preventDefault(); this.runHit(this.selected); }
      else if (!e.altKey && !this.input.value) {
        const chord = new CustomEvent(PALETTE_CHORD, { cancelable: true, detail: { key: e.key.toLowerCase(), close: () => this.close() } });
        if (!window.dispatchEvent(chord)) e.preventDefault();
      }
    });
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.cv-palette-row');
      if (row) this.runHit(Number(row.dataset.key));
    });
  }

  show(prefix = '', files = false): void {
    if (this.isOpen) {
      if (files && !this.fileMode) { this.fileMode = true; this.input.placeholder = t('Search files by name, > for commands, @ for file symbols, # for workspace symbols'); }
      if (prefix || files) { this.input.value = prefix; this.selected = 0; this.render(); this.input.focus(); }
      return;
    }
    this.paths = pathsOf(this.menus());
    this.fileMode = files;
    this.input.value = prefix;
    this.input.placeholder = files ? t('Search files by name, > for commands, @ for file symbols, # for workspace symbols') : t('Search commands, @ for file symbols, # for workspace symbols');
    this.selected = 0;
    this.render();
    this.open(this.input);
  }

  private stopFiles(): void {
    this.fileIndex?.stop();
    this.fileIndex = null;
    this.fileMode = false;
    this.viewFiles = false;
    this.fileRows = [];
    this.fileText = '';
    window.clearTimeout(this.fileTimer);
    window.clearTimeout(this.fileSlow);
    this.fileTimer = 0;
    this.fileSlow = 0;
  }

  private fileProgress(): void {
    if (this.fileTimer) return;
    this.fileTimer = window.setTimeout(() => {
      this.fileTimer = 0;
      if (this.isOpen && this.viewFiles) this.renderFiles(this.input.value);
    }, this.fileIndex?.done ? 0 : 120);
  }

  private fileHit(r: FileRow, line: number, col: number): Hit {
    return { key: `file:${r.path}`, label: r.name, meta: r.dir, icon: 'file', enabled: true, why: line ? `${r.path}:${line}` : r.path, score: r.score, file: r.path, run: () => { this.onOpenFile?.(r.path, line, col); } };
  }

  private renderFiles(raw: string): void {
    this.viewFiles = true;
    const index = (this.fileIndex ??= new FileIndex(() => this.fileProgress()));
    const query = parseFileQuery(raw);
    if (query.text !== this.fileText) this.fileLimit = FILE_PAGE;
    this.fileText = query.text;
    const view = index.search(query);
    this.fileRows = view.rows;
    this.hits = view.rows.slice(0, this.fileLimit).map((r) => this.fileHit(r, query.line, query.col));
    this.selected = Math.max(0, Math.min(this.selected, this.hits.length - 1));
    this.paint();
    setText(this.empty, view.note);
    const quiet = this.hits.length > 0 || !view.note;
    if (quiet || index.ready || !query.text || !this.empty.hidden) {
      window.clearTimeout(this.fileSlow);
      this.fileSlow = 0;
      setHidden(this.empty, quiet);
      return;
    }
    if (!this.fileSlow) this.fileSlow = window.setTimeout(() => { this.fileSlow = 0; if (this.viewFiles && !this.hits.length) setHidden(this.empty, false); }, SLOW_MS);
  }

  private pageFiles(): void {
    if (!this.viewFiles || this.hits.length >= this.fileRows.length) return;
    const query = parseFileQuery(this.input.value);
    this.fileLimit += FILE_PAGE;
    this.hits = this.fileRows.slice(0, this.fileLimit).map((r) => this.fileHit(r, query.line, query.col));
    this.paint();
  }

  private runHit(i: number): void {
    const h = this.hits[i];
    if (!h?.enabled) return;
    if (!h.sym && !h.file) this.recent = [h.key, ...this.recent.filter((k) => k !== h.key)].slice(0, SHOWN);
    this.close();
    h.run();
  }

  private stopSymbols(): void {
    this.abort?.abort();
    this.abort = null;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.slow);
    this.fileSerial++;
    this.scope = null;
    this.fileAll = null;
    this.lastQuery = '';
  }

  private symbolHit(r: SymbolRow): Hit {
    return { key: r.key, label: r.name, meta: r.where, icon: '', enabled: true, why: `${r.path}:${r.line}`, score: r.score, sym: r, run: () => { this.onOpenSymbol?.(r.path, r.line, r.col); } };
  }

  private showView(view: SymbolView): void {
    window.clearTimeout(this.slow);
    this.hits = view.rows.map((r) => this.symbolHit(r));
    this.selected = Math.max(0, Math.min(this.selected, this.hits.length - 1));
    this.paint();
    setText(this.empty, view.note);
    setHidden(this.empty, this.hits.length > 0 || !view.note);
  }

  private pending(): void {
    window.clearTimeout(this.slow);
    this.slow = window.setTimeout(() => {
      if (this.hits.length || !this.scope) return;
      setText(this.empty, t('Searching...'));
      setHidden(this.empty, false);
    }, SLOW_MS);
  }

  private renderSymbols(scope: SymbolScope, query: string): void {
    if (scope !== this.scope) {
      this.stopSymbols();
      this.scope = scope;
      this.showView({ rows: [], note: '', again: false });
    }
    if (query !== this.lastQuery) this.tries = 0;
    this.lastQuery = query;
    if (scope === 'file') {
      if (this.fileAll) { this.showView(filterFileSymbols(this.fileAll, query)); return; }
      const serial = ++this.fileSerial;
      this.pending();
      void loadFileSymbols().then((all) => {
        if (serial !== this.fileSerial || this.scope !== 'file') return;
        if (all.rows.length) this.fileAll = all;
        this.showView(filterFileSymbols(all, scopeOf(this.input.value).query));
      });
      return;
    }
    window.clearTimeout(this.timer);
    if (!query) {
      this.abort?.abort();
      this.showView({ rows: [], note: t('Type a symbol name'), again: false });
      return;
    }
    this.timer = window.setTimeout(() => { void this.runWorkspace(query); }, DEBOUNCE_MS);
  }

  private async runWorkspace(query: string): Promise<void> {
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    this.pending();
    try {
      const view = await searchWorkspaceSymbols(query, ac.signal);
      if (ac.signal.aborted || this.scope !== 'workspace') return;
      this.showView(view);
      if (view.again && this.tries++ < RETRIES) this.timer = window.setTimeout(() => { void this.runWorkspace(query); }, RETRY_MS);
    } catch (e) {
      if (isAbort(e) || ac.signal.aborted || this.scope !== 'workspace') return;
      this.showView({ rows: [], note: t('Symbols could not be searched'), again: false });
    }
  }

  private render(): void {
    this.viewFiles = false;
    window.clearTimeout(this.fileSlow);
    this.fileSlow = 0;
    const mode = scopeOf(this.input.value);
    if (mode.scope) { this.renderSymbols(mode.scope, mode.query); return; }
    if (this.scope) this.stopSymbols();
    const typed = this.input.value.trimStart(), asked = typed.startsWith('>');
    if (this.fileMode && !asked) { this.renderFiles(typed); return; }
    setText(this.empty, t('No command matches.'));
    const query = (asked ? typed.slice(1) : typed).trim(), hits: Hit[] = [];
    const first = (key: string): number => { const i = this.recent.indexOf(key); return query || i < 0 ? 0 : 1000 - i; };
    for (const c of this.commands.all()) {
      const label = t(this.commands.label(c)).replace(/\.\.\.$/, ''), path = this.paths.get(c.id) ?? '';
      if (!label) continue;
      const own = fuzzyScore(query, label), wide = own === null ? fuzzyScore(query, `${label} ${path}`) : null;
      if (own === null && wide === null) continue;
      const score = own ?? (wide as number) - 10;
      const on = c.checked ? c.checked() : undefined;
      hits.push({ key: c.id, label, meta: [on === undefined ? '' : on ? 'On' : 'Off', path, this.commands.keyLabel(c)].filter(Boolean).join(' · '), icon: c.icon ?? '', enabled: this.commands.enabled(c), why: t(this.commands.why(c)), score: score + first(c.id), on, run: () => { this.commands.run(c.id); } });
    }
    hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    this.hits = hits.slice(0, SHOWN);
    this.selected = Math.max(0, Math.min(this.selected, this.hits.length - 1));
    this.paint();
    setHidden(this.empty, this.hits.length > 0);
  }

  private paint(): void {
    this.pool = Math.max(this.pool, this.hits.length);
    const items: Hit[] = Array.from({ length: this.pool }, (_, i) => this.hits[i] ?? { key: '', label: '', meta: '', icon: '', enabled: false, score: 0, gap: true, run: () => undefined });
    patchList(this.list, items, {
      key: (h) => String(items.indexOf(h)),
      create: (h) => {
        const n = el<HTMLButtonElement>('<button class="cv-list-row cv-palette-row" type="button" role="option" tabindex="-1"><span class="cv-palette-icon"></span><span class="cv-palette-kind"></span><span class="cv-list-name"></span><span class="cv-palette-badge"></span><span class="cv-list-meta"></span></button>');
        this.fill(n, h);
        return n;
      },
      update: (n, h) => this.fill(n, h),
    });
    this.mark();
  }

  private fill(n: HTMLElement, h: Hit): void {
    setText(q(n, '.cv-list-name'), h.label);
    setText(q(n, '.cv-list-meta'), h.meta);
    setHidden(n, !!h.gap);
    setClass(n, 'is-symbol', !!h.sym);
    setText(q(n, '.cv-palette-kind'), h.sym?.kind ?? '');
    setText(q(n, '.cv-palette-badge'), h.sym?.badge ?? '');
    setClass(n, 'is-off', !h.enabled);
    setClass(n, 'is-on', !!h.on);
    if (h.why || n.title) setTitle(n, h.why ?? '');
    if (n.getAttribute('aria-disabled') !== String(!h.enabled)) n.setAttribute('aria-disabled', String(!h.enabled));
    setHtml(q(n, '.cv-palette-icon'), h.icon ? icon(h.icon, 16) : '', h.icon);
  }

  private mark(): void {
    Array.from(this.list.children).forEach((n, i) => {
      setClass(n, 'is-selected', i === this.selected);
      if (n.getAttribute('aria-selected') !== String(i === this.selected)) n.setAttribute('aria-selected', String(i === this.selected));
    });
    const row = this.list.children[this.selected] as HTMLElement | undefined;
    if (!row) return;
    const top = row.offsetTop, bottom = top + row.offsetHeight, view = this.list.clientHeight;
    if (top < this.list.scrollTop) this.list.scrollTop = top;
    else if (bottom > this.list.scrollTop + view) this.list.scrollTop = bottom - view;
  }
}
