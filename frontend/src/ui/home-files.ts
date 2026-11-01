import { el, patchList, q, setClass, setHidden, setText, setTitle } from './dom';
import { t } from './i18n';
import { icon } from './icons';

export interface RecentEntry { path: string; name: string; opened: string; formRepo?: boolean }

export interface HomeFilesDeps {
  open: (path: string) => void;
  forget: (path: string) => void;
}

type Sort = 'opened' | 'name';
type View = 'grid' | 'list';
type Kind = 'recent' | 'workspaces';

const PREFS = 'subform.home';

function readPrefs(): { sort: Sort; view: View } {
  const out = { sort: 'opened' as Sort, view: 'list' as View };
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<typeof out>;
    if (v.sort === 'opened' || v.sort === 'name') out.sort = v.sort;
    if (v.view === 'grid' || v.view === 'list') out.view = v.view;
  } catch {
    return out;
  }
  return out;
}

function whenText(opened: string): string {
  const ms = Date.parse(opened);
  if (!Number.isFinite(ms)) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return t('Just now');
  if (s < 3600) return `${Math.round(s / 60)} ${t('min ago')}`;
  if (s < 86400) return `${Math.round(s / 3600)} ${t('h ago')}`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} ${t('d ago')}`;
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export class HomeFiles {
  readonly root = el(`<div class="cv-hf">
    <div class="cv-hf-bar">
      <label class="cv-hf-filter">${icon('search', 14)}<input class="cv-hf-input" type="search" placeholder="${t('Filter folders')}" aria-label="${t('Filter folders')}" spellcheck="false"></label>
      <label class="cv-hf-sortbox"><span>${t('Sort')}</span><select class="cv-hf-sort" aria-label="${t('Sort by')}"><option value="opened">${t('Most recent')}</option><option value="name">${t('Name')}</option></select></label>
      <div class="cv-hf-views" role="group" aria-label="${t('View')}">
        <button class="cv-hf-view" type="button" data-view="grid" title="${t('Cards')}" aria-label="${t('Cards')}">${icon('viewGrid', 16)}</button>
        <button class="cv-hf-view" type="button" data-view="list" title="${t('List')}" aria-label="${t('List')}">${icon('viewList', 16)}</button>
      </div>
    </div>
    <div class="cv-hf-head" aria-hidden="true"><span></span><span>${t('Name')}</span><span>${t('Path')}</span><span>${t('Last opened')}</span><span></span><span></span></div>
    <div class="cv-hf-items" role="list"></div>
    <p class="cv-hf-empty" hidden></p>
  </div>`);
  private readonly items = q(this.root, '.cv-hf-items');
  private readonly empty = q(this.root, '.cv-hf-empty');
  private readonly filter = q<HTMLInputElement>(this.root, '.cv-hf-input');
  private readonly sort = q<HTMLSelectElement>(this.root, '.cv-hf-sort');
  private prefs = readPrefs();
  private all: RecentEntry[] = [];
  private current = '';
  private loaded = false;

  constructor(private readonly d: HomeFilesDeps, private readonly opts: { kind: Kind; limit?: number; compact?: boolean; onCount?: (n: number) => void }) {
    if (opts.compact) this.prefs.view = 'list';
    setClass(this.root, 'is-compact', !!opts.compact);
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.cv-hf-view'))) {
      b.addEventListener('click', () => { this.prefs.view = b.dataset.view as View; this.save(); this.chrome(); });
    }
    this.sort.value = this.prefs.sort;
    this.sort.addEventListener('change', () => { this.prefs.sort = this.sort.value as Sort; this.save(); this.render(); });
    this.filter.addEventListener('input', () => this.render());
    this.items.addEventListener('click', (e) => {
      const target = e.target as HTMLElement, row = target.closest<HTMLElement>('.cv-hf-item');
      const path = row?.dataset.key;
      if (!path) return;
      if (target.closest('.cv-hf-remove')) { this.d.forget(path); return; }
      if (target.closest('.cv-hf-open')) this.d.open(path);
    });
    this.chrome();
    this.render();
  }

  private save(): void {
    try {
      const keep = readPrefs();
      localStorage.setItem(PREFS, JSON.stringify({ sort: this.prefs.sort, view: this.opts.compact ? keep.view : this.prefs.view }));
    } catch {
      return;
    }
  }

  private chrome(): void {
    for (const b of Array.from(this.root.querySelectorAll<HTMLElement>('.cv-hf-view'))) {
      const on = b.dataset.view === this.prefs.view;
      setClass(b, 'is-active', on);
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
    }
    setClass(this.root, 'is-list', this.prefs.view === 'list');
  }

  setEntries(entries: readonly RecentEntry[], current: string): void {
    this.loaded = true;
    this.current = current;
    this.all = this.opts.kind === 'workspaces' ? entries.filter((e) => e.formRepo || e.path === current) : [...entries];
    this.opts.onCount?.(this.all.length);
    this.render();
  }

  private render(): void {
    const f = this.filter.value.trim().toLowerCase();
    const shown = this.all.filter((e) => !f || e.name.toLowerCase().includes(f) || e.path.toLowerCase().includes(f));
    if (this.prefs.sort === 'name') shown.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    else shown.sort((a, b) => (Date.parse(b.opened) || 0) - (Date.parse(a.opened) || 0));
    if (this.opts.limit) shown.splice(this.opts.limit);
    patchList(this.items, shown, { key: (e) => e.path, create: (e) => this.row(e), update: (n, e) => this.fillRow(n, e) });
    const none = this.all.length === 0
      ? (this.opts.kind === 'recent' ? t('Folders you open appear here.') : t('Form repositories you open appear here.'))
      : t('No folders match the filter.');
    setText(this.empty, none);
    setHidden(this.empty, !this.loaded || shown.length > 0);
  }

  private row(e: RecentEntry): HTMLElement {
    const n = el(`<div class="cv-hf-item" role="listitem">
      <button class="cv-hf-open" type="button"><span class="cv-hf-thumb"><span class="cv-hf-glyph">${icon('folder', 22)}</span></span><span class="cv-hf-name"></span><span class="cv-hf-kind"></span><span class="cv-hf-when"></span><span class="cv-hf-badge" hidden>${t('Form repo')}</span></button>
      <button class="cv-hf-remove" type="button" title="${t('Remove from Recent')}" aria-label="${t('Remove from Recent')}">${icon('close', 12)}</button>
    </div>`);
    this.fillRow(n, e);
    return n;
  }

  private fillRow(n: HTMLElement, e: RecentEntry): void {
    setText(q(n, '.cv-hf-name'), e.name);
    setText(q(n, '.cv-hf-kind'), e.path);
    setText(q(n, '.cv-hf-when'), e.path === this.current ? t('Open now') : whenText(e.opened));
    setHidden(q(n, '.cv-hf-badge'), !e.formRepo);
    setTitle(q(n, '.cv-hf-open'), e.path);
    setClass(n, 'is-current', e.path === this.current);
  }
}
