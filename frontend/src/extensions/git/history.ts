import { git, type FileCommit, type FileLog } from '../../io/git';
import { Commands } from '../../ui/commands';
import { delayedIndicator, el, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { onLanguage, t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { PopupMenu } from '../../ui/menu';
import { toast } from '../../ui/toast';

export const OPEN_HISTORY = 'formsubstrate:open-history';
export const OPEN_DIFF = 'formsubstrate:open-diff';

const PAGE = 50;
const REFRESH_MAX = 500;

export const HISTORY_HTML = `<div class="cv-sc-hist" hidden>
<div class="cv-sc-hist-bar"><span class="cv-sc-hist-t"></span><span class="cv-sc-hist-file"></span><button class="cv-wb-tool cv-sc-hist-refresh" type="button">${icon('refresh', 14)}</button><button class="cv-wb-tool cv-sc-hist-close" type="button">${icon('close', 14)}</button></div>
<div class="cv-sc-hist-list" role="list" tabindex="-1"></div>
<p class="cv-sc-hist-empty cv-note" hidden></p>
<p class="cv-sc-hist-loading cv-note" hidden></p>
</div>`;

export interface HistoryHost {
  signature(letter: string): string;
}

interface Slot { key: string; commit: FileCommit | null }

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const ago = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return t('Just now');
  if (s < 3600) return `${Math.round(s / 60)} ${t('min ago')}`;
  if (s < 86400) return `${Math.round(s / 3600)} ${t('h ago')}`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} ${t('d ago')}`;
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
};

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

export class FileHistory {
  private readonly box: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly fileEl: HTMLElement;
  private readonly refreshBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly cmds = new Commands();
  private readonly menu: PopupMenu;
  private path = '';
  private session: string | null = null;
  private rows: FileCommit[] = [];
  private more = false;
  private folder = false;
  private known = false;
  private problem = '';
  private paging = false;
  private seq = 0;
  private picked: FileCommit | null = null;
  private menuPath = '';
  private menuSession: string | null = null;
  private frame = 0;

  constructor(host: HTMLElement, private readonly h: HistoryHost) {
    this.box = q(host, '.cv-sc-hist');
    this.list = q(this.box, '.cv-sc-hist-list');
    this.empty = q(this.box, '.cv-sc-hist-empty');
    this.loading = q(this.box, '.cv-sc-hist-loading');
    this.fileEl = q(this.box, '.cv-sc-hist-file');
    this.refreshBtn = q<HTMLButtonElement>(this.box, '.cv-sc-hist-refresh');
    this.closeBtn = q<HTMLButtonElement>(this.box, '.cv-sc-hist-close');
    this.menu = new PopupMenu(this.cmds, null, true);
    this.menu.panel.classList.add('cv-wb-context');
    this.cmds.add(
      { id: 'fh-open', label: 'Open Changes', enabled: () => !!this.picked, run: () => { if (this.picked) this.openDiff(this.picked); } },
      { id: 'fh-copy', label: 'Copy Commit Hash', enabled: () => !!this.picked, run: () => { if (this.picked) this.copy(this.picked.sha); } },
      { id: 'fh-file', label: 'Open File History', enabled: () => !!this.menuPath, run: () => { if (this.menuPath) this.open(this.menuPath, this.menuSession); } },
    );
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.menu.isOpen) this.menu.close(); });
    this.refreshBtn.addEventListener('click', () => { void this.reload(); });
    this.closeBtn.addEventListener('click', () => this.close());
    this.list.addEventListener('click', (e) => {
      const n = this.slotOf(e.target);
      if (!n) return;
      if (n.classList.contains('is-more')) { void this.loadMore(); return; }
      const c = this.commitOf(n);
      if (c) this.openDiff(c);
    });
    this.list.addEventListener('keydown', (e) => {
      const n = this.slotOf(e.target);
      if (!n || e.target !== n) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (n.classList.contains('is-more')) void this.loadMore();
        else { const c = this.commitOf(n); if (c) this.openDiff(c); }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = (e.key === 'ArrowDown' ? n.nextElementSibling : n.previousElementSibling) as HTMLElement | null;
        next?.focus();
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const c = this.commitOf(n);
        const r = n.getBoundingClientRect();
        if (c) this.rowMenu(c, r.left + r.width / 2, r.bottom);
      }
    });
    this.list.addEventListener('contextmenu', (e) => {
      const n = this.slotOf(e.target);
      const c = n ? this.commitOf(n) : null;
      if (!c) return;
      e.preventDefault();
      this.rowMenu(c, e.clientX, e.clientY);
    });
    onLanguage(() => this.paint());
    this.paint();
  }

  get isOpen(): boolean { return !this.box.hidden; }

  get file(): string { return this.path; }

  open(path: string, session: string | null): void {
    const same = path === this.path && session === this.session && this.isOpen;
    this.path = path;
    this.session = session;
    setHidden(this.box, false);
    this.box.scrollIntoView({ block: 'nearest' });
    if (same) { void this.reload(); return; }
    this.rows = [];
    this.more = false;
    this.folder = false;
    this.known = false;
    this.problem = '';
    this.list.scrollTop = 0;
    this.paint();
    void this.fetch(0, PAGE, true);
  }

  close(): void {
    this.seq += 1;
    this.path = '';
    this.rows = [];
    this.known = false;
    this.menu.close();
    setHidden(this.box, true);
  }

  fileMenu(path: string, session: string | null, x: number, y: number): void {
    this.picked = null;
    this.menuPath = path;
    this.menuSession = session;
    this.menu.setItems(['fh-file']);
    this.menu.openAt(x, y);
  }

  changed(): void {
    if (this.isOpen && this.path) void this.reload();
  }

  private rowMenu(c: FileCommit, x: number, y: number): void {
    this.picked = c;
    this.menuPath = '';
    this.menu.setItems(['fh-open', '-', 'fh-copy']);
    this.menu.openAt(x, y);
  }

  private copy(sha: string): void {
    void navigator.clipboard.writeText(sha).then(() => toast(t('Copied')), () => toast(t('Copy failed'), 'error'));
  }

  private openDiff(c: FileCommit): void {
    window.dispatchEvent(new CustomEvent(OPEN_DIFF, { detail: { path: c.path, staged: false, session: this.session, commit: c.sha, short: c.short } }));
  }

  private reload(): Promise<void> {
    return this.fetch(0, Math.min(REFRESH_MAX, Math.max(PAGE, this.rows.length)), true);
  }

  private async loadMore(): Promise<void> {
    if (this.paging || !this.more) return;
    await this.fetch(this.rows.length, PAGE, false);
  }

  private async fetch(skip: number, limit: number, replace: boolean): Promise<void> {
    const mine = ++this.seq;
    const path = this.path, session = this.session;
    if (!path) return;
    this.paging = !replace;
    this.schedule();
    const stop = replace && !this.known ? delayedIndicator(() => { setText(this.loading, t('Loading history')); setHidden(this.loading, false); }, () => setHidden(this.loading, true)) : () => undefined;
    try {
      const r: FileLog = await git.fileLog(path, { session, skip, limit });
      if (mine !== this.seq) return;
      this.rows = replace ? r.commits : [...this.rows, ...r.commits];
      this.more = r.more;
      this.folder = r.folder;
      this.problem = '';
    } catch (err) {
      if (mine !== this.seq) return;
      if (replace) { this.rows = []; this.more = false; }
      this.problem = message(err);
    } finally {
      stop();
      if (mine === this.seq) {
        this.known = true;
        this.paging = false;
        this.schedule();
      }
    }
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  private slotOf(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>('.cv-sc-hist-row') : null;
  }

  private commitOf(n: HTMLElement): FileCommit | null {
    const i = Number(n.dataset.slot);
    return Number.isInteger(i) && i >= 0 && i < this.rows.length ? this.rows[i] : null;
  }

  private paint(): void {
    setText(q(this.box, '.cv-sc-hist-t'), t('File History'));
    setText(this.fileEl, this.path ? baseName(this.path) : '');
    setTitle(this.fileEl, this.path);
    for (const [b, label] of [[this.refreshBtn, 'Refresh'], [this.closeBtn, 'Close File History']] as const) {
      setTitle(b, t(label));
      if (b.getAttribute('aria-label') !== t(label)) b.setAttribute('aria-label', t(label));
    }
    setDisabled(this.refreshBtn, !this.path);
    if (this.list.getAttribute('aria-label') !== t('File History')) this.list.setAttribute('aria-label', t('File History'));
    const slots: Slot[] = this.rows.map((commit, i) => ({ key: `s:${i}`, commit }));
    if (this.more) slots.push({ key: `s:${this.rows.length}`, commit: null });
    patchList(this.list, slots, {
      key: (s) => s.key,
      create: (s) => {
        const n = el(`<div class="cv-sc-hist-row" role="listitem" tabindex="0"><span class="cv-sc-hist-k"></span><div class="cv-sc-hist-main"><span class="cv-sc-hist-subj"></span><span class="cv-sc-hist-meta"><span class="cv-sc-hist-sha"></span><span class="cv-sc-hist-who"></span><span class="cv-sc-hist-when"></span><span class="cv-sc-hist-sig"></span></span></div><span class="cv-sc-hist-more"></span></div>`);
        this.fill(n, s);
        return n;
      },
      update: (n, s) => this.fill(n, s),
    });
    let note = '';
    if (this.known && !this.rows.length) {
      if (this.problem) note = this.problem;
      else if (this.folder) note = t('A folder has no file history. Choose a file.');
      else note = t('No history: this file has no commits or is not tracked by git.');
    }
    setText(this.empty, note);
    setHidden(this.empty, !note);
    setClass(this.empty, 'is-error', !!this.problem && !this.rows.length);
  }

  private fill(n: HTMLElement, s: Slot): void {
    const i = s.key.slice(2);
    if (n.dataset.slot !== i) n.dataset.slot = i;
    const c = s.commit;
    setClass(n, 'is-more', !c);
    if (!c) {
      setText(q(n, '.cv-sc-hist-more'), this.paging ? t('Loading...') : t('Load More'));
      setClass(n, 'is-busy', this.paging);
      setTitle(n, '');
      return;
    }
    setClass(n, 'is-busy', false);
    if (n.dataset.status !== c.status) n.dataset.status = c.status;
    setText(q(n, '.cv-sc-hist-k'), c.status);
    setText(q(n, '.cv-sc-hist-subj'), c.subject);
    setText(q(n, '.cv-sc-hist-sha'), c.short);
    setText(q(n, '.cv-sc-hist-who'), c.author);
    setText(q(n, '.cv-sc-hist-when'), ago(c.date));
    const sig = q(n, '.cv-sc-hist-sig');
    setText(sig, c.signature);
    setClass(sig, 'is-none', c.signature === 'N');
    setClass(sig, 'is-good', c.signature === 'G');
    setClass(sig, 'is-bad', c.signature === 'B' || c.signature === 'E');
    setTitle(sig, `${c.signature} · ${this.h.signature(c.signature)}`);
    const moved = c.oldPath ? `\n${c.oldPath} -> ${c.path}` : c.path !== this.path ? `\n${c.path}` : '';
    setTitle(n, `${c.sha}\n${c.author} <${c.email}>\n${new Date(c.date).toLocaleString()}${moved}`);
  }
}
