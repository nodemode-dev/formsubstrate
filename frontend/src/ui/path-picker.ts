import { browseDir, type BrowseEntry, type BrowseListing } from '../io/workspace';
import { Dialog } from './dialogs';
import { el, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from './dom';
import { t } from './i18n';
import { icon } from './icons';
import { loadPrefs } from './prefs';

export type PickMode = 'folder' | 'file';

interface Crumb { label: string; path: string }

const PAGE_STEP = 8;
const TYPE_RESET_MS = 700;
const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;

function crumbsOf(path: string): Crumb[] {
  const win = /^[A-Za-z]:/.test(path) || path.includes('\\');
  const sep = win ? '\\' : '/';
  const parts = path.split(/[\\/]/).filter(Boolean);
  const out: Crumb[] = win ? [] : [{ label: '/', path: '/' }];
  parts.forEach((part, i) => {
    const joined = parts.slice(0, i + 1).join(sep);
    out.push({ label: part, path: win ? (i === 0 ? joined + sep : joined) : sep + joined });
  });
  return out;
}

class PathPicker extends Dialog {
  private readonly up = el<HTMLButtonElement>(`<button class="cv-icon-btn" type="button" data-pp="up">${icon('chevronLeft', 16)}</button>`);
  private readonly homeBtn = el<HTMLButtonElement>(`<button class="cv-icon-btn" type="button" data-pp="home">${icon('home', 16)}</button>`);
  private readonly crumbs = el('<div class="cv-pp-crumbs" role="navigation"></div>');
  private readonly hiddenToggle = el<HTMLInputElement>(`<input type="checkbox" aria-label="${t('Show hidden files')}">`);
  private readonly typed = el('<div class="cv-pp-typed" hidden><input class="cv-input" type="text" spellcheck="false" autocomplete="off" aria-label="Absolute path"><button class="cv-btn cv-btn-ghost" type="button" data-pp="go"></button></div>');
  private readonly typedInput = q<HTMLInputElement>(this.typed, 'input');
  private readonly list = el('<div class="cv-pp-list" role="listbox" tabindex="0"></div>');
  private readonly empty = el('<p class="cv-pp-empty" hidden></p>');
  private readonly status = el('<p class="cv-pp-status" role="status"></p>');
  private readonly choose: HTMLButtonElement;
  private mode: PickMode = 'folder';
  private listing: BrowseListing | null = null;
  private selected = '';
  private run = 0;
  private rowId = 0;
  private buffer = '';
  private bufferTimer = 0;
  private resolve: ((v: string | null) => void) | null = null;
  private last: Record<PickMode, string> = { folder: '', file: '' };

  constructor() {
    super('Open folder', 600);
    q<HTMLElement>(this.scrim, '.cv-dialog').classList.add('cv-pp');
    const bar = el('<div class="cv-pp-bar"></div>');
    const hiddenLabel = el('<label class="cv-pp-hidden"><span></span></label>');
    setText(q(hiddenLabel, 'span'), t('Hidden'));
    hiddenLabel.prepend(this.hiddenToggle);
    setTitle(this.up, t('Parent folder'));
    setTitle(this.homeBtn, t('Home folder'));
    this.up.setAttribute('aria-label', t('Parent folder'));
    this.homeBtn.setAttribute('aria-label', t('Home folder'));
    q<HTMLElement>(this.up, '.icon').style.transform = 'rotate(90deg)';
    bar.append(this.up, this.homeBtn, this.crumbs, hiddenLabel);
    setText(q(this.typed, 'button'), t('Go'));
    this.typedInput.placeholder = t('Type an absolute path and press Enter');
    const frame = el('<div class="cv-pp-frame"></div>');
    frame.append(this.list, this.empty);
    this.body.append(bar, this.typed, frame, this.status);
    this.button('Cancel', 'ghost', () => this.finish(null));
    this.choose = this.button('Open folder', 'primary', () => this.commit());

    this.up.addEventListener('click', () => this.goUp());
    this.homeBtn.addEventListener('click', () => { void this.load(this.listing?.home ?? ''); });
    this.hiddenToggle.addEventListener('change', () => { void this.load(this.listing?.path ?? ''); });
    this.crumbs.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-path]') : null;
      if (b?.dataset.path) void this.load(b.dataset.path);
    });
    this.typed.addEventListener('click', (e) => { if ((e.target as Element).closest('[data-pp="go"]')) void this.goTyped(); });
    this.typedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void this.goTyped(); } });
    this.list.addEventListener('click', (e) => {
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-pp-row') : null;
      if (row?.dataset.key) this.select(row.dataset.key, false);
    });
    this.list.addEventListener('dblclick', (e) => {
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-pp-row') : null;
      if (row?.dataset.key) this.activate(row.dataset.key);
    });
    this.list.addEventListener('keydown', (e) => this.key(e));
    this.onClose = () => this.finish(null);
  }

  async ask(mode: PickMode): Promise<string | null> {
    this.resolve?.(null);
    this.resolve = null;
    this.mode = mode;
    this.setTitle(mode === 'folder' ? 'Open folder' : 'Open file');
    setText(this.choose, t(mode === 'folder' ? 'Open folder' : 'Open file'));
    this.choose.dataset.en = mode === 'folder' ? 'Open folder' : 'Open file';
    this.choose.dataset.shown = this.choose.textContent ?? '';
    setHidden(this.typed, !loadPrefs().allowTypedPaths);
    this.selected = '';
    if (!(await this.load(this.last[mode], true)) && !(await this.load('', true))) return null;
    const done = new Promise<string | null>((resolve) => { this.resolve = resolve; });
    this.open(this.list);
    return done;
  }

  private finish(v: string | null): void {
    const done = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    done?.(v);
  }

  private commit(): void {
    if (this.mode === 'folder') {
      const dir = this.selected && this.entry(this.selected)?.kind === 'dir' ? this.selected : this.listing?.path ?? '';
      if (!dir) return;
      this.last.folder = this.listing?.path ?? '';
      this.finish(dir);
      return;
    }
    const e = this.selected ? this.entry(this.selected) : null;
    if (!e || e.kind !== 'file') return;
    this.last.file = this.listing?.path ?? '';
    this.finish(e.path);
  }

  private entry(path: string): BrowseEntry | undefined {
    return this.listing?.entries.find((x) => x.path === path);
  }

  private async goTyped(): Promise<void> {
    const v = this.typedInput.value.trim();
    if (v) await this.load(v);
  }

  private goUp(): void {
    const parent = this.listing?.parent;
    if (parent) void this.load(parent, false, this.listing?.path);
  }

  private async load(path: string, quiet = false, keep?: string): Promise<boolean> {
    const run = ++this.run;
    let listing: BrowseListing;
    try {
      listing = await browseDir(path, this.mode === 'file', this.hiddenToggle.checked);
    } catch (e) {
      if (run !== this.run) return false;
      const msg = e instanceof Error && e.message ? e.message.replace(/^\d{3}\s*/, '') : t('Could not read the folder.');
      if (!quiet || this.isOpen) { setText(this.status, msg); setClass(this.status, 'is-error', true); }
      return false;
    }
    if (run !== this.run) return false;
    this.listing = listing;
    this.selected = keep && listing.entries.some((x) => x.path === keep) ? keep : '';
    this.paint();
    return true;
  }

  private paint(): void {
    const l = this.listing;
    if (!l) return;
    patchList(this.crumbs, crumbsOf(l.path), {
      key: (c) => c.path,
      create: (c) => { const b = el<HTMLButtonElement>('<button class="cv-pp-crumb" type="button"></button>'); setText(b, c.label); b.dataset.path = c.path; return b; },
      update: (n, c) => { setText(n, c.label); n.dataset.path = c.path; },
    });
    const crumbButtons = Array.from(this.crumbs.children);
    crumbButtons.forEach((n, i) => setClass(n, 'is-last', i === crumbButtons.length - 1));
    this.crumbs.scrollLeft = this.crumbs.scrollWidth;
    patchList(this.list, l.entries, {
      key: (x) => x.path,
      create: (x) => {
        const n = el(`<div class="cv-pp-row" role="option"><span class="cv-pp-glyph">${icon(x.kind === 'dir' ? 'folder' : 'file', 16)}</span><span class="cv-pp-name"></span></div>`);
        setText(q(n, '.cv-pp-name'), x.name);
        n.id = `cv-pp-${(this.rowId += 1)}`;
        return n;
      },
      update: () => undefined,
    });
    this.markSelection(false);
    setDisabled(this.up, !l.parent);
    this.typedInput.value = l.path;
    setText(this.empty, t(this.mode === 'file' ? 'Nothing here.' : 'No subfolders.'));
    setHidden(this.empty, l.entries.length > 0);
    this.paintStatus();
  }

  private paintStatus(): void {
    const l = this.listing;
    if (!l) return;
    setClass(this.status, 'is-error', false);
    const e = this.selected ? this.entry(this.selected) : null;
    setText(this.status, e ? e.path : l.truncated ? `${l.path} · ${t('showing the first entries only')}` : l.path);
    const folder = this.mode === 'folder';
    setDisabled(this.choose, folder ? false : !(e && e.kind === 'file'));
  }

  private select(path: string, scroll: boolean): void {
    this.selected = path;
    this.markSelection(scroll);
    this.paintStatus();
  }

  private markSelection(scroll: boolean): void {
    let active = '';
    for (const n of Array.from(this.list.children) as HTMLElement[]) {
      const on = n.dataset.key === this.selected;
      setClass(n, 'is-sel', on);
      if (n.getAttribute('aria-selected') !== String(on)) n.setAttribute('aria-selected', String(on));
      if (on) { active = n.id; if (scroll) n.scrollIntoView({ block: 'nearest' }); }
    }
    if (active) this.list.setAttribute('aria-activedescendant', active); else this.list.removeAttribute('aria-activedescendant');
  }

  private activate(path: string): void {
    const e = this.entry(path);
    if (!e) return;
    if (e.kind === 'dir') void this.load(e.path);
    else if (this.mode === 'file') { this.selected = e.path; this.commit(); }
  }

  private move(to: number): void {
    const list = this.listing?.entries ?? [];
    if (!list.length) return;
    this.select(list[Math.max(0, Math.min(list.length - 1, to))].path, true);
  }

  private key(e: KeyboardEvent): void {
    const list = this.listing?.entries ?? [];
    const at = list.findIndex((x) => x.path === this.selected);
    const stop = (): void => { e.preventDefault(); };
    if (e.key.length !== 1) this.buffer = '';
    if (e.key === 'ArrowDown') { stop(); this.move(at + 1); }
    else if (e.key === 'ArrowUp') { stop(); this.move(at < 0 ? list.length - 1 : at - 1); }
    else if (e.key === 'PageDown') { stop(); this.move(at + PAGE_STEP); }
    else if (e.key === 'PageUp') { stop(); this.move(Math.max(0, at - PAGE_STEP)); }
    else if (e.key === 'Home') { stop(); this.move(0); }
    else if (e.key === 'End') { stop(); this.move(list.length - 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) { stop(); this.goUp(); }
    else if (e.key === 'ArrowRight' && at >= 0 && list[at].kind === 'dir') { stop(); this.activate(list[at].path); }
    else if (e.key === 'Enter') {
      stop();
      if (at >= 0) this.activate(list[at].path); else this.commit();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      window.clearTimeout(this.bufferTimer);
      this.buffer += e.key.toLowerCase();
      this.bufferTimer = window.setTimeout(() => { this.buffer = ''; }, TYPE_RESET_MS);
      const from = this.buffer.length > 1 ? Math.max(0, at) : at + 1;
      const hit = [...list.slice(from), ...list.slice(0, from)].find((x) => x.name.toLowerCase().startsWith(this.buffer));
      if (hit) { stop(); this.select(hit.path, true); }
    }
  }
}

let picker: PathPicker | null = null;

async function nativePick(mode: PickMode): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({ directory: mode === 'folder', multiple: false, title: t(mode === 'folder' ? 'Open folder' : 'Open file') });
  return typeof chosen === 'string' ? chosen : null;
}

export async function pickPath(mode: PickMode): Promise<string | null> {
  if (isTauri()) return nativePick(mode);
  picker ??= new PathPicker();
  return picker.ask(mode);
}
