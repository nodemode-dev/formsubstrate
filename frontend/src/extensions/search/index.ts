import { detailOf, previewReplace, replaceInFiles, searchWorkspace, type ReplaceFile, type ReplacePreview, type ReplaceQuery, type SearchHit } from '../../io/workspace';
import { confirmAction } from '../../ui/dialogs';
import { el, patchList, pendingClass, q, setChecked, setClass, setDisabled, setHidden, setText, setTitle, type Disposer } from '../../ui/dom';
import { onLanguage, t, tn } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { toast } from '../../ui/toast';
import type { MountedDiff } from './preview-diff';
import { FOCUS_EVENT } from '../../ui/workbench';
import { register, registerSearchProvider, type ExtensionContext, type Shell, type SidebarSection } from '../registry';

const DEBOUNCE_MS = 180;
const LIMIT = 500;
const PALETTE_LIMIT = 40;
const TEXT_MAX = 240;
const REFUSALS_SHOWN = 3;

export const FILES_WRITTEN = 'formsubstrate:files-written';
export interface FilesWritten { paths: string[] }
const GIT_CHANGED = 'formsubstrate:git-changed';

interface Line {
  key: string;
  kind: 'file' | 'hit' | 'pfile' | 'phit' | 'pdiff';
  path: string;
  text: string;
  line: number;
  col: number;
  count: number;
  open: boolean;
  after?: string;
  checked?: boolean;
  blocked?: boolean;
}

type DiffData = { before: string; after: string } | { error: string } | 'loading';

const dirOf = (path: string): string => { const at = path.lastIndexOf('/'); return at < 0 ? '' : path.slice(0, at); };
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const clip = (s: string): string => (s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) : s).trim();

function splitChange(before: string, after: string): [string, string, string, string] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return [before.slice(0, head), before.slice(head, before.length - tail), after.slice(head, after.length - tail), before.slice(before.length - tail)];
}

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
  private readonly replace: HTMLInputElement;
  private readonly replaceAll: HTMLButtonElement;
  private readonly acts: HTMLElement;
  private readonly goBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private preview: ReplacePreview | null = null;
  private asked: ReplaceQuery | null = null;
  private previewSeq = 0;
  private writing = false;
  private readonly excluded = new Set<string>();
  private readonly diffOpen = new Set<string>();
  private readonly diffData = new Map<string, DiffData>();
  private readonly diffViews = new Map<string, MountedDiff>();
  private diffModule: Promise<typeof import('./preview-diff')> | null = null;
  private diffMod: typeof import('./preview-diff') | null = null;

  constructor(private readonly host: HTMLElement, private readonly ctx: ExtensionContext, private readonly shell: Shell) {
    host.append(el(
      '<div class="cv-search">' +
      '<div class="cv-search-bar"><input class="cv-input cv-search-q" type="text" spellcheck="false" autocomplete="off">' +
      '<button class="cv-search-tog" type="button" data-opt="regex">.*</button>' +
      '<button class="cv-search-tog" type="button" data-opt="case">Aa</button>' +
      `<button class="cv-search-tog" type="button" data-opt="glob">${icon('file', 14)}</button></div>` +
      '<div class="cv-search-bar cv-search-replrow"><input class="cv-input cv-search-r" type="text" spellcheck="false" autocomplete="off">' +
      `<button class="cv-search-tog cv-search-all" type="button">${icon('swap', 14)}</button></div>` +
      '<div class="cv-search-bar cv-search-globrow" hidden><input class="cv-input cv-search-glob" type="text" spellcheck="false" autocomplete="off"></div>' +
      '<div class="cv-search-count"><span class="cv-search-total"></span><span class="cv-search-trunc" hidden></span>' +
      '<span class="cv-search-acts" hidden><button class="cv-search-act cv-search-go" type="button"></button><button class="cv-search-act cv-search-cancel" type="button"></button></span></div>' +
      '<div class="cv-search-results" role="tree" tabindex="0"></div></div>'));
    this.input = q(host, '.cv-search-q');
    this.glob = q(host, '.cv-search-glob');
    this.globRow = q(host, '.cv-search-globrow');
    this.count = q(host, '.cv-search-total');
    this.note = q(host, '.cv-search-trunc');
    this.results = q(host, '.cv-search-results');
    this.replace = q(host, '.cv-search-r');
    this.replaceAll = q(host, '.cv-search-all');
    this.acts = q(host, '.cv-search-acts');
    this.goBtn = q(host, '.cv-search-go');
    this.cancelBtn = q(host, '.cv-search-cancel');
    this.toggles = {
      regex: q(host, '[data-opt="regex"]'),
      case: q(host, '[data-opt="case"]'),
      glob: q(host, '[data-opt="glob"]'),
    };
    this.bind();
    this.relabel();
    onLanguage(() => { this.relabel(); this.paintCount(); });
    ctx.store.on('workspace', () => this.reset());
    ctx.store.on('docs', () => { if (this.preview) { this.buildLines(); this.paintLines(); this.paintCount(); } });
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
    this.replace.placeholder = t('Replace');
    setTitle(this.replaceAll, t('Replace all'));
    if (this.replaceAll.getAttribute('aria-label') !== t('Replace all')) this.replaceAll.setAttribute('aria-label', t('Replace all'));
    setText(this.goBtn, t('Replace'));
    setText(this.cancelBtn, t('Cancel'));
  }

  private bind(): void {
    this.input.addEventListener('input', () => { this.leavePreview(); this.schedule(); });
    this.glob.addEventListener('input', () => { this.leavePreview(); this.schedule(); });
    this.replace.addEventListener('input', () => this.leavePreview());
    this.replace.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void this.startPreview(); }
      else if (e.key === 'Escape' && this.preview) { e.preventDefault(); this.leavePreview(); }
    });
    this.replaceAll.addEventListener('click', () => { void this.startPreview(); });
    this.goBtn.addEventListener('click', () => { void this.confirmReplace(); });
    this.cancelBtn.addEventListener('click', () => this.leavePreview());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.run(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.results.focus(); this.move(1); }
    });
    this.host.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.cv-search-tog[data-opt]') : null;
      if (!b) return;
      const opt = b.dataset.opt as 'regex' | 'case' | 'glob';
      this.flags[opt] = !this.flags[opt];
      setClass(b, 'is-on', this.flags[opt]);
      b.setAttribute('aria-pressed', String(this.flags[opt]));
      if (opt === 'glob') { setHidden(this.globRow, !this.flags.glob); if (this.flags.glob) this.glob.focus(); }
      this.leavePreview();
      this.schedule();
    });
    for (const b of Object.values(this.toggles)) b.setAttribute('aria-pressed', 'false');
    this.results.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const pick = target?.closest<HTMLInputElement>('.cv-search-pick');
      if (pick) {
        const row = pick.closest<HTMLElement>('.cv-search-row');
        const path = this.lines.find((l) => l.key === row?.dataset.key)?.path;
        if (path) { if (pick.checked) this.excluded.delete(path); else this.excluded.add(path); }
        this.buildLines();
        this.paintLines();
        this.paintCount();
        return;
      }
      const n = target?.closest<HTMLElement>('.cv-search-row');
      if (!n) return;
      this.selected = n.dataset.key ?? '';
      this.paintLines();
      this.activate(this.lines.find((l) => l.key === this.selected));
    });
    this.results.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this.activate(this.lines.find((l) => l.key === this.selected)); }
      else if (e.key === ' ' && this.preview) { e.preventDefault(); this.togglePick(this.lines.find((l) => l.key === this.selected)); }
      else if (e.key === 'Escape') { e.preventDefault(); if (this.preview) this.leavePreview(); else this.input.focus(); }
    });
  }

  private move(by: number): void {
    const rows = this.lines.filter((l) => l.kind !== 'pdiff');
    if (!rows.length) return;
    const at = rows.findIndex((l) => l.key === this.selected);
    const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? (by > 0 ? 0 : rows.length - 1) : at + by))];
    this.selected = next.key;
    this.paintLines();
    const node = Array.from(this.results.children).find((c) => (c as HTMLElement).dataset.key === next.key);
    node?.scrollIntoView({ block: 'nearest' });
  }

  private activate(l: Line | undefined): void {
    if (!l || l.kind === 'pdiff') return;
    if (l.kind === 'file') {
      if (this.collapsed.has(l.path)) this.collapsed.delete(l.path); else this.collapsed.add(l.path);
      this.buildLines();
      this.paintLines();
      return;
    }
    if (l.kind === 'pfile') {
      if (this.diffOpen.has(l.path)) this.diffOpen.delete(l.path); else { this.diffOpen.add(l.path); void this.loadDiff(l.path); }
      this.buildLines();
      this.paintLines();
      return;
    }
    this.shell.revealLine(l.path, l.line, l.col);
  }

  private togglePick(l: Line | undefined): void {
    if (!l || l.kind !== 'pfile' || l.blocked) return;
    if (this.excluded.has(l.path)) this.excluded.delete(l.path); else this.excluded.add(l.path);
    this.buildLines();
    this.paintLines();
    this.paintCount();
  }

  private query(): ReplaceQuery {
    return { q: this.input.value, regex: this.flags.regex, caseSensitive: this.flags.case, glob: this.flags.glob ? this.glob.value.trim() : '', replace: this.replace.value };
  }

  private dirty(path: string): boolean {
    return this.ctx.store.docs.some((d) => d.path === path && d.modified);
  }

  private chosen(): ReplaceFile[] {
    return (this.preview?.files ?? []).filter((f) => !this.excluded.has(f.path) && !this.dirty(f.path));
  }

  private async startPreview(): Promise<void> {
    if (this.writing) return;
    const asked = this.query();
    if (!asked.q.trim() || !this.ctx.store.workspace) return;
    window.clearTimeout(this.timer);
    this.abort?.abort();
    this.abort = null;
    this.pending?.();
    const seq = ++this.previewSeq;
    const stop = pendingClass(this.results);
    this.pending = stop;
    try {
      const res = await previewReplace(asked, { limit: LIMIT });
      if (seq !== this.previewSeq) return;
      this.error = '';
      if (!res.files.length) {
        this.leavePreview();
        this.hits = [];
        this.ran = true;
        this.engine = res.engine;
        this.truncated = false;
      } else {
        this.dropDiffs();
        this.excluded.clear();
        this.preview = res;
        this.asked = asked;
        this.engine = res.engine;
      }
    } catch (err) {
      if (seq !== this.previewSeq) return;
      this.error = detailOf(err);
    } finally {
      if (this.pending === stop) { stop(); this.pending = null; }
    }
    if (seq !== this.previewSeq) return;
    this.buildLines();
    this.paintLines();
    this.paintCount();
  }

  private leavePreview(): void {
    if (!this.preview) return;
    this.previewSeq++;
    this.preview = null;
    this.asked = null;
    this.excluded.clear();
    this.dropDiffs();
    this.buildLines();
    this.paintLines();
    this.paintCount();
  }

  private dropDiffs(): void {
    this.diffOpen.clear();
    this.diffData.clear();
  }

  private async loadDiff(path: string): Promise<void> {
    const asked = this.asked;
    if (!asked || this.diffData.has(path)) return;
    this.diffData.set(path, 'loading');
    const seq = this.previewSeq;
    this.diffModule ??= import('./preview-diff');
    let data: DiffData;
    try {
      const [res, mod] = await Promise.all([previewReplace(asked, { paths: [path], full: true }), this.diffModule]);
      this.diffMod = mod;
      const file = res.files[0];
      const known = this.preview?.files.find((f) => f.path === path);
      data = file && file.before !== undefined && file.after !== undefined && known && file.hash === known.hash
        ? { before: file.before, after: file.after }
        : { error: t('This file changed since the preview. Run Replace all again.') };
    } catch (err) {
      data = { error: detailOf(err) };
    }
    if (seq !== this.previewSeq) return;
    this.diffData.set(path, data);
    this.paintLines();
  }

  private async confirmReplace(): Promise<void> {
    const asked = this.asked;
    if (!asked || !this.preview || this.writing) return;
    const files = this.chosen();
    if (!files.length) { toast(t('Choose at least one file to replace in.'), 'info'); return; }
    const hits = files.reduce((n, f) => n + f.hits.reduce((m, h) => m + h.count, 0), 0);
    const ok = await confirmAction(
      t('Replace all'),
      `${tn(hits, '{n} replacement', '{n} replacements')} ${t('in')} ${tn(files.length, '{n} file', '{n} files')}. ${t('The files are written on disk now.')}`,
      t('Replace'), true, t('Cancel'));
    if (!ok || this.asked !== asked) return;
    const blocked = this.preview.files.filter((f) => !this.excluded.has(f.path) && this.dirty(f.path)).map((f) => f.path);
    const send = this.chosen();
    if (!send.length) { this.reportSkipped(blocked); return; }
    this.writing = true;
    this.paintCount();
    try {
      const reply = await replaceInFiles(asked, send.map((f) => ({ path: f.path, hash: f.hash, lines: f.hits.map((h) => h.line) })));
      const written = reply.results.filter((r) => r.status === 'written').map((r) => r.path);
      const refused = reply.results.filter((r) => r.status !== 'written');
      toast(`${t('Replaced in')} ${tn(written.length, '{n} file', '{n} files')}`, 'info');
      for (const r of refused.slice(0, REFUSALS_SHOWN)) toast(`${t('Not replaced')}: ${r.path}: ${r.reason ?? ''}`, 'error');
      if (refused.length > REFUSALS_SHOWN) toast(`${t('Not replaced')}: ${tn(refused.length - REFUSALS_SHOWN, '{n} more file', '{n} more files')}`, 'error');
      this.reportSkipped(blocked);
      if (written.length) {
        window.dispatchEvent(new CustomEvent<FilesWritten>(FILES_WRITTEN, { detail: { paths: written } }));
        window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: { session: null } }));
      }
    } catch (err) {
      toast(`${t('Replace failed')}: ${detailOf(err)}`, 'error');
    } finally {
      this.writing = false;
    }
    this.run();
  }

  private reportSkipped(paths: string[]): void {
    if (!paths.length) return;
    toast(`${t('Skipped, unsaved changes in an open tab')}: ${paths.map(baseOf).join(', ')}. ${t('Save or revert them, then replace again.')}`, 'info');
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
    this.previewSeq++;
    this.preview = null;
    this.asked = null;
    this.excluded.clear();
    this.dropDiffs();
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
    if (this.preview) { this.preview = null; this.asked = null; this.previewSeq++; this.excluded.clear(); this.dropDiffs(); }
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
    const out: Line[] = this.preview ? this.previewLines(this.preview) : [];
    const groups = new Map<string, SearchHit[]>();
    for (const h of this.preview ? [] : this.hits) {
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

  private previewLines(p: ReplacePreview): Line[] {
    const out: Line[] = [];
    for (const f of p.files) {
      const blocked = this.dirty(f.path);
      const checked = !blocked && !this.excluded.has(f.path);
      const open = this.diffOpen.has(f.path);
      const count = f.hits.reduce((n, h) => n + h.count, 0);
      out.push({ key: `p:f:${f.path}`, kind: 'pfile', path: f.path, text: baseOf(f.path), line: 0, col: 0, count, open, checked, blocked });
      if (open) out.push({ key: `p:d:${f.path}`, kind: 'pdiff', path: f.path, text: '', line: 0, col: 0, count: 0, open: true });
      for (const h of f.hits) out.push({ key: `p:h:${f.path}:${h.line}`, kind: 'phit', path: f.path, text: h.before, after: h.after, line: h.line, col: h.col, count: h.count, open: false, checked });
    }
    return out;
  }

  private rowHtml(l: Line, id: string): string {
    if (l.kind === 'file') return `<div class="cv-search-row cv-search-file" role="treeitem" id="${id}"><span class="cv-search-twist">${icon('chevronRight', 12)}</span><span class="cv-search-name"></span><span class="cv-search-dir"></span><span class="cv-search-n"></span></div>`;
    if (l.kind === 'pfile') return `<div class="cv-search-row cv-search-file cv-search-pfile" role="treeitem" id="${id}"><span class="cv-search-twist">${icon('chevronRight', 12)}</span><input class="cv-search-pick" type="checkbox" tabindex="-1"><span class="cv-search-name"></span><span class="cv-search-dir"></span><span class="cv-search-why" hidden></span><span class="cv-search-n"></span></div>`;
    if (l.kind === 'phit') return `<div class="cv-search-row cv-search-hit cv-search-phit" role="treeitem" id="${id}"><span class="cv-search-ln"></span><span class="cv-search-tx"><span class="cv-search-keep"></span><del class="cv-search-del"></del><ins class="cv-search-ins"></ins><span class="cv-search-keep"></span></span></div>`;
    if (l.kind === 'pdiff') return `<div class="cv-search-diffrow" role="none" id="${id}"><div class="cv-search-diffbox"></div><p class="cv-search-diffnote cv-note" hidden></p></div>`;
    return `<div class="cv-search-row cv-search-hit" role="treeitem" id="${id}"><span class="cv-search-ln"></span><span class="cv-search-tx"></span></div>`;
  }

  private paintLines(): void {
    patchList<Line>(this.results, this.lines, {
      key: (l) => l.key,
      create: (l) => {
        const id = `cv-sr-${++this.serial}`;
        this.ids.set(l.key, id);
        const n = el(this.rowHtml(l, id));
        this.paintRow(n, l);
        return n;
      },
      update: (n, l) => this.paintRow(n, l),
    });
    const live = new Set(this.lines.map((l) => l.key));
    for (const k of Array.from(this.ids.keys())) if (!live.has(k)) this.ids.delete(k);
    for (const [path, view] of Array.from(this.diffViews)) if (!live.has(`p:d:${path}`)) { view.destroy(); this.diffViews.delete(path); }
    const id = this.ids.get(this.selected) ?? '';
    if (id) { if (this.results.getAttribute('aria-activedescendant') !== id) this.results.setAttribute('aria-activedescendant', id); }
    else if (this.results.hasAttribute('aria-activedescendant')) this.results.removeAttribute('aria-activedescendant');
  }

  private paintRow(n: HTMLElement, l: Line): void {
    if (l.kind === 'pdiff') { this.paintDiff(n, l.path); return; }
    setClass(n, 'is-selected', l.key === this.selected);
    if (l.kind === 'file' || l.kind === 'pfile') {
      setText(q(n, '.cv-search-name'), l.text);
      setText(q(n, '.cv-search-dir'), dirOf(l.path));
      setText(q(n, '.cv-search-n'), String(l.count));
      setClass(n, 'is-open', l.open);
      setTitle(n, l.path);
    } else {
      setText(q(n, '.cv-search-ln'), String(l.line));
    }
    if (l.kind === 'hit') setText(q(n, '.cv-search-tx'), l.text);
    if (l.kind === 'pfile') {
      const pick = q<HTMLInputElement>(n, '.cv-search-pick');
      setChecked(pick, !!l.checked);
      setDisabled(pick, !!l.blocked);
      const label = l.blocked ? t('Unsaved changes in an open tab') : t('Include this file');
      if (pick.getAttribute('aria-label') !== label) pick.setAttribute('aria-label', label);
      const why = q(n, '.cv-search-why');
      setText(why, l.blocked ? t('Unsaved changes in an open tab') : '');
      setHidden(why, !l.blocked);
    }
    if (l.kind === 'phit') {
      const [head, gone, added, tail] = splitChange(l.text, l.after ?? l.text);
      const keep = n.querySelectorAll('.cv-search-keep');
      setText(keep[0], head);
      setText(q(n, '.cv-search-del'), gone);
      setText(q(n, '.cv-search-ins'), added);
      setText(keep[1], tail);
    }
    if (l.kind === 'pfile' || l.kind === 'phit') setClass(n, 'is-off', !l.checked);
  }

  private paintDiff(n: HTMLElement, path: string): void {
    const data = this.diffData.get(path);
    const box = q(n, '.cv-search-diffbox');
    const note = q(n, '.cv-search-diffnote');
    if (data && data !== 'loading' && 'before' in data && this.diffMod && !this.diffViews.has(path)) {
      this.diffViews.set(path, this.diffMod.mountDiff(box, path, data.before, data.after));
    }
    const text = !data || data === 'loading' ? t('Loading diff') : 'error' in data ? data.error : '';
    setText(note, text);
    setHidden(note, !text);
  }

  private paintCount(): void {
    let text = '';
    let note = '';
    const chosen = this.preview ? this.chosen() : [];
    if (this.error) text = this.error;
    else if (this.preview) {
      const n = chosen.reduce((a, f) => a + f.hits.reduce((m, h) => m + h.count, 0), 0);
      text = `${tn(n, '{n} replacement', '{n} replacements')} ${t('in')} ${tn(chosen.length, '{n} file', '{n} files')}`;
      if (this.preview.truncated) note = t('Only the listed matches are replaced.');
    } else if (this.ran) {
      const files = new Set(this.hits.map((h) => h.path)).size;
      text = this.hits.length
        ? `${tn(this.hits.length, '{n} result', '{n} results')} ${t('in')} ${tn(files, '{n} file', '{n} files')}${this.engine ? ` · ${this.engine}` : ''}`
        : `${t('No results')}${this.engine ? ` · ${this.engine}` : ''}`;
      if (this.truncated) note = t('Showing the first results. Narrow the search.');
    }
    setText(this.count, text);
    setClass(this.count, 'is-error', !!this.error);
    setText(this.note, note);
    setHidden(this.note, !note);
    setHidden(this.acts, !this.preview);
    setDisabled(this.goBtn, this.writing || !chosen.length);
    setDisabled(this.cancelBtn, this.writing);
    setDisabled(this.replaceAll, this.writing);
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
