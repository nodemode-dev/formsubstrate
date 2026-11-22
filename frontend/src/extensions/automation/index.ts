import { request } from '../../io/api';
import { detailOf } from '../../io/workspace';
import { el, mountOnce, patchList, q, setClass, setHidden, setText, setTitle } from '../../ui/dom';
import { onLanguage, t, tn } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { FOCUS_EVENT } from '../../ui/workbench';
import { RUN_STARTED } from '../recipes/client';
import { lazyPanel, register, type ExtensionContext, type Shell } from '../registry';
import { clock, TRIGGERS_CHANGED, triggersApi, type Trigger } from '../triggers/client';

const POLL_MS = 4000;
const SHOWN = 40;

interface RunRow { id: string; status: string }

interface Fire {
  key: string;
  at: number;
  source: string;
  trigger: Trigger;
  runId: string;
  error: string;
  skipped: string;
}

const fires = (triggers: Trigger[]): Fire[] => {
  const out: Fire[] = [];
  for (const trigger of triggers) {
    for (const h of trigger.history) {
      out.push({ key: `${trigger.id}:${h.at}`, at: h.at, source: h.source, trigger, runId: h.run_id ?? '', error: h.error ?? '', skipped: h.skipped ?? '' });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, SHOWN).reverse();
};

class AutomationPanel {
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly note: HTMLElement;
  private rows: Fire[] = [];
  private status = new Map<string, string>();
  private active = 0;
  private problem = '';
  private loaded = false;
  private seq = 0;
  private frame = 0;

  constructor(private readonly host: HTMLElement, private readonly ctx: ExtensionContext) {
    mountOnce(host, `<div class="cv-au">
<div class="cv-au-bar"><span class="cv-au-title"></span><span class="cv-au-spacer"></span><button class="cv-wb-tool cv-au-refresh" type="button">${icon('refresh', 14)}</button></div>
<p class="cv-au-sum cv-note" role="status"></p>
<div class="cv-au-body"><div class="cv-au-list" role="list"></div><p class="cv-au-empty cv-note"></p></div>
</div>`);
    this.list = q(host, '.cv-au-list');
    this.empty = q(host, '.cv-au-empty');
    this.note = q(host, '.cv-au-sum');
    q<HTMLButtonElement>(host, '.cv-au-refresh').addEventListener('click', () => { void this.load(); });
    host.addEventListener(FOCUS_EVENT, () => { void this.load(); });
    ctx.store.on('workspace', () => { void this.load(); });
    window.addEventListener(TRIGGERS_CHANGED, () => { void this.load(); });
    window.addEventListener(RUN_STARTED, () => { void this.load(); });
    onLanguage(() => this.schedule());
    window.setInterval(() => { if (!host.hidden && host.getClientRects().length > 0) void this.load(); }, POLL_MS);
    this.paint();
    void this.load();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  async load(): Promise<void> {
    const mine = ++this.seq;
    if (!this.ctx.store.workspace) {
      this.rows = [];
      this.active = 0;
      this.loaded = true;
      this.paint();
      return;
    }
    try {
      const reply = await triggersApi.list();
      const runs = await request<{ runs: RunRow[] }>('/api/runs').catch(() => ({ runs: [] as RunRow[] }));
      if (mine !== this.seq) return;
      this.status = new Map(runs.runs.map((r) => [r.id, r.status]));
      this.rows = fires(reply.triggers);
      this.active = reply.triggers.filter((tr) => tr.enabled).length;
      this.problem = '';
    } catch (err) {
      if (mine !== this.seq) return;
      this.problem = detailOf(err);
    }
    this.loaded = true;
    this.paint();
  }

  private makeRow(): HTMLElement {
    return el(`<div class="cv-au-row" role="listitem"><span class="cv-au-top"><span class="cv-au-time"></span><span class="cv-au-chip"></span><span class="cv-au-what"></span></span><span class="cv-au-out"><span class="cv-au-run"></span><span class="cv-au-state"></span></span></div>`);
  }

  private update(node: HTMLElement, f: Fire): void {
    setText(q(node, '.cv-au-time'), clock(f.at));
    setText(q(node, '.cv-au-chip'), t(f.trigger.kind));
    setText(q(node, '.cv-au-what'), f.trigger.action.name ?? f.trigger.action.run_id ?? '');
    setText(q(node, '.cv-au-run'), f.runId ? `${t('run')} ${f.runId}` : f.error || f.skipped);
    setTitle(q(node, '.cv-au-run'), f.runId || f.error || f.skipped);
    const state = f.runId ? this.status.get(f.runId) ?? '' : f.error ? 'failed' : 'skipped';
    setText(q(node, '.cv-au-state'), state ? t(state) : '');
    node.dataset.state = state;
    setClass(node, 'is-bad', !!f.error);
  }

  private paint(): void {
    setText(q(this.host, '.cv-au-title'), t('Automation'));
    setTitle(q(this.host, '.cv-au-refresh'), t('Refresh'));
    const list = this.list;
    const pinned = !this.loaded || list.scrollHeight - list.scrollTop - list.clientHeight < 8;
    patchList(list, this.rows, { key: (r) => r.key, create: (r) => { const n = this.makeRow(); this.update(n, r); return n; }, update: (n, r) => this.update(n, r) });
    if (pinned) list.scrollTop = list.scrollHeight;
    const ws = !!this.ctx.store.workspace;
    setText(this.note, ws ? `${tn(this.active, '{n} trigger on', '{n} triggers on')} · ${t('they run only while Substrate is open')}` : '');
    const msg = !ws ? t('Open a folder to see automation.') : this.loaded && !this.rows.length ? t('Nothing has fired yet.') : this.problem;
    setText(this.empty, msg);
    setHidden(this.empty, !msg);
  }
}

register({
  id: 'automation',
  name: 'Automation',
  description: 'The runs your triggers started, with their state, and when triggers are on.',
  setup(ctx: ExtensionContext, shell: Shell): void {
    const section = shell.rightSection?.({
      id: 'automation',
      title: 'Automation',
      icon: 'history',
      render: (host) => { lazyPanel(host, () => Promise.resolve(), () => { new AutomationPanel(host, ctx); }); },
    });
    ctx.commands.add({ id: 'automation-panel', label: 'Automation', enabled: () => !!section, run: () => { shell.toggleRight?.(true); section?.reveal(); } });
  },
});
