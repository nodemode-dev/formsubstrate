import { deletePath, detailOf, listDir, makeDir, renamePath, writeFile, type DirEntry } from '../../io/workspace';
import { confirmAction, promptName } from '../../ui/dialogs';
import { el, patchList, q, setClass, setHidden, setStyleVar, setText, setTitle } from '../../ui/dom';
import { FOCUS_EVENT } from '../../ui/workbench';
import { Commands } from '../../ui/commands';
import { onLanguage, t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { PopupMenu } from '../../ui/menu';
import type { WorkspaceInfo } from '../../ui/workspace-store';
import { register, type ExtensionContext, type Shell } from '../registry';

export const PATHS_CHANGED = 'subform:paths-changed';

export interface PathsChanged { kind: 'delete' | 'rename'; from: string; to?: string }

interface Listing { entries: DirEntry[] | null; loading: boolean; error: string }

interface Row {
  key: string;
  path: string;
  name: string;
  kind: 'file' | 'dir' | 'note';
  depth: number;
  open: boolean;
  loading: boolean;
}

const OPEN_KEY = 'subform.files.open';
const OPEN_MAX = 500;
const ROOT = '';

const parentOf = (path: string): string => { const at = path.lastIndexOf('/'); return at < 0 ? ROOT : path.slice(0, at); };
const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

function loadOpen(ws: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(`${OPEN_KEY}:${ws}`) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, OPEN_MAX) : []);
  } catch {
    return new Set();
  }
}

function keepOpen(ws: string, open: Set<string>): void {
  try { localStorage.setItem(`${OPEN_KEY}:${ws}`, JSON.stringify([...open].slice(0, OPEN_MAX))); } catch { return; }
}

const byKind = (a: DirEntry, b: DirEntry): number => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) : a.kind === 'dir' ? -1 : 1);

class FilesTree {
  private readonly tree: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly label: HTMLElement;
  private readonly listings = new Map<string, Listing>();
  private readonly ids = new Map<string, string>();
  private readonly menu: PopupMenu;
  private readonly menuCommands = new Commands();
  private expanded = new Set<string>();
  private ws: WorkspaceInfo | null = null;
  private rows: Row[] = [];
  private selected = '';
  private target: { path: string; kind: 'file' | 'dir' | 'root' } = { path: ROOT, kind: 'root' };
  private generation = 0;
  private frame = 0;
  private serial = 0;

  constructor(host: HTMLElement, private readonly ctx: ExtensionContext, private readonly shell: Shell) {
    host.append(el(
      '<div class="cv-tree-pane"><div class="cv-tree-bar"><span class="cv-tree-ws"></span>' +
      `<button class="cv-wb-tool" type="button" data-act="new-file">${icon('newFile', 14)}</button>` +
      `<button class="cv-wb-tool" type="button" data-act="new-folder">${icon('newFolder', 14)}</button>` +
      `<button class="cv-wb-tool" type="button" data-act="refresh">${icon('refresh', 14)}</button></div>` +
      '<div class="cv-tree" role="tree" tabindex="0"></div>' +
      '<p class="cv-tree-empty cv-note"></p></div>'));
    this.tree = q(host, '.cv-tree');
    this.empty = q(host, '.cv-tree-empty');
    this.label = q(host, '.cv-tree-ws');
    this.menu = new PopupMenu(this.menuCommands, null, true);
    this.menu.panel.classList.add('cv-wb-context');
    this.defineMenu();
    this.bind(host);
    this.relabel(host);
    onLanguage(() => this.relabel(host));
    ctx.store.on('workspace', (ws) => this.switchTo(ws));
    ctx.store.on('active', () => this.queue());
    host.addEventListener(FOCUS_EVENT, () => this.tree.focus());
    this.switchTo(ctx.store.workspace);
  }

  private relabel(host: HTMLElement): void {
    const names: Record<string, string> = { 'new-file': 'New File', 'new-folder': 'New Folder', refresh: 'Refresh' };
    for (const b of Array.from(host.querySelectorAll<HTMLButtonElement>('.cv-wb-tool'))) {
      const label = t(names[b.dataset.act ?? ''] ?? '');
      setTitle(b, label);
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
    }
    if (this.tree.getAttribute('aria-label') !== t('Files')) this.tree.setAttribute('aria-label', t('Files'));
    this.paintHeader();
  }

  private paintHeader(): void {
    setText(this.label, this.ws?.name ?? t('No folder open'));
    setText(this.empty, t('Open a folder to see its files'));
    setHidden(this.empty, !!this.ws);
  }

  private switchTo(ws: WorkspaceInfo | null): void {
    if (ws && this.ws && ws.path === this.ws.path) { this.ws = ws; return; }
    this.ws = ws;
    this.generation += 1;
    this.listings.clear();
    this.selected = '';
    this.expanded = ws ? loadOpen(ws.path) : new Set();
    this.paintHeader();
    this.render();
    if (ws) void this.load(ROOT);
  }

  private async load(dir: string): Promise<void> {
    const gen = this.generation;
    const had = this.listings.get(dir);
    const slot: Listing = { entries: had?.entries ?? null, loading: true, error: '' };
    this.listings.set(dir, slot);
    if (!had?.entries) this.queue();
    try {
      const res = await listDir(dir);
      if (gen !== this.generation) return;
      this.listings.set(dir, { entries: [...res.entries].sort(byKind), loading: false, error: '' });
    } catch (err) {
      if (gen !== this.generation) return;
      this.listings.set(dir, { entries: had?.entries ?? null, loading: false, error: detailOf(err) });
    }
    this.render();
  }

  private flatten(): Row[] {
    const out: Row[] = [];
    const walk = (dir: string, depth: number): void => {
      const list = this.listings.get(dir);
      if (!list) return;
      if (list.entries) {
        if (!list.entries.length) out.push({ key: `n:${dir}:empty`, path: dir, name: t('Empty folder'), kind: 'note', depth, open: false, loading: false });
        for (const e of list.entries) {
          const isDir = e.kind === 'dir', open = isDir && this.expanded.has(e.path);
          out.push({ key: `${isDir ? 'd' : 'f'}:${e.path}`, path: e.path, name: e.name, kind: e.kind, depth, open, loading: open && (this.listings.get(e.path)?.loading ?? false) });
          if (open) {
            if (!this.listings.has(e.path)) void this.load(e.path);
            walk(e.path, depth + 1);
          }
        }
      }
      if (list.error) out.push({ key: `n:${dir}:error`, path: dir, name: list.error, kind: 'note', depth, open: false, loading: false });
    };
    walk(ROOT, 0);
    return out;
  }

  private queue(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }

  private render(): void {
    this.rows = this.ws ? this.flatten() : [];
    const current = this.ctx.store.active?.path ?? '';
    patchList<Row>(this.tree, this.rows, {
      key: (r) => r.key,
      create: (r) => {
        const isDir = r.kind === 'dir', isNote = r.kind === 'note';
        const id = `cv-tree-${++this.serial}`;
        this.ids.set(r.key, id);
        const n = el(
          `<div class="cv-tree-row" role="${isNote ? 'none' : 'treeitem'}" id="${id}">` +
          `<span class="cv-tree-twist">${isDir ? icon('chevronRight', 12) : ''}</span>` +
          `<span class="cv-tree-ico">${isNote ? '' : icon(isDir ? 'folder' : 'file', 14)}</span>` +
          '<span class="cv-tree-name"></span></div>');
        n.dataset.path = r.path;
        n.dataset.kind = r.kind;
        setClass(n, 'is-dir', isDir);
        setClass(n, 'is-note', isNote);
        this.paint(n, r, current);
        return n;
      },
      update: (n, r) => this.paint(n, r, current),
    });
    const live = new Set(this.rows.map((r) => r.key));
    for (const k of Array.from(this.ids.keys())) if (!live.has(k)) this.ids.delete(k);
    const active = this.rows.find((r) => r.kind !== 'note' && r.path === this.selected);
    const activeId = active ? (this.ids.get(active.key) ?? '') : '';
    if (activeId) { if (this.tree.getAttribute('aria-activedescendant') !== activeId) this.tree.setAttribute('aria-activedescendant', activeId); }
    else if (this.tree.hasAttribute('aria-activedescendant')) this.tree.removeAttribute('aria-activedescendant');
  }

  private paint(n: HTMLElement, r: Row, current: string): void {
    setText(q(n, '.cv-tree-name'), r.name);
    setStyleVar(n, '--depth', String(r.depth));
    setClass(n, 'is-open', r.open);
    setClass(n, 'is-loading', r.loading);
    setClass(n, 'is-selected', r.kind !== 'note' && r.path === this.selected);
    setClass(n, 'is-current', r.kind === 'file' && r.path === current);
    if (r.kind === 'dir') {
      const v = String(r.open);
      if (n.getAttribute('aria-expanded') !== v) n.setAttribute('aria-expanded', v);
    }
    if (r.kind !== 'note') setTitle(n, r.path);
  }

  private rowOf(e: Event): HTMLElement | null {
    return e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-tree-row:not(.is-note)') : null;
  }

  private select(path: string): void {
    if (this.selected === path) return;
    this.selected = path;
    this.render();
    const row = Array.from(this.tree.children).find((c) => (c as HTMLElement).dataset.path === path && !c.classList.contains('is-note'));
    row?.scrollIntoView({ block: 'nearest' });
  }

  private setOpen(path: string, open: boolean): void {
    if (!this.ws || this.expanded.has(path) === open) return;
    if (open) this.expanded.add(path); else this.expanded.delete(path);
    keepOpen(this.ws.path, this.expanded);
    this.render();
  }

  private activate(row: Row): void {
    if (row.kind === 'dir') this.setOpen(row.path, !row.open);
    else if (row.kind === 'file') this.shell.openEditorTab(row.path);
  }

  private bind(host: HTMLElement): void {
    this.tree.addEventListener('click', (e) => {
      const n = this.rowOf(e);
      if (!n) return;
      const path = n.dataset.path ?? '';
      this.select(path);
      const row = this.rows.find((r) => r.kind !== 'note' && r.path === path);
      if (row) this.activate(row);
    });
    this.tree.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const n = this.rowOf(e);
      if (n) {
        this.select(n.dataset.path ?? '');
        this.showMenu(e.clientX, e.clientY, { path: n.dataset.path ?? '', kind: n.dataset.kind === 'dir' ? 'dir' : 'file' });
      } else {
        this.showMenu(e.clientX, e.clientY, { path: ROOT, kind: 'root' });
      }
    });
    this.tree.addEventListener('keydown', (e) => this.onKey(e));
    host.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.cv-wb-tool') : null;
      if (!b || !this.ws) return;
      const act = b.dataset.act;
      if (act === 'refresh') void this.refreshAll();
      else if (act === 'new-file') void this.create('file', this.containing());
      else if (act === 'new-folder') void this.create('dir', this.containing());
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.menu.isOpen) this.menu.close(); });
  }

  private containing(): string {
    const row = this.rows.find((r) => r.kind !== 'note' && r.path === this.selected);
    if (!row) return ROOT;
    return row.kind === 'dir' ? row.path : parentOf(row.path);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const list = this.rows.filter((r) => r.kind !== 'note');
    const at = list.findIndex((r) => r.path === this.selected);
    const cur = at >= 0 ? list[at] : null;
    const go = (r: Row | undefined): void => { if (r) this.select(r.path); };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(list[Math.min(list.length - 1, at + 1)]); break;
      case 'ArrowUp': e.preventDefault(); go(list[Math.max(0, at < 0 ? 0 : at - 1)]); break;
      case 'Home': e.preventDefault(); go(list[0]); break;
      case 'End': e.preventDefault(); go(list[list.length - 1]); break;
      case 'ArrowRight':
        e.preventDefault();
        if (!cur) go(list[0]);
        else if (cur.kind === 'dir' && !cur.open) this.setOpen(cur.path, true);
        else if (cur.kind === 'dir') go(list[at + 1]?.depth === cur.depth + 1 ? list[at + 1] : undefined);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (!cur) break;
        if (cur.kind === 'dir' && cur.open) this.setOpen(cur.path, false);
        else if (cur.depth > 0) go(list.find((r) => r.path === parentOf(cur.path) && r.kind === 'dir'));
        break;
      case 'Enter': e.preventDefault(); if (cur) this.activate(cur); break;
      case 'F2': if (cur) { e.preventDefault(); void this.rename({ path: cur.path, kind: cur.kind === 'dir' ? 'dir' : 'file' }); } break;
      case 'Delete': if (cur) { e.preventDefault(); void this.remove({ path: cur.path, kind: cur.kind === 'dir' ? 'dir' : 'file' }); } break;
      case 'ContextMenu': {
        e.preventDefault();
        const node = Array.from(this.tree.children).find((c) => (c as HTMLElement).dataset.path === this.selected && !c.classList.contains('is-note'));
        const box = (node ?? this.tree).getBoundingClientRect();
        this.showMenu(box.left + box.width / 2, box.bottom, cur ? { path: cur.path, kind: cur.kind === 'dir' ? 'dir' : 'file' } : { path: ROOT, kind: 'root' });
        break;
      }
      default: break;
    }
  }

  private defineMenu(): void {
    const notRoot = (): boolean => this.target.kind !== 'root';
    this.menuCommands.add(
      { id: 'ft-new-file', label: 'New File...', run: () => { void this.create('file', this.targetDir()); } },
      { id: 'ft-new-folder', label: 'New Folder...', run: () => { void this.create('dir', this.targetDir()); } },
      { id: 'ft-rename', label: 'Rename...', enabled: notRoot, run: () => { void this.rename(this.target); } },
      { id: 'ft-delete', label: 'Delete', enabled: notRoot, run: () => { void this.remove(this.target); } },
    );
  }

  private targetDir(): string {
    return this.target.kind === 'file' ? parentOf(this.target.path) : this.target.path;
  }

  private showMenu(x: number, y: number, target: { path: string; kind: 'file' | 'dir' | 'root' }): void {
    this.target = target;
    this.menu.setItems(target.kind === 'root' ? ['ft-new-file', 'ft-new-folder'] : ['ft-new-file', 'ft-new-folder', '-', 'ft-rename', 'ft-delete']);
    this.menu.openAt(x, y);
  }

  private fail(err: unknown): void {
    this.shell.setStatus(detailOf(err), 'error');
  }

  private validName(name: string | null): string {
    const n = (name ?? '').trim();
    if (!n) return '';
    if (/[\\/]/.test(n) || n === '.' || n === '..') {
      this.shell.setStatus(t('A name cannot contain a slash.'), 'error');
      return '';
    }
    return n;
  }

  private async create(kind: 'file' | 'dir', dir: string): Promise<void> {
    if (!this.ws) return;
    const name = this.validName(await promptName(kind === 'file' ? t('New File') : t('New Folder'), '', t('Create')));
    if (!name) return;
    const path = joinPath(dir, name);
    try {
      if (kind === 'file') await writeFile(path, '', null); else await makeDir(path);
    } catch (err) {
      this.fail(err);
      return;
    }
    if (dir !== ROOT) this.setOpen(dir, true);
    await this.load(dir);
    this.select(path);
    if (kind === 'file') this.shell.openEditorTab(path);
  }

  private async rename(target: { path: string; kind: 'file' | 'dir' | 'root' }): Promise<void> {
    if (target.kind === 'root') return;
    const name = this.validName(await promptName(t('Rename'), baseOf(target.path), t('Rename')));
    if (!name || name === baseOf(target.path)) return;
    const to = joinPath(parentOf(target.path), name);
    try {
      await renamePath(target.path, to);
    } catch (err) {
      this.fail(err);
      return;
    }
    this.forget(target.path, to);
    window.dispatchEvent(new CustomEvent<PathsChanged>(PATHS_CHANGED, { detail: { kind: 'rename', from: target.path, to } }));
    await this.load(parentOf(target.path));
    this.select(to);
  }

  private async remove(target: { path: string; kind: 'file' | 'dir' | 'root' }): Promise<void> {
    if (target.kind === 'root') return;
    const what = target.kind === 'dir' ? t('the folder and everything in it') : t('the file');
    if (!(await confirmAction(t('Delete'), `${baseOf(target.path)}: ${what}?`, t('Delete'), true))) return;
    try {
      await deletePath(target.path);
    } catch (err) {
      this.fail(err);
      return;
    }
    this.forget(target.path);
    window.dispatchEvent(new CustomEvent<PathsChanged>(PATHS_CHANGED, { detail: { kind: 'delete', from: target.path } }));
    if (this.selected === target.path || this.selected.startsWith(`${target.path}/`)) this.selected = '';
    await this.load(parentOf(target.path));
  }

  private forget(path: string, to?: string): void {
    if (!this.ws) return;
    const inside = (p: string): boolean => p === path || p.startsWith(`${path}/`);
    for (const k of Array.from(this.listings.keys())) if (inside(k)) this.listings.delete(k);
    const next = new Set<string>();
    for (const p of this.expanded) {
      if (!inside(p)) next.add(p);
      else if (to) next.add(to + p.slice(path.length));
    }
    this.expanded = next;
    keepOpen(this.ws.path, next);
  }

  private async refreshAll(): Promise<void> {
    const dirs = [ROOT, ...Array.from(this.listings.keys()).filter((k) => k !== ROOT && this.expanded.has(k))];
    await Promise.all(dirs.map((d) => this.load(d)));
  }
}

register({
  id: 'files',
  name: 'Files',
  description: 'The folder tree of the open workspace.',
  required: true,
  setup(ctx, shell) {
    shell.sidebarSection({
      id: 'files',
      title: 'Files',
      icon: 'files',
      render: (host) => { new FilesTree(host, ctx, shell); },
    });
  },
});
