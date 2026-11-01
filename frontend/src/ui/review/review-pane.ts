import { formslotState } from '../../io/formslot';
import { git, type FileReview, type FlaggedCommit, type Hunk, type Review } from '../../io/git';
import { sessionsClient } from '../../io/sessions';
import { detailOf, statusOf } from '../../io/workspace';
import { confirmAction } from '../dialogs';
import { delayedIndicator, el, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from '../dom';
import { baseName } from '../editor/languages';
import { onLanguage, t } from '../i18n';
import { icon } from '../icons';
import { toast } from '../toast';
import { GIT_CHANGED } from './diff-view';
import { paintProvenance, PROVENANCE_HTML } from './provenance';
import type { EditorPrefs, ViewDoc } from './views';

export const OPEN_DIFF = 'subform:open-diff';
export const OPEN_REVIEW = 'subform:open-review';
export const FOCUS_COMMIT = 'subform:focus-commit';

const RELOAD_MS = 120;
const NOTICE_MS = 5000;
const MAX_LINES = 400;

const KIND_LABEL: Record<FileReview['kind'], string> = {
  modified: 'modified',
  added: 'added',
  deleted: 'deleted',
  renamed: 'renamed',
  untracked: 'untracked',
  conflicted: 'conflicted',
};

const statusIn = (err: unknown): number => {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' && s > 0 ? s : statusOf(err);
};

const SENT: Record<'terminal' | 'headless' | 'stored', string> = {
  terminal: 'Sent to the session terminal.',
  headless: 'Sent to the session: a follow-up run started.',
  stored: 'Stored on the session. It is not running, so nothing was sent.',
};

export class ReviewPane implements ViewDoc {
  readonly root = el<HTMLElement>(`<div class="cv-rv">
<div class="cv-rv-bar">
<div class="cv-rv-heading"><span class="cv-rv-title"></span><span class="cv-rv-target cv-note"></span></div>
<span class="cv-rv-summary cv-note"></span>
<div class="cv-rv-tools">
<button class="cv-wb-tool cv-rv-refresh" type="button">${icon('refresh', 14)}</button>
<button class="cv-btn cv-btn-primary cv-rv-all" type="button">${icon('check', 14)}<span class="cv-rv-all-t"></span></button>
</div>
</div>
<p class="cv-rv-notice" role="status"><span class="cv-rv-notice-t"></span><button class="cv-rv-fix" type="button" hidden></button></p>
<div class="cv-rv-list"></div>
<p class="cv-rv-empty cv-note"></p>
</div>`);
  private readonly title = q(this.root, '.cv-rv-title');
  private readonly target = q(this.root, '.cv-rv-target');
  private readonly summary = q(this.root, '.cv-rv-summary');
  private readonly notice = q(this.root, '.cv-rv-notice');
  private readonly noticeText = q(this.root, '.cv-rv-notice-t');
  private readonly fixBtn = q<HTMLButtonElement>(this.root, '.cv-rv-fix');
  private readonly list = q(this.root, '.cv-rv-list');
  private readonly empty = q(this.root, '.cv-rv-empty');
  private readonly refreshBtn = q<HTMLButtonElement>(this.root, '.cv-rv-refresh');
  private readonly allBtn = q<HTMLButtonElement>(this.root, '.cv-rv-all');
  private review: Review | null = null;
  private failed = '';
  private loadingNow = true;
  private readonly collapsed = new Set<string>();
  private readonly busy = new Set<string>();
  private readonly results = new Map<string, string>();
  private readonly open = new Set<string>();
  private seq = 0;
  private timer = 0;
  private noticeTimer = 0;
  private flagged: FlaggedCommit[] = [];
  private flash = '';
  private flashBad = false;
  private fixing = false;
  private readonly offSessions: () => void;
  private readonly offLanguage: () => void;
  private pending = false;
  private own = false;
  private disposed = false;
  private allBusy = false;
  private offDrift: () => void = () => undefined;
  private readonly onChanged = (e: Event): void => {
    if (this.own) return;
    const detail = (e as CustomEvent<{ session?: string | null }>).detail;
    if (detail && detail.session !== undefined && detail.session !== this.session) return;
    this.queueReload();
  };

  constructor(readonly session: string | null) {
    this.list.addEventListener('click', (e) => this.onClick(e));
    this.refreshBtn.addEventListener('click', () => { void this.load(); });
    this.allBtn.addEventListener('click', () => { void this.acceptAll(); });
    window.addEventListener(GIT_CHANGED, this.onChanged);
    this.fixBtn.addEventListener('click', () => { void this.fix(); });
    this.offSessions = sessionsClient.on('sessions', () => this.paintHead());
    this.offLanguage = onLanguage(() => this.paint());
    this.offDrift = formslotState.on('drift', () => this.provenance());
    this.paint();
    void this.load();
  }

  private provenance(): void {
    for (const n of Array.from(this.list.children) as HTMLElement[]) paintProvenance(q(n, '.cv-fs-prov'), n.dataset.key ?? '');
  }

  activate(): void {
    if (this.pending) { this.pending = false; void this.load(); }
  }

  setOptions(o: EditorPrefs): void {
    void o;
  }

  async save(): Promise<boolean> {
    return false;
  }

  dispose(): void {
    this.disposed = true;
    this.offDrift();
    window.clearTimeout(this.timer);
    window.clearTimeout(this.noticeTimer);
    window.removeEventListener(GIT_CHANGED, this.onChanged);
    this.offSessions();
    this.offLanguage();
  }

  private queueReload(): void {
    if (this.disposed) return;
    if (this.root.hidden) { this.pending = true; return; }
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.load(); }, RELOAD_MS);
  }

  async load(): Promise<void> {
    const mine = ++this.seq;
    const stop = delayedIndicator(() => { this.loadingNow = true; this.paintEmpty(); }, () => { this.loadingNow = false; this.paintEmpty(); });
    try {
      const [r, flagged] = await Promise.all([git.review(this.session), this.session ? git.audit(this.session).catch(() => null) : Promise.resolve([] as FlaggedCommit[])]);
      if (mine !== this.seq || this.disposed) return;
      this.review = r;
      if (flagged) this.flagged = flagged;
      this.failed = '';
    } catch (err) {
      if (mine !== this.seq || this.disposed) return;
      this.failed = detailOf(err);
    } finally {
      stop();
    }
    this.loadingNow = false;
    this.paint();
    void formslotState.ensureDrift();
  }

  private say(text: string, kind: 'info' | 'error' = 'info'): void {
    this.flash = text;
    this.flashBad = kind === 'error';
    window.clearTimeout(this.noticeTimer);
    if (text) this.noticeTimer = window.setTimeout(() => { this.flash = ''; this.paintNotice(); }, NOTICE_MS);
    this.paintNotice();
  }

  private flagText(): string {
    const first = this.flagged[0];
    if (!first) return '';
    const more = this.flagged.length > 1 ? ` (+${this.flagged.length - 1} ${t('more')})` : '';
    return `${t('commit')} ${first.short} ${t('has a trailer or another identity')}${more}`;
  }

  private paintNotice(): void {
    const flag = this.flash ? '' : this.flagText();
    const text = this.flash || flag;
    setText(this.noticeText, text);
    setTitle(this.noticeText, flag ? this.flagged.map((c) => `${c.short} ${c.subject} · ${c.author}`).join('\n') : '');
    setClass(this.notice, 'is-error', this.flash ? this.flashBad : !!flag);
    setHidden(this.fixBtn, !flag);
    setText(this.fixBtn, t('Fix with Sign and Push'));
    setTitle(this.fixBtn, t('Re-sign and clean the unpushed commits, then push. History is only rewritten when you click.'));
    setDisabled(this.fixBtn, this.fixing || this.allBusy);
  }

  private async fix(): Promise<void> {
    if (this.fixing || !this.session) return;
    this.fixing = true;
    this.paintNotice();
    try {
      const r = await git.signAndPush({ session: this.session });
      this.say(r.check || (r.ok ? t('Pushed') : t('Refused')), r.ok ? 'info' : 'error');
    } catch (err) {
      this.say(detailOf(err), 'error');
    } finally {
      this.fixing = false;
      this.announce();
      void this.load();
    }
  }

  private announce(): void {
    this.own = true;
    try { window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: { session: this.session } })); } finally { this.own = false; }
  }

  private async apply(path: string, ids: string[], action: 'accept' | 'reject', key: string): Promise<boolean> {
    if (this.busy.has(key)) return false;
    this.busy.add(key);
    this.seq++;
    this.paint();
    try {
      const r = await git.hunks(path, ids, action, this.session);
      if (this.review) {
        const files = r.review ? this.review.files.map((f) => (f.path === path ? r.review as FileReview : f)) : this.review.files.filter((f) => f.path !== path);
        this.review = { ...this.review, files };
      }
      this.say(`${baseName(path)}: ${t(action === 'accept' ? 'accepted and staged' : 'rejected')} ${r.applied}`);
      this.announce();
      return true;
    } catch (err) {
      if (statusIn(err) === 409) {
        this.say(t('The file changed; its hunks were reloaded.'), 'error');
        await this.load();
      } else {
        this.say(detailOf(err), 'error');
      }
      return false;
    } finally {
      this.busy.delete(key);
      this.paint();
    }
  }

  private async acceptAll(): Promise<void> {
    const files = this.review?.files ?? [];
    if (this.allBusy || !files.length) return;
    this.allBusy = true;
    this.paint();
    let done = 0;
    try {
      for (const f of files) {
        const ok = await this.apply(f.path, ['*'], 'accept', `file:${f.path}`);
        if (!ok) return;
        done++;
      }
      toast(`${done} ${t(done === 1 ? 'file staged' : 'files staged')}`, 'info');
      window.dispatchEvent(new CustomEvent(FOCUS_COMMIT, { detail: { session: this.session } }));
    } finally {
      this.allBusy = false;
      this.paint();
    }
  }

  private onClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    const btn = target?.closest<HTMLElement>('[data-act]');
    const file = target?.closest<HTMLElement>('.cv-rv-file');
    if (!btn || !file || !this.list.contains(btn)) return;
    const path = file.dataset.key ?? '';
    const hunkNode = btn.closest<HTMLElement>('.cv-rv-hunk');
    const id = hunkNode?.dataset.key ?? '';
    const f = this.review?.files.find((x) => x.path === path);
    if (!f) return;
    switch (btn.dataset.act) {
      case 'toggle':
        if (this.collapsed.has(path)) this.collapsed.delete(path); else this.collapsed.add(path);
        this.paint();
        break;
      case 'open':
        window.dispatchEvent(new CustomEvent(OPEN_DIFF, { detail: { path, staged: false, session: this.session } }));
        break;
      case 'file-accept':
        void this.apply(path, ['*'], 'accept', `file:${path}`);
        break;
      case 'file-reject':
        void this.rejectFile(f);
        break;
      case 'hunk-accept':
        void this.apply(path, [id], 'accept', `hunk:${id}`);
        break;
      case 'hunk-reject':
        void this.apply(path, [id], 'reject', `hunk:${id}`);
        break;
      case 'hunk-comment':
        if (this.open.has(id)) this.open.delete(id); else this.open.add(id);
        this.paint();
        if (this.open.has(id)) hunkNode?.querySelector<HTMLTextAreaElement>('.cv-rv-text-in')?.focus();
        break;
      case 'comment-send': {
        const hunk = f.hunks.find((h) => h.id === id);
        const input = hunkNode?.querySelector<HTMLTextAreaElement>('.cv-rv-text-in');
        if (hunk && input) void this.comment(f, hunk, input);
        break;
      }
      default:
        break;
    }
  }

  private async rejectFile(f: FileReview): Promise<void> {
    const ok = await confirmAction(t('Reject changes'), `${f.path}: ${t('every change in this file is dropped from the working tree and the index. A snapshot is kept first.')}`, t('Reject'), true);
    if (!ok) return;
    await this.apply(f.path, f.hunks.length ? f.hunks.map((h) => h.id) : ['*'], 'reject', `file:${f.path}`);
  }

  private async comment(f: FileReview, hunk: Hunk, input: HTMLTextAreaElement): Promise<void> {
    const text = input.value.trim();
    const key = `comment:${hunk.id}`;
    if (!this.session || !text || this.busy.has(key)) return;
    this.busy.add(key);
    this.results.set(hunk.id, '');
    this.paint();
    try {
      const r = await git.comment(this.session, f.path, hunk.newStart, hunk.id, text);
      input.value = '';
      this.results.set(hunk.id, t(SENT[r.sent]));
    } catch (err) {
      this.results.set(hunk.id, detailOf(err));
    } finally {
      this.busy.delete(key);
      this.paint();
    }
  }

  private paintHead(): void {
    const s = this.session ? sessionsClient.get(this.session) : undefined;
    setText(this.title, t('Review changes'));
    setText(this.target, this.session ? (s?.title ?? this.session) : t('Workspace'));
  }

  private paintEmpty(): void {
    const files = this.review?.files.length ?? 0;
    const text = this.failed || (this.review ? (files ? '' : t('Nothing to review: no uncommitted changes.')) : this.loadingNow ? t('Loading changes') : '');
    setText(this.empty, text);
    setClass(this.empty, 'is-error', !!this.failed);
    setHidden(this.empty, !text);
  }

  private paint(): void {
    this.paintHead();
    const files = this.review?.files ?? [];
    let added = 0, removed = 0;
    for (const f of files) { added += f.added; removed += f.removed; }
    const snaps = this.review?.snapshots ?? 0;
    setText(this.summary, this.review ? [`${files.length} ${t(files.length === 1 ? 'file' : 'files')}`, `+${added} -${removed}`, snaps ? `${snaps} ${t(snaps === 1 ? 'snapshot' : 'snapshots')}` : ''].filter(Boolean).join(' · ') : '');
    setText(q(this.allBtn, '.cv-rv-all-t'), t('Accept all and commit'));
    setDisabled(this.allBtn, !files.length || this.allBusy);
    setTitle(this.allBtn, t('Stage every change, then commit with the message in Source Control. With an empty message the box is focused instead.'));
    this.paintNotice();
    setTitle(this.refreshBtn, t('Refresh'));
    if (this.refreshBtn.getAttribute('aria-label') !== t('Refresh')) this.refreshBtn.setAttribute('aria-label', t('Refresh'));
    patchList(this.list, files, {
      key: (f) => f.path,
      create: (f) => this.createFile(f),
      update: (n, f) => this.updateFile(n, f),
    });
    this.paintEmpty();
  }

  private createFile(f: FileReview): HTMLElement {
    const n = el(`<section class="cv-rv-file">
<div class="cv-rv-file-head">
<button class="cv-rv-chev" type="button" data-act="toggle">${icon('chevronDown', 14)}</button>
<span class="cv-rv-name"></span>
<span class="cv-rv-kind"></span>
<span class="cv-rv-counts"><span class="cv-rv-add"></span><span class="cv-rv-del"></span></span>
${PROVENANCE_HTML}
<div class="cv-rv-acts">
<button class="cv-rv-act" type="button" data-act="open">${icon('diff', 14)}</button>
<button class="cv-rv-act is-ok" type="button" data-act="file-accept">${icon('check', 14)}</button>
<button class="cv-rv-act is-bad" type="button" data-act="file-reject">${icon('close', 14)}</button>
</div>
</div>
<div class="cv-rv-hunks"></div>
<p class="cv-rv-nohunks cv-note"></p>
</section>`);
    this.updateFile(n, f);
    return n;
  }

  private label(btn: HTMLElement, text: string): void {
    setTitle(btn, text);
    if (btn.getAttribute('aria-label') !== text) btn.setAttribute('aria-label', text);
  }

  private updateFile(n: HTMLElement, f: FileReview): void {
    const collapsed = this.collapsed.has(f.path);
    const busy = this.busy.has(`file:${f.path}`) || this.allBusy;
    setText(q(n, '.cv-rv-name'), f.oldPath && f.oldPath !== f.path ? `${f.oldPath} → ${f.path}` : f.path);
    setTitle(q(n, '.cv-rv-name'), f.path);
    setText(q(n, '.cv-rv-kind'), t(KIND_LABEL[f.kind]));
    if (q(n, '.cv-rv-kind').dataset.kind !== f.kind) q(n, '.cv-rv-kind').dataset.kind = f.kind;
    setText(q(n, '.cv-rv-add'), `+${f.added}`);
    setText(q(n, '.cv-rv-del'), `-${f.removed}`);
    paintProvenance(q(n, '.cv-fs-prov'), f.path);
    setClass(n, 'is-collapsed', collapsed);
    this.label(q(n, '[data-act="toggle"]'), t(collapsed ? 'Expand' : 'Collapse'));
    this.label(q(n, '[data-act="open"]'), t('Open diff'));
    this.label(q(n, '[data-act="file-accept"]'), t('Accept file'));
    this.label(q(n, '[data-act="file-reject"]'), t('Reject file'));
    for (const b of Array.from(n.querySelectorAll<HTMLButtonElement>('.cv-rv-acts .cv-rv-act'))) setDisabled(b, busy && b.dataset.act !== 'open');
    setDisabled(q<HTMLButtonElement>(n, '[data-act="open"]'), f.binary || f.kind === 'deleted');
    const hunks = q(n, '.cv-rv-hunks');
    patchList(hunks, f.hunks, {
      key: (h) => h.id,
      create: (h) => this.createHunk(h, busy),
      update: (node, h) => this.updateHunk(node, h, busy),
    });
    setHidden(hunks, collapsed);
    const none = q(n, '.cv-rv-nohunks');
    setText(none, f.binary ? t('Binary file: accept or reject applies to the whole file.') : t('No line changes to show: accept or reject applies to the whole file.'));
    setHidden(none, collapsed || f.hunks.length > 0);
  }

  private createHunk(h: Hunk, fileBusy: boolean): HTMLElement {
    const n = el(`<article class="cv-rv-hunk">
<div class="cv-rv-hunk-head"><span class="cv-rv-hdr"></span>
<div class="cv-rv-acts">
<button class="cv-rv-act" type="button" data-act="hunk-comment">${icon('agentChat', 14)}</button>
<button class="cv-rv-act is-ok" type="button" data-act="hunk-accept">${icon('check', 14)}</button>
<button class="cv-rv-act is-bad" type="button" data-act="hunk-reject">${icon('close', 14)}</button>
</div></div>
<div class="cv-rv-code"></div>
<div class="cv-rv-comment" hidden>
<textarea class="cv-rv-text-in" rows="2" maxlength="2000"></textarea>
<div class="cv-rv-comment-row"><button class="cv-btn cv-rv-send" type="button" data-act="comment-send"></button><span class="cv-rv-result cv-note"></span></div>
</div>
</article>`);
    const code = q(n, '.cv-rv-code');
    const shown = h.lines.slice(0, MAX_LINES);
    const frag = document.createDocumentFragment();
    for (const line of shown) {
      const row = document.createElement('div');
      row.className = `cv-rv-line ${line.t === '+' ? 'is-add' : line.t === '-' ? 'is-del' : 'is-ctx'}`;
      const sign = document.createElement('span');
      sign.className = 'cv-rv-sign';
      sign.textContent = line.t === ' ' ? '' : line.t;
      const text = document.createElement('span');
      text.className = 'cv-rv-code-text';
      text.textContent = line.text;
      row.append(sign, text);
      frag.append(row);
    }
    if (h.lines.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'cv-rv-more cv-note';
      more.dataset.more = String(h.lines.length - shown.length);
      frag.append(more);
    }
    code.append(frag);
    this.updateHunk(n, h, fileBusy);
    return n;
  }

  private updateHunk(n: HTMLElement, h: Hunk, fileBusy: boolean): void {
    setText(q(n, '.cv-rv-hdr'), h.header);
    setTitle(q(n, '.cv-rv-hdr'), h.header);
    const busy = this.busy.has(`hunk:${h.id}`) || fileBusy;
    const acts = q(n, '.cv-rv-hunk-head');
    for (const b of Array.from(acts.querySelectorAll<HTMLButtonElement>('.cv-rv-act'))) setDisabled(b, busy);
    this.label(q(n, '[data-act="hunk-accept"]'), t('Accept hunk'));
    this.label(q(n, '[data-act="hunk-reject"]'), t('Reject hunk'));
    this.label(q(n, '[data-act="hunk-comment"]'), this.session ? t('Comment on this hunk') : t('Comments need a session'));
    setDisabled(q<HTMLButtonElement>(n, '[data-act="hunk-comment"]'), !this.session);
    const more = n.querySelector<HTMLElement>('.cv-rv-more');
    if (more) setText(more, `${more.dataset.more} ${t('more lines in the diff view')}`);
    const open = this.open.has(h.id) && !!this.session;
    const box = q(n, '.cv-rv-comment');
    setHidden(box, !open);
    const input = q<HTMLTextAreaElement>(box, '.cv-rv-text-in');
    if (input.placeholder !== t('Comment for the session')) input.placeholder = t('Comment for the session');
    const sending = this.busy.has(`comment:${h.id}`);
    if (input.disabled !== sending) input.disabled = sending;
    setText(q(box, '.cv-rv-send'), t('Send comment'));
    setDisabled(q<HTMLButtonElement>(box, '.cv-rv-send'), sending);
    setText(q(box, '.cv-rv-result'), sending ? t('Sending') : (this.results.get(h.id) ?? ''));
  }
}
