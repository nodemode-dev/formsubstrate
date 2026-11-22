import { detailOf, searchWorkspace, type SearchHit } from '../../io/workspace';
import { el, patchList, pendingClass, q, setClass, setHidden, setText, setTitle, type Disposer } from '../../ui/dom';
import { onLanguage, t, tn } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { FOCUS_EVENT } from '../../ui/workbench';
import { register, registerSearchProvider, type ExtensionContext, type Shell, type SidebarSection } from '../registry';

const DEBOUNCE_MS = 180;
const LIMIT = 500;
const PALETTE_LIMIT = 40;
const TEXT_MAX = 240;

interface Line {
  key: string;
  kind: 'file' | 'hit';
  path: string;
  text: string;
  line: number;
  col: number;
  count: number;
  open: boolean;
}

const dirOf = (path: string): string => { const at = path.lastIndexOf('/'); return at < 0 ? '' : path.slice(0, at); };
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const clip = (s: string): string => (s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) : s).trim();

class SearchPanel {
  private readonly input: HTMLInputElement;
  private readonly glob: HTMLInputElement;
  private readonly globRow: HTMLElement;
  private readonly count: HTMLElement;
  private readonly note: HTMLElement;
  private readonly results: HTMLElement;
  private readonly toggles: Record<'regex' | 'case' | 'glob', HTMLButtonElement>;
  private flags = { regex: false, case: false, glob: false };
  private hits: SearchHit[] = [];
  private lines: Line[] = [];
  private collapsed = new Set<string>();
  private selected = '';
  private timer = 0;
  private abort: AbortController | null = null;
  private pending: Disposer | null = null;
  private engine = '';
  private truncated = false;
  private error = '';
  private ran = false;
  private serial = 0;
  private readonly ids = new Map<string, string>();

  constructor(private readonly host: HTMLElement, private readonly ctx: ExtensionContext, private readonly shell: Shell) {
    host.append(el(
      '<div class="cv-search">' +
      '<div class="cv-search-bar"><input class="cv-input cv-search-q" type="text" spellcheck="false" autocomplete="off">' +
      '<button class="cv-search-tog" type="button" data-opt="regex">.*</button>' +
      '<button class="cv-search-tog" type="button" data-opt="case">Aa</button>' +
      `<button class="cv-search-tog" type="button" data-opt="glob">${icon('file', 14)}</button></div>` +
      '<div class="cv-search-bar cv-search-globrow" hidden><input class="cv-input cv-search-glob" type="text" spellcheck="false" autocomplete="off"></div>' +
      '<div class="cv-search-count"><span class="cv-search-total"></span><span class="cv-search-trunc" hidden></span></div>' +
      '<div class="cv-search-results" role="tree" tabindex="0"></div></div>'));
    this.input = q(host, '.cv-search-q');
    this.glob = q(host, '.cv-search-glob');
    this.globRow = q(host, '.cv-search-globrow');
    this.count = q(host, '.cv-search-total');
    this.note = q(host, '.cv-search-trunc');
    this.results = q(host, '.cv-search-results');
    this.toggles = {
      regex: q(host, '[data-opt="regex"]'),
      case: q(host, '[data-opt="case"]'),
      glob: q(host, '[data-opt="glob"]'),
    };
    this.bind();
    this.relabel();
    onLanguage(() => { this.relabel(); this.paintCount(); });
    ctx.store.on('workspace', () => this.reset());
    host.addEventListener(FOCUS_EVENT, () => { this.input.focus(); this.input.select(); });
  }

  private relabel(): void {
    this.input.placeholder = t('Search');
    this.glob.placeholder = t('Files to include, for example src/**/*.ts');
    const names = { regex: 'Use Regular Expression', case: 'Match Case', glob: 'Filter Files' };
    for (const k of Object.keys(names) as Array<keyof typeof names>) {
      setTitle(this.toggles[k], t(names[k]));
      if (this.toggles[k].getAttribute('aria-label') !== t(names[k])) this.toggles[k].setAttribute('aria-label', t(names[k]));
    }
    if (this.results.getAttribute('aria-label') !== t('Search results')) this.results.setAttribute('aria-label', t('Search results'));
  }

  private bind(): void {
    this.input.addEventListener('input', () => this.schedule());
    this.glob.addEventListener('input', () => this.schedule());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.run(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.results.focus(); this.move(1); }
    });
    this.host.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.cv-search-tog') : null;
      if (!b) return;
      const opt = b.dataset.opt as 'regex' | 'case' | 'glob';
      this.flags[opt] = !this.flags[opt];
      setClass(b, 'is-on', this.flags[opt]);
      b.setAttribute('aria-pressed', String(this.flags[opt]));
      if (opt === 'glob') { setHidden(this.globRow, !this.flags.glob); if (this.flags.glob) this.glob.focus(); }
      this.schedule();
    });
    for (const b of Object.values(this.toggles)) b.setAttribute('aria-pressed', 'false');
    this.results.addEventListener('click', (e) => {
      const n = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-search-row') : null;
      if (!n) return;
      this.selected = n.dataset.key ?? '';
      this.paintLines();
      this.activate(this.lines.find((l) => l.key === this.selected));
    });
    this.results.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this.activate(this.lines.find((l) => l.key === this.selected)); }
      else if (e.key === 'Escape') { e.preventDefault(); this.input.focus(); }
    });
  }

  private move(by: number): void {
    if (!this.lines.length) return;
    const at = this.lines.findIndex((l) => l.key === this.selected);
    const next = this.lines[Math.max(0, Math.min(this.lines.length - 1, at < 0 ? (by > 0 ? 0 : this.lines.length - 1) : at + by))];
    this.selected = next.key;
    this.paintLines();
    const node = Array.from(this.results.children).find((c) => (c as HTMLElement).dataset.key === next.key);
    node?.scrollIntoView({ block: 'nearest' });
  }

  private activate(l: Line | undefined): void {
    if (!l) return;
    if (l.kind === 'file') {
      if (this.collapsed.has(l.path)) this.collapsed.delete(l.path); else this.collapsed.add(l.path);
      this.buildLines();
      this.paintLines();
      return;
    }
    this.shell.revealLine(l.path, l.line, l.col);
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.run(), DEBOUNCE_MS);
  }

  private reset(): void {
    window.clearTimeout(this.timer);
    this.abort?.abort();
    this.abort = null;
    this.pending?.();
    this.pending = null;
    this.hits = [];
    this.ran = false;
    this.error = '';
    this.truncated = false;
    this.buildLines();
    this.paintLines();
    this.paintCount();
  }

  private run(): void {
    window.clearTimeout(this.timer);
    const query = this.input.value;
    this.abort?.abort();
    this.pending?.();
    this.pending = null;
    if (!query.trim() || !this.ctx.store.workspace) { this.reset(); return; }
    const ctl = new AbortController();
    this.abort = ctl;
    this.pending = pendingClass(this.results);
    void searchWorkspace({
      q: query, regex: this.flags.regex, caseSensitive: this.flags.case,
      glob: this.flags.glob ? this.glob.value.trim() : '', limit: LIMIT, signal: ctl.signal,
    }).then((res) => {
      if (this.abort !== ctl) return;
      this.hits = res.hits;
      this.engine = res.engine;
      this.truncated = res.truncated;
      this.error = '';
      this.ran = true;
    }).catch((err: unknown) => {
      if (this.abort !== ctl || ctl.signal.aborted) return;
      this.hits = [];
      this.error = detailOf(err);
      this.ran = true;
    }).finally(() => {
      if (this.abort !== ctl) return;
      this.pending?.();
      this.pending = null;
      this.collapsed = new Set(Array.from(this.collapsed).filter((p) => this.hits.some((h) => h.path === p)));
      this.buildLines();
      this.paintLines();
      this.paintCount();
    });
  }

  private buildLines(): void {
    const out: Line[] = [];
    const groups = new Map<string, SearchHit[]>();
    for (const h of this.hits) {
      const g = groups.get(h.path);
      if (g) g.push(h); else groups.set(h.path, [h]);
    }
    for (const [path, list] of groups) {
      const open = !this.collapsed.has(path);
      out.push({ key: `f:${path}`, kind: 'file', path, text: baseOf(path), line: 0, col: 0, count: list.length, open });
      if (open) for (const h of list) out.push({ key: `h:${path}:${h.line}:${h.col}`, kind: 'hit', path, text: clip(h.text), line: h.line, col: h.col, count: 0, open: false });
    }
    this.lines = out;
    if (this.selected && !out.some((l) => l.key === this.selected)) this.selected = '';
  }

  private paintLines(): void {
    patchList<Line>(this.results, this.lines, {
      key: (l) => l.key,
      create: (l) => {
        const id = `cv-sr-${++this.serial}`;
        this.ids.set(l.key, id);
        const n = el(l.kind === 'file'
          ? `<div class="cv-search-row cv-search-file" role="treeitem" id="${id}"><span class="cv-search-twist">${icon('chevronRight', 12)}</span><span class="cv-search-name"></span><span class="cv-search-dir"></span><span class="cv-search-n"></span></div>`
          : `<div class="cv-search-row cv-search-hit" role="treeitem" id="${id}"><span class="cv-search-ln"></span><span class="cv-search-tx"></span></div>`);
        this.paintRow(n, l);
        return n;
      },
      update: (n, l) => this.paintRow(n, l),
    });
    const live = new Set(this.lines.map((l) => l.key));
    for (const k of Array.from(this.ids.keys())) if (!live.has(k)) this.ids.delete(k);
    const id = this.ids.get(this.selected) ?? '';
    if (id) { if (this.results.getAttribute('aria-activedescendant') !== id) this.results.setAttribute('aria-activedescendant', id); }
    else if (this.results.hasAttribute('aria-activedescendant')) this.results.removeAttribute('aria-activedescendant');
  }

  private paintRow(n: HTMLElement, l: Line): void {
    setClass(n, 'is-selected', l.key === this.selected);
    if (l.kind === 'file') {
      setText(q(n, '.cv-search-name'), l.text);
      setText(q(n, '.cv-search-dir'), dirOf(l.path));
      setText(q(n, '.cv-search-n'), String(l.count));
      setClass(n, 'is-open', l.open);
      setTitle(n, l.path);
    } else {
      setText(q(n, '.cv-search-ln'), String(l.line));
      setText(q(n, '.cv-search-tx'), l.text);
    }
  }

  private paintCount(): void {
    let text = '';
    if (this.error) text = this.error;
    else if (this.ran) {
      const files = new Set(this.hits.map((h) => h.path)).size;
      text = this.hits.length
        ? `${tn(this.hits.length, '{n} result', '{n} results')} ${t('in')} ${tn(files, '{n} file', '{n} files')}${this.engine ? ` · ${this.engine}` : ''}`
        : `${t('No results')}${this.engine ? ` · ${this.engine}` : ''}`;
    }
    setText(this.count, text);
    setClass(this.count, 'is-error', !!this.error);
    setText(this.note, this.truncated ? t('Showing the first results. Narrow the search.') : '');
    setHidden(this.note, !this.truncated);
  }
}

register({
  id: 'search',
  name: 'Search',
  description: 'Search the text of every file in the workspace.',
  required: true,
  setup(ctx, shell) {
    let section: SidebarSection | null = null;
    section = shell.sidebarSection({
      id: 'search',
      title: 'Search',
      icon: 'search',
      render: (host) => { new SearchPanel(host, ctx, shell); },
    });
    ctx.commands.add({
      id: 'search-in-files',
      label: 'Find in Files...',
      keys: ['Shift+Mod+F'],
      enabled: () => !!ctx.store.workspace,
      run: () => section?.reveal(),
    });
    let timer = 0;
    registerSearchProvider({
      id: 'grep',
      prefix: '/',
      label: 'Search in files',
      query: (text) => new Promise((resolve) => {
        window.clearTimeout(timer);
        if (!text.trim() || !ctx.store.workspace) { resolve([]); return; }
        timer = window.setTimeout(() => {
          searchWorkspace({ q: text, limit: PALETTE_LIMIT }).then((res) => resolve(res.hits.map((h) => ({
            label: `${h.path}:${h.line} · ${clip(h.text).slice(0, 70)}`,
            hint: 'grep',
            icon: 'search',
            run: () => shell.revealLine(h.path, h.line, h.col),
          })))).catch(() => resolve([]));
        }, DEBOUNCE_MS);
      }),
    });
  },
});
