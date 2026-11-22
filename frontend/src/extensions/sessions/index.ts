import { compact, SESSION_SELECTED } from '../../io/formslot';
import { elapsedLabel, sessionsClient, STATE_ORDER, type NoticeKind, type Session, type SessionState, type Skill } from '../../io/sessions';
import { detailOf, statusOf } from '../../io/workspace';
import { ChatPane } from '../../ui/chat-pane';
import { confirmAction } from '../../ui/dialogs';
import { desktopNotify, primeDesktopNotifications } from '../../ui/desktop-notify';
import { el, mountOnce, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { onLanguage, t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { NewSessionDialog } from '../../ui/new-session';
import { toast } from '../../ui/toast';
import { FOCUS_EVENT } from '../../ui/workbench';
import { register, type ExtensionContext, type Shell, type SidebarSection } from '../registry';

export interface TerminalHook {
  openTerminal(terminalId: string): void;
}

let terminalHook: TerminalHook | null = null;

export function setTerminalHook(hook: TerminalHook | null): void {
  terminalHook = hook;
}

const GROUP_LABEL: Record<SessionState, string> = {
  'needs-input': 'Needs input',
  working: 'Working',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
};

const LIVE: ReadonlySet<SessionState> = new Set<SessionState>(['working', 'needs-input']);
const TICK_MS = 1000;
const OFFLINE_GRACE_MS = 2500;

type Entry =
  | { key: string; kind: 'head'; state: SessionState; count: number }
  | { key: string; kind: 'row'; session: Session };

const ACTIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['open', 'terminal', 'Open terminal'],
  ['review', 'diff', 'Review changes'],
  ['resume', 'play', 'Resume'],
  ['stop', 'stop', 'Stop'],
  ['remove', 'delete', 'Remove worktree'],
];

class SessionsPanel {
  private readonly count: HTMLElement;
  private readonly offline: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly newBtn: HTMLButtonElement;
  private readonly chat = new ChatPane(sessionsClient);
  private selected: string | null = null;
  private frame = 0;
  private tick = 0;
  private busy = new Set<string>();
  private lost = false;
  private lostTimer = 0;

  constructor(private readonly host: HTMLElement, private readonly shell: Shell, private readonly ask: () => void) {
    mountOnce(host, `<div class="cv-ss">
<div class="cv-ss-bar"><button class="cv-ss-new" type="button">${icon('add', 14)}<span class="cv-ss-new-t"></span></button><span class="cv-ss-count"></span><span class="cv-ss-offline" hidden></span></div>
<div class="cv-ss-list" role="list"></div>
<p class="cv-ss-empty cv-note"></p>
<div class="cv-ss-chat"></div>
</div>`);
    this.count = q(host, '.cv-ss-count');
    this.offline = q(host, '.cv-ss-offline');
    this.list = q(host, '.cv-ss-list');
    this.empty = q(host, '.cv-ss-empty');
    this.newBtn = q<HTMLButtonElement>(host, '.cv-ss-new');
    q(host, '.cv-ss-chat').append(this.chat.root);
    this.newBtn.addEventListener('click', () => this.ask());
    this.list.addEventListener('click', (e) => this.onClick(e));
    this.list.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-ss-row') : null;
      if (!row || e.target !== row) return;
      e.preventDefault();
      this.select(row.dataset.id ?? null);
    });
    host.addEventListener(FOCUS_EVENT, () => this.newBtn.focus());
    sessionsClient.on('sessions', () => this.schedule());
    sessionsClient.on('connection', (on) => {
      window.clearTimeout(this.lostTimer);
      this.lost = false;
      if (!on) this.lostTimer = window.setTimeout(() => { this.lost = true; this.schedule(); }, OFFLINE_GRACE_MS);
      this.schedule();
    });
    onLanguage(() => this.schedule());
    this.tick = window.setInterval(() => { if (!document.hidden) this.tickElapsed(); }, TICK_MS);
    this.paint();
  }

  select(id: string | null): void {
    if (this.selected === id) return;
    this.selected = id;
    window.dispatchEvent(new CustomEvent(SESSION_SELECTED, { detail: { id } }));
    this.chat.select(id);
    this.markSelected();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  private entries(): Entry[] {
    const out: Entry[] = [];
    for (const state of STATE_ORDER) {
      const rows = sessionsClient.list.filter((s) => s.state === state);
      if (!rows.length) continue;
      out.push({ key: `g:${state}`, kind: 'head', state, count: rows.length });
      for (const session of rows) out.push({ key: `s:${session.id}`, kind: 'row', session });
    }
    return out;
  }

  private paint(): void {
    const all = sessionsClient.list;
    if (this.selected && !all.some((s) => s.id === this.selected)) this.select(null);
    patchList(this.list, this.entries(), {
      key: (e) => e.key,
      create: (e) => this.create(e),
      update: (n, e) => this.update(n, e),
    });
    const s = sessionsClient.summary();
    setText(this.count, all.length ? [`${all.length} ${t(all.length === 1 ? 'session' : 'sessions')}`, s.needsInput ? `${s.needsInput} ${t('need input')}` : ''].filter(Boolean).join(' · ') : '');
    setHidden(this.offline, sessionsClient.connected || !this.lost);
    setText(this.offline, t('Engine offline'));
    setText(q(this.newBtn, '.cv-ss-new-t'), t('New session'));
    setHidden(this.empty, all.length > 0);
    setText(this.empty, t('No agent sessions yet. Each one works in its own git worktree.'));
    this.markSelected();
  }

  private create(e: Entry): HTMLElement {
    if (e.kind === 'head') {
      const n = el(`<div class="cv-ss-head" role="presentation"><span class="cv-ss-dot"></span><span class="cv-ss-head-t"></span><span class="cv-ss-head-n"></span></div>`);
      this.update(n, e);
      return n;
    }
    const n = el(`<div class="cv-ss-row" role="listitem" tabindex="0">
<div class="cv-ss-top"><span class="cv-ss-dot"></span><span class="cv-ss-title"></span><span class="cv-ss-elapsed"></span></div>
<div class="cv-ss-meta">${icon('branch', 12)}<span class="cv-ss-branch"></span><span class="cv-ss-mode"></span><span class="cv-ss-saved"></span></div>
<div class="cv-ss-last"></div>
<div class="cv-ss-actions">${ACTIONS.map(([act, ic]) => `<button class="cv-ss-act" type="button" data-act="${act}" hidden>${icon(ic, 14)}</button>`).join('')}</div>
</div>`);
    this.update(n, e);
    return n;
  }

  private update(n: HTMLElement, e: Entry): void {
    if (e.kind === 'head') {
      if (n.dataset.state !== e.state) n.dataset.state = e.state;
      setText(q(n, '.cv-ss-head-t'), t(GROUP_LABEL[e.state]));
      setText(q(n, '.cv-ss-head-n'), String(e.count));
      return;
    }
    const s = e.session;
    if (n.dataset.id !== s.id) n.dataset.id = s.id;
    if (n.dataset.state !== s.state) n.dataset.state = s.state;
    setText(q(n, '.cv-ss-title'), s.title);
    setTitle(q(n, '.cv-ss-title'), s.title);
    setText(q(n, '.cv-ss-elapsed'), elapsedLabel(s));
    setText(q(n, '.cv-ss-branch'), s.branch);
    setTitle(q(n, '.cv-ss-meta'), s.worktree);
    setText(q(n, '.cv-ss-mode'), t(s.mode));
    const saved = s.tokensSaved ?? 0;
    setText(q(n, '.cv-ss-saved'), saved > 0 ? `${compact(saved)} ${t('saved')}` : '');
    setTitle(q(n, '.cv-ss-saved'), saved > 0 ? `${saved.toLocaleString()} ${t('tokens saved by reusing slots')}` : '');
    const last = s.lastMessage ?? '';
    setText(q(n, '.cv-ss-last'), last);
    setTitle(q(n, '.cv-ss-last'), last);
    const live = LIVE.has(s.state);
    const shown: Record<string, boolean> = {
      open: s.terminalId !== null && live && terminalHook !== null,
      review: true,
      resume: !live && s.claudeSessionId !== null,
      stop: live,
      remove: !live,
    };
    const working = this.busy.has(s.id);
    for (const [act, , label] of ACTIONS) {
      const b = q<HTMLButtonElement>(n, `[data-act="${act}"]`);
      setHidden(b, !shown[act]);
      setDisabled(b, working);
      setTitle(b, t(label));
      if (b.getAttribute('aria-label') !== t(label)) b.setAttribute('aria-label', t(label));
    }
  }

  private markSelected(): void {
    for (const n of Array.from(this.list.children) as HTMLElement[]) {
      if (n.classList.contains('cv-ss-row')) setClass(n, 'is-selected', n.dataset.id === this.selected);
    }
  }

  private tickElapsed(): void {
    for (const n of Array.from(this.list.children) as HTMLElement[]) {
      const id = n.dataset.id, s = id ? sessionsClient.get(id) : undefined;
      if (s && LIVE.has(s.state)) setText(q(n, '.cv-ss-elapsed'), elapsedLabel(s));
    }
  }

  private onClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    const row = target?.closest<HTMLElement>('.cv-ss-row');
    const id = row?.dataset.id;
    if (!row || !id) return;
    const act = target?.closest<HTMLButtonElement>('.cv-ss-act')?.dataset.act;
    if (!act) { this.select(id); return; }
    this.select(id);
    void this.run(id, act);
  }

  private async run(id: string, act: string): Promise<void> {
    const s = sessionsClient.get(id);
    if (!s || this.busy.has(id)) return;
    if (act === 'open') {
      if (s.terminalId) terminalHook?.openTerminal(s.terminalId);
      return;
    }
    if (act === 'review') {
      window.dispatchEvent(new CustomEvent('formsubstrate:open-review', { detail: { session: id } }));
      return;
    }
    if (act === 'remove' && !(await confirmAction('Remove worktree', `${s.title}: ${t('the worktree and its branch are deleted from disk.')} ${s.worktree}`, 'Remove', true))) return;
    this.busy.add(id);
    this.schedule();
    try {
      if (act === 'resume') await sessionsClient.resume(id);
      else if (act === 'stop') await sessionsClient.stopSession(id);
      else if (act === 'remove') await this.remove(s);
    } catch (err) {
      this.shell.setStatus(detailOf(err), 'error');
    } finally {
      this.busy.delete(id);
      this.schedule();
    }
  }

  private async remove(s: Session): Promise<void> {
    try {
      await sessionsClient.remove(s.id);
    } catch (err) {
      if (statusOf(err) !== 409) throw err;
      if (!(await confirmAction('Uncommitted changes', `${detailOf(err)} ${t('Remove it anyway?')}`, t('Remove anyway'), true))) return;
      await sessionsClient.remove(s.id, true);
    }
  }

  dispose(): void {
    window.clearInterval(this.tick);
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}

class SkillsPanel {
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly note: HTMLElement;
  private seq = 0;
  private skills: Skill[] = [];
  private failed = '';

  constructor(host: HTMLElement) {
    mountOnce(host, `<div class="cv-sk">
<div class="cv-sk-bar"><span class="cv-sk-count"></span><button class="cv-wb-tool cv-sk-refresh" type="button">${icon('refresh', 14)}</button></div>
<div class="cv-sk-list" role="list"></div>
<p class="cv-sk-empty cv-note"></p>
<p class="cv-sk-note cv-note"></p>
</div>`);
    this.list = q(host, '.cv-sk-list');
    this.count = q(host, '.cv-sk-count');
    this.empty = q(host, '.cv-sk-empty');
    this.note = q(host, '.cv-sk-note');
    const refresh = q<HTMLButtonElement>(host, '.cv-sk-refresh');
    refresh.addEventListener('click', () => { void this.load(); });
    host.addEventListener(FOCUS_EVENT, () => { void this.load(); });
    onLanguage(() => { this.paint(); setTitle(refresh, t('Refresh')); });
    setTitle(refresh, t('Refresh'));
    refresh.setAttribute('aria-label', t('Refresh'));
    this.paint();
  }

  async load(): Promise<void> {
    const mine = ++this.seq;
    try {
      const skills = await sessionsClient.skills();
      if (mine !== this.seq) return;
      this.skills = skills;
      this.failed = '';
    } catch (err) {
      if (mine !== this.seq) return;
      this.failed = detailOf(err);
    }
    this.paint();
  }

  private paint(): void {
    patchList(this.list, this.skills, {
      key: (s) => `${s.source}:${s.path}`,
      create: (s) => {
        const n = el(`<div class="cv-sk-row" role="listitem"><div class="cv-sk-top"><span class="cv-sk-name"></span><span class="cv-sk-src"></span></div><div class="cv-sk-desc"></div></div>`);
        this.fill(n, s);
        return n;
      },
      update: (n, s) => this.fill(n, s),
    });
    setText(this.count, this.skills.length ? `${this.skills.length} ${t(this.skills.length === 1 ? 'skill' : 'skills')}` : '');
    setHidden(this.empty, this.skills.length > 0);
    setText(this.empty, this.failed || t('No skills found in .claude/skills of this workspace or of your home folder.'));
    setClass(this.empty, 'is-error', !!this.failed);
    setText(this.note, t('Read-only. Skills are installed and updated with formskills.'));
  }

  private fill(n: HTMLElement, s: Skill): void {
    setText(q(n, '.cv-sk-name'), s.name);
    setText(q(n, '.cv-sk-src'), t(s.source));
    if (q(n, '.cv-sk-src').dataset.source !== s.source) q(n, '.cv-sk-src').dataset.source = s.source;
    setText(q(n, '.cv-sk-desc'), s.description);
    setTitle(n, s.path);
  }
}

const NOTICE_ERROR: ReadonlySet<NoticeKind> = new Set<NoticeKind>(['failed']);

register({
  id: 'sessions',
  name: 'Agent sessions',
  description: 'Claude Code sessions in git worktrees, and the skills they can use.',
  required: true,
  setup(ctx: ExtensionContext, shell: Shell): void {
    let section: SidebarSection | null = null;
    let panel: SessionsPanel | null = null;
    const dialog = new NewSessionDialog(
      (body) => sessionsClient.create(body),
      (s) => { section?.reveal(); panel?.select(s.id); toast(`${s.title}: ${t('session started')}`, 'info'); },
      primeDesktopNotifications,
    );
    section = shell.sidebarSection({
      id: 'sessions',
      title: 'Sessions',
      icon: 'agent',
      render: (host) => { panel = new SessionsPanel(host, shell, () => dialog.show(ctx.store.workspace?.branch ?? '')); },
    });
    const skills: { panel: SkillsPanel | null } = { panel: null };
    shell.sidebarSection({ id: 'skills', title: 'Skills', icon: 'pfPlugins', render: (host) => { skills.panel = new SkillsPanel(host); } });

    ctx.commands.add(
      { id: 'agent-new', label: 'New Claude Code Session', keys: ['Shift+Mod+A'], enabled: () => !!ctx.store.workspace, run: () => dialog.show(ctx.store.workspace?.branch ?? '') },
      { id: 'agent-sessions', label: 'Agent Sessions', run: () => section?.reveal() },
    );

    sessionsClient.on('notice', (n) => {
      const s = sessionsClient.get(n.sessionId);
      const title = s?.title ?? n.sessionId;
      const text = `${title}: ${n.text}`;
      toast(text, NOTICE_ERROR.has(n.kind) ? 'error' : 'info', { actions: [{ label: t('Open'), run: () => { section?.reveal(); panel?.select(n.sessionId); } }] });
      desktopNotify(title, n.text);
    });

    let root = ctx.store.workspace?.path ?? '';
    ctx.store.on('workspace', (ws) => {
      const next = ws?.path ?? '';
      if (next === root) return;
      root = next;
      void sessionsClient.refresh().catch((err: unknown) => console.warn('session list refresh after a workspace change failed', err));
      void skills.panel?.load();
    });
    sessionsClient.start();
    void skills.panel?.load();
  },
});
