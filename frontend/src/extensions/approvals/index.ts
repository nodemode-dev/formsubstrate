import { detailOf } from '../../io/workspace';
import { desktopNotify } from '../../ui/desktop-notify';
import { el, mountOnce, patchList, q, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { onLanguage, t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { toast } from '../../ui/toast';
import { FOCUS_EVENT } from '../../ui/workbench';
import { register, type ExtensionContext, type Shell, type SidebarSection } from '../registry';
import { APPROVALS_CHANGED, approvalsApi, contextOf, type Approval } from './client';

const POLL_MS = 3000;

class ApprovalsPanel {
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly note: HTMLElement;
  private rows: Approval[] = [];
  private seen = new Set<string>();
  private first = true;
  private deciding = new Set<string>();
  private problem = '';
  private seq = 0;
  private frame = 0;

  constructor(private readonly host: HTMLElement, private readonly ctx: ExtensionContext, private readonly onNew: (a: Approval) => void) {
    mountOnce(host, `<div class="cv-ap">
<div class="cv-ap-bar"><span class="cv-ap-title"></span><span class="cv-ap-spacer"></span><span class="cv-ap-count"></span><button class="cv-wb-tool cv-ap-refresh" type="button">${icon('refresh', 14)}</button></div>
<p class="cv-ap-note cv-note" role="status"></p>
<div class="cv-ap-body"><div class="cv-ap-list" role="list"></div><p class="cv-ap-empty cv-note"></p></div>
</div>`);
    this.list = q(host, '.cv-ap-list');
    this.empty = q(host, '.cv-ap-empty');
    this.note = q(host, '.cv-ap-note');
    q<HTMLButtonElement>(host, '.cv-ap-refresh').addEventListener('click', () => { void this.load(); });
    this.list.addEventListener('click', (e) => this.onClick(e));
    host.addEventListener(FOCUS_EVENT, () => { void this.load(); });
    ctx.store.on('workspace', () => { this.first = true; void this.load(); });
    window.addEventListener(APPROVALS_CHANGED, () => { void this.load(); });
    onLanguage(() => this.schedule());
    window.setInterval(() => { if (document.visibilityState === 'visible') void this.load(); }, POLL_MS);
    this.paint();
    void this.load();
  }

  get count(): number { return this.rows.length; }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  async load(): Promise<void> {
    const mine = ++this.seq;
    if (!this.ctx.store.workspace) {
      this.rows = [];
      this.problem = '';
      this.paint();
      return;
    }
    try {
      const reply = await approvalsApi.list();
      if (mine !== this.seq) return;
      this.rows = reply.approvals;
      this.problem = '';
      for (const a of this.rows) {
        if (!this.seen.has(a.run_id) && !this.first) this.onNew(a);
        this.seen.add(a.run_id);
      }
      this.first = false;
    } catch (err) {
      if (mine !== this.seq) return;
      this.problem = detailOf(err);
    }
    this.paint();
  }

  private onClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    const button = target?.closest<HTMLElement>('[data-act]');
    const card = target?.closest<HTMLElement>('.cv-ap-card');
    if (button && card?.dataset.key) void this.decide(card.dataset.key, button.dataset.act === 'approve');
  }

  private async decide(runId: string, approved: boolean): Promise<void> {
    if (this.deciding.has(runId)) return;
    const row = this.rows.find((r) => r.run_id === runId);
    if (!row) return;
    this.deciding.add(runId);
    this.paint();
    try {
      await approvalsApi.decide(runId, row.id, approved);
      this.rows = this.rows.filter((r) => r.run_id !== runId);
      toast(t(approved ? 'Approved. The run continues.' : 'Denied. The step is skipped.'));
    } catch (err) {
      toast(detailOf(err), 'error');
    } finally {
      this.deciding.delete(runId);
    }
    this.paint();
    window.setTimeout(() => { void this.load(); }, 600);
  }

  private makeCard(): HTMLElement {
    return el(`<div class="cv-ap-card" role="listitem"><div class="cv-ap-head"><span class="cv-ap-mark">${icon('rcpApprove', 14)}</span><span class="cv-ap-tool"></span><span class="cv-ap-run"></span></div><p class="cv-ap-task"></p><pre class="cv-ap-code"></pre><div class="cv-ap-acts"><button class="cv-btn cv-ap-deny" type="button" data-act="deny"></button><button class="cv-btn cv-ap-yes" type="button" data-act="approve">${icon('check', 14)}<span class="cv-ap-yes-t"></span></button></div></div>`);
  }

  private update(node: HTMLElement, a: Approval): void {
    setText(q(node, '.cv-ap-tool'), a.tool);
    setText(q(node, '.cv-ap-run'), `${t('run')} ${a.run_id.slice(0, 6)}`);
    setTitle(q(node, '.cv-ap-run'), a.run_id);
    setText(q(node, '.cv-ap-task'), a.task);
    setText(q(node, '.cv-ap-code'), contextOf(a));
    setText(q(node, '.cv-ap-yes-t'), t('Approve'));
    setText(q(node, '.cv-ap-deny'), t('Deny'));
    const busy = this.deciding.has(a.run_id);
    setDisabled(q<HTMLButtonElement>(node, '.cv-ap-yes'), busy);
    setDisabled(q<HTMLButtonElement>(node, '.cv-ap-deny'), busy);
  }

  private paint(): void {
    setText(q(this.host, '.cv-ap-title'), t('Approvals'));
    setText(q(this.host, '.cv-ap-count'), this.rows.length ? String(this.rows.length) : '');
    setTitle(q(this.host, '.cv-ap-refresh'), t('Refresh'));
    patchList(this.list, this.rows, { key: (r) => r.run_id, create: (r) => { const n = this.makeCard(); this.update(n, r); return n; }, update: (n, r) => this.update(n, r) });
    const msg = !this.ctx.store.workspace ? t('Open a folder to see approvals.') : this.rows.length ? '' : t('No run is waiting for you.');
    setText(this.empty, msg);
    setHidden(this.empty, !msg);
    setText(this.note, this.problem);
  }
}

register({
  id: 'approvals',
  name: 'Approvals',
  description: 'Runs that wait for a human decision before a shell command, a file write or another gated step.',
  setup(ctx: ExtensionContext, shell: Shell): void {
    let section: SidebarSection | undefined;
    section = shell.rightSection?.({
      id: 'approvals',
      title: 'Approvals',
      icon: 'rcpApprove',
      render: (host) => {
        new ApprovalsPanel(host, ctx, (a) => {
          const body = `${a.tool}: ${a.task.slice(0, 80)}`;
          toast(`${t('A run is waiting for your approval')}: ${a.tool}`, 'info', {
            actions: [{ label: t('Review'), run: () => { shell.toggleRight?.(true); section?.reveal(); } }],
            key: `approval:${a.run_id}`,
          });
          if (document.hidden || !document.hasFocus()) desktopNotify(t('Approval needed'), body);
        });
      },
    });
    ctx.commands.add({ id: 'approvals-panel', label: 'Approvals', enabled: () => !!section, run: () => { shell.toggleRight?.(true); section?.reveal(); } });
  },
});
