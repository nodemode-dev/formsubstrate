import { git, type Audit, type FlaggedCommit, type GitFile, type GitStatus, type Snapshot } from '../../io/git';
import { sessionsClient } from '../../io/sessions';
import { confirmAction } from '../../ui/dialogs';
import { el, mountOnce, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { onLanguage, t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { FOCUS_EVENT } from '../../ui/workbench';
import { register, type ExtensionContext, type Shell, type SidebarSection } from '../registry';

export const GIT_CHANGED = 'subform:git-changed';
export const OPEN_DIFF = 'subform:open-diff';
export const OPEN_REVIEW = 'subform:open-review';
export const GIT_SYNC = 'subform:git-sync';
export const FOCUS_COMMIT = 'subform:focus-commit';

export interface GitSync { branch: string; ahead: number; behind: number; upstream: string }

type Group = 'staged' | 'changes';

type Entry =
  | { key: string; kind: 'head'; group: Group; count: number }
  | { key: string; kind: 'row'; group: Group; file: GitFile };

const POLL_MS = 5000;

const GROUP_LABEL: Record<Group, string> = { staged: 'Staged Changes', changes: 'Changes' };

const SIGNATURE: Record<string, string> = {
  G: 'Good signature',
  U: 'Good signature, unknown validity',
  X: 'Good signature, expired',
  Y: 'Good signature, expired key',
  R: 'Good signature, revoked key',
  E: 'Cannot check the signature',
  B: 'Bad signature',
  N: 'Not signed',
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const letterOf = (f: GitFile, group: Group): string => {
  if (f.kind === 'conflicted') return '!';
  if (f.kind === 'untracked') return 'U';
  const c = group === 'staged' ? f.index : f.worktree;
  return c && c !== '.' && c !== '?' ? c : f.kind.charAt(0).toUpperCase();
};

const split = (path: string): { name: string; dir: string } => {
  const at = path.lastIndexOf('/');
  return at < 0 ? { name: path, dir: '' } : { name: path.slice(at + 1), dir: path.slice(0, at) };
};

const clock = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

interface Done { commit: string; summary: string; audit: Audit }

class GitPanel {
  private readonly target: HTMLSelectElement;
  private readonly msg: HTMLTextAreaElement;
  private readonly commitBtn: HTMLButtonElement;
  private readonly commitAllBtn: HTMLButtonElement;
  private readonly refreshBtn: HTMLButtonElement;
  private readonly reviewBtn: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly snapList: HTMLElement;
  private readonly snapCount: HTMLElement;
  private readonly snapEmpty: HTMLElement;
  private readonly takeBtn: HTMLButtonElement;
  private readonly branch: HTMLElement;
  private readonly ahead: HTMLElement;
  private readonly pushBtn: HTMLButtonElement;
  private readonly signPushBtn: HTMLButtonElement;
  private readonly check: HTMLElement;
  private readonly checkCard: HTMLElement;
  private readonly audit: HTMLElement;
  private readonly warn: HTMLElement;
  private readonly flagCard: HTMLElement;
  private readonly flagFix: HTMLButtonElement;
  private session: string | null = null;
  private status: GitStatus | null = null;
  private snaps: Snapshot[] = [];
  private done: Done | null = null;
  private problem = '';
  private checkText = '';
  private checkBad = false;
  private flagged: FlaggedCommit[] = [];
  private busy = false;
  private inflight = false;
  private again = false;
  private frame = 0;
  private lastBranch = '';

  constructor(private readonly host: HTMLElement, private readonly ctx: ExtensionContext, private readonly shell: Shell) {
    mountOnce(host, `<div class="cv-sc">
<div class="cv-sc-bar"><select class="cv-input cv-sc-target"></select><button class="cv-wb-tool cv-sc-review" type="button">${icon('diff', 14)}</button><button class="cv-wb-tool cv-sc-refresh" type="button">${icon('refresh', 14)}</button></div>
<div class="cv-sc-commit"><textarea class="cv-input cv-sc-msg" rows="3" spellcheck="true"></textarea><div class="cv-sc-btns"><button class="cv-btn cv-sc-commit-btn" type="button" data-act="commit">${icon('check', 14)}<span class="cv-sc-bt"></span></button><button class="cv-btn cv-sc-commit-all" type="button" data-act="commit-all">${icon('check', 14)}<span class="cv-sc-bt"></span></button></div></div>
<div class="cv-sc-body"><div class="cv-sc-list" role="list"></div><p class="cv-sc-empty cv-note"></p>
<div class="cv-sc-stack">
<div class="cv-sc-card cv-sc-checkcard" hidden><span class="cv-sc-check"></span><button class="cv-wb-tool cv-sc-dismiss" type="button" data-dismiss="check">${icon('close', 12)}</button></div>
<div class="cv-sc-card cv-sc-flagcard" hidden><div class="cv-sc-flag-main"><span class="cv-sc-flag-t"></span></div><button class="cv-btn cv-sc-flag-fix" type="button" data-act="fix">${icon('lock', 14)}<span class="cv-sc-bt"></span></button></div>
<div class="cv-sc-card cv-sc-audit" hidden>
<div class="cv-sc-audit-head"><span class="cv-sc-audit-t"></span><span class="cv-sc-audit-sha"></span><button class="cv-wb-tool cv-sc-dismiss" type="button" data-dismiss="audit">${icon('close', 12)}</button></div>
<div class="cv-sc-audit-row"><span class="cv-sc-audit-k" data-k="author"></span><span class="cv-sc-audit-v" data-f="author"></span></div>
<div class="cv-sc-audit-row"><span class="cv-sc-audit-k" data-k="committer"></span><span class="cv-sc-audit-v" data-f="committer"></span></div>
<div class="cv-sc-audit-row"><span class="cv-sc-audit-k" data-k="trailers"></span><span class="cv-sc-audit-v" data-f="trailers"></span></div>
<div class="cv-sc-audit-row"><span class="cv-sc-audit-k" data-k="signature"></span><span class="cv-sc-audit-v" data-f="signature"></span></div>
<p class="cv-sc-warn is-off">${icon('warning', 12)}<span class="cv-sc-warn-t"></span></p>
</div>
</div></div>
<div class="cv-sc-snaps"><div class="cv-sc-snaps-bar"><span class="cv-sc-snaps-t"></span><span class="cv-sc-snaps-n"></span><button class="cv-wb-tool cv-sc-take" type="button">${icon('add', 14)}</button></div><div class="cv-sc-snaplist" role="list"></div><p class="cv-sc-snaps-empty cv-note"></p></div>
<div class="cv-sc-foot">
<div class="cv-sc-meta">${icon('branch', 12)}<span class="cv-sc-branch"></span><span class="cv-sc-ahead"></span></div>
<div class="cv-sc-pushes"><button class="cv-btn cv-sc-push" type="button" data-act="push">${icon('upload', 14)}<span class="cv-sc-bt"></span></button><button class="cv-btn cv-sc-sign-push" type="button" data-act="sign-push">${icon('lock', 14)}<span class="cv-sc-bt"></span></button></div>
</div>
</div>`);
    this.target = q<HTMLSelectElement>(host, '.cv-sc-target');
    this.msg = q<HTMLTextAreaElement>(host, '.cv-sc-msg');
    this.commitBtn = q<HTMLButtonElement>(host, '.cv-sc-commit-btn');
    this.commitAllBtn = q<HTMLButtonElement>(host, '.cv-sc-commit-all');
    this.refreshBtn = q<HTMLButtonElement>(host, '.cv-sc-refresh');
    this.reviewBtn = q<HTMLButtonElement>(host, '.cv-sc-review');
    this.list = q(host, '.cv-sc-list');
    this.empty = q(host, '.cv-sc-empty');
    this.snapList = q(host, '.cv-sc-snaplist');
    this.snapCount = q(host, '.cv-sc-snaps-n');
    this.snapEmpty = q(host, '.cv-sc-snaps-empty');
    this.takeBtn = q<HTMLButtonElement>(host, '.cv-sc-take');
    this.branch = q(host, '.cv-sc-branch');
    this.ahead = q(host, '.cv-sc-ahead');
    this.pushBtn = q<HTMLButtonElement>(host, '.cv-sc-push');
    this.signPushBtn = q<HTMLButtonElement>(host, '.cv-sc-sign-push');
    this.check = q(host, '.cv-sc-check');
    this.checkCard = q(host, '.cv-sc-checkcard');
    this.audit = q(host, '.cv-sc-audit');
    this.warn = q(host, '.cv-sc-warn');
    this.flagCard = q(host, '.cv-sc-flagcard');
    this.flagFix = q<HTMLButtonElement>(host, '.cv-sc-flag-fix');

    this.target.addEventListener('change', () => this.retarget(this.target.value || null));
    this.refreshBtn.addEventListener('click', () => { void this.refresh(); });
    this.reviewBtn.addEventListener('click', () => this.review());
    this.takeBtn.addEventListener('click', () => { void this.snapshot(); });
    this.commitBtn.addEventListener('click', () => { void this.commit(false); });
    this.commitAllBtn.addEventListener('click', () => { void this.commit(true); });
    this.pushBtn.addEventListener('click', () => { void this.push(false); });
    this.signPushBtn.addEventListener('click', () => { void this.push(true); });
    this.flagFix.addEventListener('click', () => { void this.push(true); });
    this.msg.addEventListener('input', () => this.schedule());
    this.msg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !this.commitBtn.disabled) { e.preventDefault(); void this.commit(false); }
    });
    this.list.addEventListener('click', (e) => this.onList(e));
    host.addEventListener('click', (e) => {
      const which = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-sc-dismiss')?.dataset.dismiss : undefined;
      if (!which) return;
      if (which === 'audit') this.done = null;
      else this.checkText = '';
      this.schedule();
    });
    this.list.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-sc-row') : null;
      if (!row || e.target !== row) return;
      e.preventDefault();
      this.open(row.dataset.group === 'staged', row.dataset.path ?? '');
    });
    this.snapList.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.cv-sc-rewind') : null;
      const n = Number(b?.closest<HTMLElement>('.cv-sc-snap')?.dataset.n);
      if (b && Number.isFinite(n)) void this.rewind(n);
    });
    host.addEventListener(FOCUS_EVENT, () => { this.msg.focus(); void this.refresh(); });
    window.addEventListener(GIT_CHANGED, () => { void this.refresh(); });
    window.addEventListener('focus', () => { if (this.visible()) void this.refresh(); });
    sessionsClient.on('sessions', () => this.schedule());
    let root = ctx.store.workspace?.path ?? null;
    ctx.store.on('workspace', () => {
      const now = ctx.store.workspace?.path ?? null;
      if (now === root) { this.schedule(); return; }
      root = now;
      this.status = null; this.snaps = []; this.flagged = []; this.done = null; this.schedule(); void this.refresh();
    });
    new IntersectionObserver((records) => { if (records.some((r) => r.isIntersecting)) void this.refresh(); }).observe(host);
    window.setInterval(() => { if (this.visible() && document.hasFocus() && !document.hidden) void this.refresh(); }, POLL_MS);
    onLanguage(() => this.schedule());
    this.paint();
    void this.refresh();
  }

  private visible(): boolean { return this.host.getClientRects().length > 0; }

  focusMessage(): void { this.msg.focus(); }

  get hasMessage(): boolean { return this.msg.value.trim().length > 0; }

  get stagedCount(): number { return this.status?.files.filter((f) => f.staged).length ?? 0; }

  get fileCount(): number { return this.status?.files.length ?? 0; }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  private retarget(next: string | null): void {
    if (next === this.session) return;
    this.session = next;
    this.status = null;
    this.snaps = [];
    this.flagged = [];
    this.done = null;
    this.problem = '';
    this.checkText = '';
    this.paint();
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.inflight) { this.again = true; return; }
    this.inflight = true;
    const target = this.session;
    try {
      const [status, snaps, flagged] = await Promise.all([git.status(target), git.snapshots(target).catch(() => null), target ? git.audit(target).catch(() => null) : Promise.resolve([] as FlaggedCommit[])]);
      if (target !== this.session) return;
      this.status = status;
      if (snaps) this.snaps = snaps;
      if (flagged) this.flagged = flagged;
      this.problem = '';
      if (target === null) this.broadcast(status);
      else void git.status(null).then((s) => this.broadcast(s)).catch(() => undefined);
    } catch (err) {
      if (target === this.session) {
        this.problem = message(err);
        if (target === null) this.broadcast(null);
      }
    } finally {
      this.inflight = false;
      this.paint();
      if (this.again) { this.again = false; void this.refresh(); }
    }
  }

  private broadcast(s: GitStatus | null): void {
    const detail: GitSync = { branch: s?.branch ?? '', ahead: s?.ahead ?? 0, behind: s?.behind ?? 0, upstream: s?.upstream ?? '' };
    window.dispatchEvent(new CustomEvent<GitSync>(GIT_SYNC, { detail }));
    if (detail.branch && detail.branch !== this.lastBranch) {
      this.lastBranch = detail.branch;
      this.ctx.store.setBranch(detail.branch);
    }
  }

  private fire(): void {
    window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: { session: this.session } }));
  }

  private entries(): Entry[] {
    const files = this.status?.files ?? [];
    const staged = files.filter((f) => f.staged);
    const changes = files.filter((f) => f.unstaged || !f.staged);
    const out: Entry[] = [];
    if (staged.length) {
      out.push({ key: 'h:staged', kind: 'head', group: 'staged', count: staged.length });
      for (const file of staged) out.push({ key: `f:staged:${file.path}`, kind: 'row', group: 'staged', file });
    }
    if (changes.length) {
      out.push({ key: 'h:changes', kind: 'head', group: 'changes', count: changes.length });
      for (const file of changes) out.push({ key: `f:changes:${file.path}`, kind: 'row', group: 'changes', file });
    }
    return out;
  }

  private paint(): void {
    const entries = this.entries();
    patchList(this.list, entries, { key: (e) => e.key, create: (e) => this.create(e), update: (n, e) => this.update(n, e) });
    this.paintTargets();
    const st = this.status;
    setText(this.empty, this.problem && !st ? this.problem : t('No changes.'));
    setHidden(this.empty, entries.length > 0 || (!st && !this.problem));
    setClass(this.empty, 'is-error', !!this.problem && !st);
    this.paintBar();
    this.paintSnaps();
    this.paintFoot();
  }

  private paintTargets(): void {
    const items: Array<{ id: string; label: string }> = [{ id: '', label: t('Workspace') }];
    for (const s of sessionsClient.list) items.push({ id: s.id, label: s.title });
    if (this.session && !items.some((i) => i.id === this.session)) {
      this.session = null;
      this.status = null;
      this.snaps = [];
      this.flagged = [];
      this.done = null;
      void this.refresh();
    }
    patchList(this.target, items, {
      key: (i) => `o:${i.id}`,
      create: (i) => {
        const o = document.createElement('option');
        o.value = i.id;
        o.textContent = i.label;
        return o;
      },
      update: (n, i) => setText(n, i.label),
    });
    const want = this.session ?? '';
    if (this.target.value !== want) this.target.value = want;
    setTitle(this.target, t('What the changes below belong to'));
    this.target.setAttribute('aria-label', t('Target'));
  }

  private paintBar(): void {
    setTitle(this.refreshBtn, t('Refresh'));
    this.refreshBtn.setAttribute('aria-label', t('Refresh'));
    setTitle(this.reviewBtn, t('Review changes'));
    this.reviewBtn.setAttribute('aria-label', t('Review changes'));
    const ph = t('Message (Ctrl+Enter to commit)');
    if (this.msg.placeholder !== ph) this.msg.placeholder = ph;
    this.msg.setAttribute('aria-label', t('Commit message'));
    setText(q(this.commitBtn, '.cv-sc-bt'), t('Commit'));
    setText(q(this.commitAllBtn, '.cv-sc-bt'), t('Commit All'));
    setTitle(this.commitBtn, t('Commit the staged changes'));
    setTitle(this.commitAllBtn, t('Stage every tracked change and commit'));
    const typed = this.msg.value.trim().length > 0;
    setDisabled(this.commitBtn, this.busy || !typed || this.stagedCount === 0);
    setDisabled(this.commitAllBtn, this.busy || !typed || this.fileCount === 0);
    setDisabled(this.refreshBtn, false);
    setDisabled(this.reviewBtn, !this.status);
  }

  private paintSnaps(): void {
    setText(q(this.host, '.cv-sc-snaps-t'), t('Snapshots'));
    setText(this.snapCount, this.snaps.length ? String(this.snaps.length) : '');
    setTitle(this.takeBtn, t('Take Snapshot'));
    this.takeBtn.setAttribute('aria-label', t('Take Snapshot'));
    setDisabled(this.takeBtn, this.busy || !this.status);
    patchList(this.snapList, [...this.snaps].reverse(), {
      key: (s) => `n:${s.n}`,
      create: (s) => {
        const n = el(`<div class="cv-sc-snap" role="listitem"><div class="cv-sc-snap-main"><span class="cv-sc-snap-t"></span><span class="cv-sc-snap-m"></span></div><button class="cv-wb-tool cv-sc-rewind" type="button">${icon('undo', 14)}</button></div>`);
        this.fillSnap(n, s);
        return n;
      },
      update: (n, s) => this.fillSnap(n, s),
    });
    setText(this.snapEmpty, t('No snapshots yet. Take one before a risky change.'));
    setHidden(this.snapEmpty, this.snaps.length > 0);
  }

  private fillSnap(n: HTMLElement, s: Snapshot): void {
    if (n.dataset.n !== String(s.n)) n.dataset.n = String(s.n);
    setText(q(n, '.cv-sc-snap-t'), `#${s.n} ${s.label || t('snapshot')}`);
    setTitle(q(n, '.cv-sc-snap-t'), s.label);
    setText(q(n, '.cv-sc-snap-m'), [clock(s.created), `${s.files} ${t(s.files === 1 ? 'file' : 'files')}`].filter(Boolean).join(' · '));
    const b = q<HTMLButtonElement>(n, '.cv-sc-rewind');
    setTitle(b, t('Rewind'));
    b.setAttribute('aria-label', t('Rewind'));
    setDisabled(b, this.busy);
  }

  private paintFoot(): void {
    const st = this.status;
    setText(this.branch, st ? st.branch ?? t('detached HEAD') : '');
    setText(this.ahead, st ? (st.upstream ? `${st.ahead} ${t('ahead')} · ${st.behind} ${t('behind')}` : t('no upstream')) : '');
    setTitle(this.ahead, st?.upstream ?? '');
    setText(q(this.pushBtn, '.cv-sc-bt'), t('Push'));
    setText(q(this.signPushBtn, '.cv-sc-bt'), t('Sign and Push'));
    setTitle(this.pushBtn, t('Push the current branch'));
    setTitle(this.signPushBtn, t('Re-sign the new commits, check them, then push'));
    const off = this.busy || !st || !st.branch;
    setDisabled(this.pushBtn, off);
    setDisabled(this.signPushBtn, off);
    setText(this.check, this.checkText);
    setTitle(this.check, this.checkText);
    setHidden(this.checkCard, !this.checkText);
    setClass(this.checkCard, 'is-error', this.checkBad);
    this.paintAudit();
    this.paintFlag();
  }

  private paintFlag(): void {
    const first = this.flagged[0];
    const show = !!first && !this.checkText && !this.done;
    setHidden(this.flagCard, !show);
    if (!first) return;
    const more = this.flagged.length > 1 ? ` (+${this.flagged.length - 1} ${t('more')})` : '';
    const text = `${t('commit')} ${first.short} ${t('has a trailer or another identity')}${more}`;
    setText(q(this.flagCard, '.cv-sc-flag-t'), text);
    setTitle(q(this.flagCard, '.cv-sc-flag-t'), this.flagged.map((c) => `${c.short} ${c.subject} · ${c.author}`).join('\n'));
    setTitle(this.flagFix, t('It skipped the commit hook. Sign and Push re-signs and cleans it; history is only rewritten when you click.'));
    setText(q(this.flagFix, '.cv-sc-bt'), t('Fix with Sign and Push'));
    setDisabled(this.flagFix, this.busy);
  }

  private paintAudit(): void {
    const d = this.done;
    setHidden(this.audit, !d);
    if (!d) return;
    const a = d.audit;
    setText(q(this.audit, '.cv-sc-audit-t'), t('Last commit'));
    setText(q(this.audit, '.cv-sc-audit-sha'), `${d.commit.slice(0, 7)} ${d.summary}`);
    setTitle(q(this.audit, '.cv-sc-audit-sha'), d.summary);
    for (const k of Array.from(this.audit.querySelectorAll<HTMLElement>('.cv-sc-audit-k'))) setText(k, t(({ author: 'Author', committer: 'Committer', trailers: 'Trailers', signature: 'Signature' } as Record<string, string>)[k.dataset.k ?? ''] ?? ''));
    setText(q(this.audit, '[data-f="author"]'), a.author);
    setTitle(q(this.audit, '[data-f="author"]'), a.author);
    setText(q(this.audit, '[data-f="committer"]'), a.committer);
    setTitle(q(this.audit, '[data-f="committer"]'), a.committer);
    setText(q(this.audit, '[data-f="trailers"]'), String(a.trailers));
    setClass(q(this.audit, '[data-f="trailers"]'), 'is-bad', a.trailers > 0);
    const sig = q(this.audit, '[data-f="signature"]');
    setText(sig, `${a.signature} · ${t(SIGNATURE[a.signature] ?? 'Unknown')}`);
    const bad = a.signature === 'B' || a.signature === 'E';
    setClass(sig, 'is-bad', bad);
    setClass(sig, 'is-good', a.signature === 'G');
    const reasons: string[] = [];
    if (!a.identityOk) reasons.push(t('Identity differs from Preferences.'));
    if (a.trailers > 0) reasons.push(`${a.trailers} ${t(a.trailers === 1 ? 'trailer line in the message.' : 'trailer lines in the message.')}`);
    setClass(this.warn, 'is-off', reasons.length === 0);
    setText(q(this.warn, '.cv-sc-warn-t'), reasons.join(' '));
  }

  private create(e: Entry): HTMLElement {
    if (e.kind === 'head') {
      const n = el(`<div class="cv-sc-head" role="presentation"><span class="cv-sc-head-t"></span><span class="cv-sc-head-n"></span><span class="cv-sc-acts">
<button class="cv-wb-tool cv-sc-act" type="button" data-act="stage-all" hidden>${icon('add', 14)}</button>
<button class="cv-wb-tool cv-sc-act" type="button" data-act="unstage-all" hidden>${icon('remove', 14)}</button>
<button class="cv-wb-tool cv-sc-act" type="button" data-act="discard-all" hidden>${icon('undo', 14)}</button></span></div>`);
      this.update(n, e);
      return n;
    }
    const n = el(`<div class="cv-sc-row" role="listitem" tabindex="0"><span class="cv-sc-k"></span><span class="cv-sc-name"></span><span class="cv-sc-dir"></span><span class="cv-sc-acts">
<button class="cv-wb-tool cv-sc-act" type="button" data-act="stage" hidden>${icon('add', 14)}</button>
<button class="cv-wb-tool cv-sc-act" type="button" data-act="unstage" hidden>${icon('remove', 14)}</button>
<button class="cv-wb-tool cv-sc-act" type="button" data-act="discard" hidden>${icon('undo', 14)}</button></span></div>`);
    this.update(n, e);
    return n;
  }

  private update(n: HTMLElement, e: Entry): void {
    const staged = e.group === 'staged';
    if (n.dataset.group !== e.group) n.dataset.group = e.group;
    const show = (act: string, on: boolean, label: string): void => {
      const b = q<HTMLButtonElement>(n, `[data-act="${act}"]`);
      setHidden(b, !on);
      setDisabled(b, this.busy);
      setTitle(b, t(label));
      if (b.getAttribute('aria-label') !== t(label)) b.setAttribute('aria-label', t(label));
    };
    if (e.kind === 'head') {
      setText(q(n, '.cv-sc-head-t'), t(GROUP_LABEL[e.group]));
      setText(q(n, '.cv-sc-head-n'), String(e.count));
      show('stage-all', !staged, 'Stage all');
      show('unstage-all', staged, 'Unstage all');
      show('discard-all', !staged, 'Discard all');
      return;
    }
    const f = e.file;
    if (n.dataset.path !== f.path) n.dataset.path = f.path;
    if (n.dataset.kind !== f.kind) n.dataset.kind = f.kind;
    const { name, dir } = split(f.path);
    setText(q(n, '.cv-sc-k'), letterOf(f, e.group));
    setText(q(n, '.cv-sc-name'), name);
    setText(q(n, '.cv-sc-dir'), dir);
    setTitle(n, f.oldPath ? `${f.oldPath} -> ${f.path}` : f.path);
    show('stage', !staged, 'Stage');
    show('unstage', staged, 'Unstage');
    show('discard', !staged, 'Discard');
  }

  private onList(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    const act = target?.closest<HTMLButtonElement>('.cv-sc-act')?.dataset.act;
    const node = target?.closest<HTMLElement>('.cv-sc-row, .cv-sc-head');
    if (!node) return;
    const group = node.dataset.group === 'staged' ? 'staged' : 'changes';
    if (!act) {
      if (node.classList.contains('cv-sc-row')) this.open(group === 'staged', node.dataset.path ?? '');
      return;
    }
    const files = this.status?.files ?? [];
    const inGroup = files.filter((f) => (group === 'staged' ? f.staged : f.unstaged || !f.staged));
    if (act === 'stage') void this.stage([node.dataset.path ?? '']);
    else if (act === 'unstage') void this.unstage([node.dataset.path ?? '']);
    else if (act === 'discard') void this.discard(inGroup.filter((f) => f.path === node.dataset.path));
    else if (act === 'stage-all') void this.stage(inGroup.map((f) => f.path));
    else if (act === 'unstage-all') void this.unstage(inGroup.map((f) => f.path));
    else if (act === 'discard-all') void this.discard(inGroup);
  }

  private open(staged: boolean, path: string): void {
    if (!path) return;
    window.dispatchEvent(new CustomEvent(OPEN_DIFF, { detail: { path, staged, session: this.session } }));
  }

  review(): void {
    window.dispatchEvent(new CustomEvent(OPEN_REVIEW, { detail: { session: this.session } }));
  }

  private async run(job: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.schedule();
    try {
      await job();
    } catch (err) {
      this.say(message(err), true);
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  private say(text: string, bad: boolean): void {
    this.checkText = text;
    this.checkBad = bad;
    this.done = null;
    if (bad) this.shell.setStatus(text, 'error');
    this.schedule();
  }

  private apply(s: GitStatus): void {
    this.status = s;
    this.problem = '';
    if (this.session === null) this.broadcast(s);
  }

  private stage(paths: string[]): Promise<void> {
    return this.run(async () => {
      if (!paths.length) return;
      this.apply(await git.stage(paths, this.session));
      this.fire();
    });
  }

  private unstage(paths: string[]): Promise<void> {
    return this.run(async () => {
      if (!paths.length) return;
      this.apply(await git.unstage(paths, this.session));
      this.fire();
    });
  }

  private async discard(files: GitFile[]): Promise<void> {
    if (!files.length || this.busy) return;
    const session = this.session;
    const body = files.length === 1 ? files[0].path : `${files.length} ${t('files')}`;
    const lost = files.some((f) => f.kind === 'untracked') ? t('Untracked files are deleted.') : t('The working copy goes back to the index.');
    if (!(await confirmAction('Discard changes', `${body}: ${lost} ${t('A snapshot is taken first.')}`, 'Discard', true))) return;
    if (session !== this.session) return;
    await this.run(async () => {
      const tracked = files.filter((f) => f.kind !== 'untracked').map((f) => f.path);
      const loose = files.filter((f) => f.kind === 'untracked').map((f) => f.path);
      if (tracked.length) this.apply(await git.discard(tracked, false, session));
      if (loose.length) this.apply(await git.discard(loose, true, session));
      this.fire();
    });
  }

  commit(all: boolean): Promise<void> {
    return this.run(async () => {
      const text = this.msg.value;
      if (!text.trim()) return;
      const session = this.session;
      const res = await git.commit(text, { all, session });
      this.msg.value = '';
      if (session === this.session) {
        this.checkText = '';
        this.done = res;
      }
      this.fire();
    });
  }

  fromReview(session: string | null): void {
    if (session !== this.session) this.retarget(session);
    this.focusMessage();
    if (this.hasMessage) {
      window.setTimeout(() => { if (this.session === session && this.hasMessage) void this.commit(false); }, 0);
    }
  }

  snapshot(): Promise<void> {
    return this.run(async () => {
      const s = await git.snapshot(undefined, this.session);
      this.say(`${t('Snapshot taken')}: #${s.n}`, false);
      this.fire();
    });
  }

  private async rewind(n: number): Promise<void> {
    if (this.busy) return;
    const session = this.session;
    const snap = this.snaps.find((s) => s.n === n);
    const name = snap ? `#${snap.n} ${snap.label}`.trim() : `#${n}`;
    const where = session ? sessionsClient.get(session)?.title ?? session : t('the workspace');
    if (!(await confirmAction('Rewind to snapshot', `${where}: ${name}. ${t('Files changed since are overwritten and files not in the snapshot are removed. A safety snapshot is taken first. HEAD and the index do not move.')}`, 'Rewind', true))) return;
    if (session !== this.session) return;
    await this.run(async () => {
      const r = await git.rewind(n, session);
      this.apply(r.status);
      this.say(`${t('Rewound to')} #${r.restored.n}. ${t('Safety snapshot')} #${r.safety.n}`, false);
      this.fire();
    });
  }

  push(sign: boolean): Promise<void> {
    return this.run(async () => {
      this.say(t(sign ? 'Signing, checking and pushing...' : 'Pushing...'), false);
      this.paint();
      try {
        const r = sign ? await git.signAndPush({ session: this.session }) : await git.push({ session: this.session });
        const last = r.output.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
        if (sign) {
          const line = r.check || (r.ok ? t('Pushed') : t('Refused'));
          this.say(!r.ok && r.output ? `${line} ${r.output}` : line, !r.ok);
        } else if (r.ok) {
          this.say(last || t('Pushed'), false);
        } else {
          this.say(r.check ? `${t('Push refused')}: ${r.check}` : last || t('Push refused'), true);
        }
      } catch (err) {
        this.say(message(err), true);
      }
      this.fire();
    });
  }
}

register({
  id: 'git',
  name: 'Source control',
  description: 'Stage, commit with an audit, push, and snapshot or rewind a workspace or a session.',
  required: true,
  setup(ctx: ExtensionContext, shell: Shell): void {
    let section: SidebarSection | null = null;
    let panel: GitPanel | null = null;
    section = shell.sidebarSection({
      id: 'git',
      title: 'Source Control',
      icon: 'branch',
      render: (host) => { panel = new GitPanel(host, ctx, shell); },
    });
    const ws = (): boolean => !!ctx.store.workspace && !!panel;
    window.addEventListener(FOCUS_COMMIT, (e) => {
      const d = (e as CustomEvent<{ session?: string | null } | null>).detail;
      section?.reveal();
      panel?.fromReview(typeof d?.session === 'string' ? d.session : null);
    });
    ctx.commands.add(
      { id: 'git-status', label: 'Git Status', enabled: ws, run: () => { section?.reveal(); void panel?.refresh(); } },
      { id: 'git-commit', label: 'Commit...', enabled: ws, run: () => {
        section?.reveal();
        panel?.focusMessage();
        if (panel?.hasMessage && panel.stagedCount > 0) void panel.commit(false);
      } },
      { id: 'git-commit-all', label: 'Commit All', enabled: () => ws() && !!panel?.hasMessage && (panel?.fileCount ?? 0) > 0, run: () => { void panel?.commit(true); } },
      { id: 'git-snapshot', label: 'Take Snapshot', enabled: ws, run: () => { section?.reveal(); void panel?.snapshot(); } },
      { id: 'git-push', label: 'Push', enabled: ws, run: () => { section?.reveal(); void panel?.push(false); } },
      { id: 'git-sign-push', label: 'Sign and Push', enabled: ws, run: () => { section?.reveal(); void panel?.push(true); } },
    );
  },
});
