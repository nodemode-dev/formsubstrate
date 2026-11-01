import { git } from '../../io/git';
import { detailOf } from '../../io/workspace';
import { OPEN_REVIEW } from '../../ui/review/review-pane';
import { fmtUsage, RUN_SELECTED, RUN_STARTED, runsApi, tailRun, type Park, type ParkedOn, type RunDetail, type RunEvent, type RunMode, type RunSummary } from '../../io/runs';
import { workspaceTrusted } from '../../io/trust';
import { confirmAction } from '../../ui/dialogs';
import { mountOnce, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { onLanguage, t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { NodeInspector } from '../../ui/inspector';
import { RUN_EVENT, studio } from '../../ui/studio/api';
import { toast } from '../../ui/toast';
import { register, type ExtensionContext, type Shell } from '../registry';

const MODE_KEY = 'subform.runs.mode';
const LIST_MS = 3000;
const DETAIL_MS = 300;
const EVENT_CAP = 300;
const STREAM_CAP = 6000;
const HIDDEN_PHASES = new Set(['delta', 'usage', '_status']);
const ACTIVE = new Set(['running', 'parked']);
const NODE_STATUS: Record<string, 'running' | 'done' | 'error' | 'parked'> = { running: 'running', done: 'done', failed: 'error' };

const ROW_ACTIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['cancel', 'stop', 'Cancel'],
  ['rerun', 'refresh', 'Run again'],
  ['remove', 'delete', 'Delete'],
];

function storedMode(): RunMode {
  try { return localStorage.getItem(MODE_KEY) === 'claude' ? 'claude' : 'simulate'; } catch { return 'simulate'; }
}

function keepMode(mode: RunMode): void {
  try { localStorage.setItem(MODE_KEY, mode); } catch { return; }
}

function clock(seconds: number): string {
  return seconds ? new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

function parkedText(on: ParkedOn | null): string {
  if (!on) return '';
  if (on.type === 'approval') return `${t('Waiting for approval')}: ${on.tool ?? ''} ${on.args ? JSON.stringify(on.args).slice(0, 200) : ''}`.trim();
  if (on.type === 'delay') return `${t('Waiting')} ${on.seconds ?? ''}s`;
  if (on.type === 'watch') return `${t('Waiting for files to change')}: ${on.glob ?? ''}`;
  return t('Waiting to be resumed');
}

class RunsPanel {
  private readonly task: HTMLInputElement;
  private readonly mode: HTMLSelectElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly dName: HTMLElement;
  private readonly dChip: HTMLElement;
  private readonly reviewBtn: HTMLButtonElement;
  private reviewFor = '';
  private detailSeq = 0;
  private readonly dMeta: HTMLElement;
  private readonly parks: HTMLElement;
  private readonly stream: HTMLElement;
  private readonly events: HTMLElement;
  private runs: RunSummary[] = [];
  private selected: string | null = null;
  private current: RunDetail | null = null;
  private tailing: { id: string; abort: AbortController } | null = null;
  private live = new Map<string, string>();
  private streamText = '';
  private listTimer = 0;
  private detailTimer = 0;
  private claude = false;
  private busy = new Set<string>();

  constructor(host: HTMLElement, private readonly inspector: NodeInspector) {
    mountOnce(host, `<div class="rn-root">
<div class="rn-bar">
<input class="rn-task" type="text" spellcheck="false">
<select class="rn-mode"><option value="simulate"></option><option value="claude"></option></select>
<button class="rn-run" type="button">${icon('play', 14)}<span class="rn-run-t"></span></button>
</div>
<div class="rn-listwrap"><div class="rn-list" role="list"></div><p class="rn-empty cv-note"></p></div>
<div class="rn-detail" hidden>
<div class="rn-dhead"><span class="rn-dname"></span><button class="rn-review is-off" type="button" tabindex="-1">${icon('diff', 14)}<span></span></button><span class="rn-chip"></span></div>
<div class="rn-dmeta"></div>
<div class="rn-events"></div>
<div class="rn-parks"></div>
<pre class="rn-stream" hidden></pre>
</div>
<p class="rn-note cv-note" hidden></p>
</div>`);
    this.task = q<HTMLInputElement>(host, '.rn-task');
    this.mode = q<HTMLSelectElement>(host, '.rn-mode');
    this.runBtn = q<HTMLButtonElement>(host, '.rn-run');
    this.note = q(host, '.rn-note');
    this.list = q(host, '.rn-list');
    this.empty = q(host, '.rn-empty');
    this.detail = q(host, '.rn-detail');
    this.dName = q(host, '.rn-dname');
    this.dChip = q(host, '.rn-chip');
    this.reviewBtn = q<HTMLButtonElement>(host, '.rn-review');
    this.reviewBtn.addEventListener('click', () => {
      if (this.current) window.dispatchEvent(new CustomEvent(OPEN_REVIEW, { detail: { session: `run${this.current.id}000` } }));
    });
    this.dMeta = q(host, '.rn-dmeta');
    this.parks = q(host, '.rn-parks');
    this.stream = q(host, '.rn-stream');
    this.events = q(host, '.rn-events');
    this.mode.value = storedMode();
    this.mode.addEventListener('change', () => { keepMode(this.mode.value === 'claude' ? 'claude' : 'simulate'); this.paintStatic(); });
    this.runBtn.addEventListener('click', () => void this.start());
    this.task.addEventListener('keydown', (e) => { if (e.key === 'Enter') void this.start(); });
    this.list.addEventListener('click', (e) => this.onList(e));
    this.parks.addEventListener('click', (e) => this.onPark(e));
    this.paintStatic();
    onLanguage(() => this.paintStatic());
    void runsApi.env().then((env) => { this.claude = env.claude; this.paintStatic(); }).catch(() => undefined);
    this.listTimer = window.setInterval(() => { if (!document.hidden) void this.refresh(); }, LIST_MS);
    void this.refresh();
  }

  private paintStatic(): void {
    setText(this.task.parentElement?.querySelector('.rn-run-t') ?? null, t('Run'));
    this.task.placeholder = t('Task: what should the agents do?');
    const opts = this.mode.options;
    setText(opts[0], t('Simulator'));
    setText(opts[1], t('Claude'));
    setText(this.empty, t('No runs yet. Build a graph and press Run.'));
    const needsClaude = this.mode.value === 'claude' && !this.claude;
    setHidden(this.note, !needsClaude);
    setText(this.note, t('The claude command was not found on this computer. Use the simulator or install Claude Code.'));
    setDisabled(this.runBtn, needsClaude);
    setTitle(this.mode, t('Simulator runs the graph with no model. Claude runs each agent through your claude command.'));
    this.paintParks();
  }

  async start(): Promise<void> {
    if (this.runBtn.disabled) return;
    const doc = studio.getDoc();
    if (!doc.nodes.some((n) => n.kind === 'start')) { toast(t('The graph has no start node.'), 'error'); return; }
    const mode: RunMode = this.mode.value === 'claude' ? 'claude' : 'simulate';
    if (!workspaceTrusted() && (mode === 'claude' || doc.nodes.some((n) => n.kind === 'tool'))) {
      toast(t('This workspace is not trusted. Trust it in Preferences to run Claude or graphs with tool nodes. The simulator runs graphs without tool nodes.'), 'error');
      return;
    }
    setDisabled(this.runBtn, true);
    try {
      studio.clearStatus();
      const res = await runsApi.start(doc, this.task.value, mode, workspaceTrusted());
      window.dispatchEvent(new CustomEvent(RUN_STARTED, { detail: { id: res.run_id } }));
      this.live.clear();
      this.select(res.run_id, true);
      await this.refresh();
    } catch (err) {
      toast(detailOf(err), 'error');
    } finally {
      setDisabled(this.runBtn, false);
      this.paintStatic();
    }
  }

  focusTask(): void { this.task.focus(); }

  select(id: string | null, follow = false): void {
    if (this.selected !== id) {
      this.selected = id;
      this.current = null;
      this.streamText = '';
      this.live.clear();
      this.inspector.setRun(null);
      window.dispatchEvent(new CustomEvent(RUN_SELECTED, { detail: { id } }));
    }
    this.paintList();
    this.paintDetail();
    if (!id) { this.stopTail(); return; }
    if (follow || this.runs.find((r) => r.id === id && ACTIVE.has(r.status))) this.startTail(id);
    else this.stopTail();
    void this.loadDetail();
  }

  private startTail(id: string): void {
    if (this.tailing?.id === id) return;
    this.stopTail();
    const abort = new AbortController();
    this.tailing = { id, abort };
    void tailRun(id, (ev) => this.onEvent(id, ev), abort.signal).catch(() => undefined).finally(() => {
      if (this.tailing?.abort === abort) this.tailing = null;
      void this.refresh();
      void this.loadDetail();
    });
  }

  private stopTail(): void {
    this.tailing?.abort.abort();
    this.tailing = null;
  }

  private onEvent(id: string, ev: RunEvent): void {
    if (id !== this.selected || ev.phase === '_status') return;
    if (ev.phase === 'delta') {
      this.streamText = (this.streamText + (ev.note ?? '')).slice(-STREAM_CAP);
      const prev = this.live.get(ev.node_id) ?? '';
      const next = (prev + (ev.note ?? '')).slice(-STREAM_CAP);
      this.live.set(ev.node_id, next);
      this.inspector.live(ev.node_id, next);
      this.paintStream();
      return;
    }
    if (ev.phase === 'enter') {
      this.live.delete(ev.node_id);
      this.inspector.live(ev.node_id, null);
      this.streamText = '';
    }
    const status = ev.phase === 'resumed' ? 'running' : undefined;
    window.dispatchEvent(new CustomEvent(RUN_EVENT, { detail: status ? { ...ev, status } : ev }));
    if (ev.phase === 'parked') toast(`${t('Run waiting')}: ${parkedText(this.current?.parked_on ?? null) || ev.label}`);
    this.scheduleDetail();
  }

  private scheduleDetail(): void {
    if (this.detailTimer) return;
    this.detailTimer = window.setTimeout(() => { this.detailTimer = 0; void this.loadDetail(); }, DETAIL_MS);
  }

  private async loadDetail(): Promise<void> {
    const id = this.selected;
    if (!id) return;
    const ticket = ++this.detailSeq;
    try {
      const d = await runsApi.detail(id);
      if (id !== this.selected || ticket !== this.detailSeq) return;
      this.current = d;
      this.paintDetail();
      void this.probeReview(d);
      this.inspector.setRun(d);
      this.mirrorStatuses(d);
    } catch (err) {
      if (id === this.selected && /404/.test(String(err))) this.select(null);
    }
  }

  private async probeReview(d: RunDetail): Promise<void> {
    const key = `${d.id}:${d.status}`;
    if (this.reviewFor === key) return;
    this.reviewFor = key;
    let ok = false;
    if (d.mode === 'claude') {
      try { await git.status(`run${d.id}000`); ok = true; } catch { ok = false; }
    }
    if (this.current?.id !== d.id) return;
    setClass(this.reviewBtn, 'is-off', !ok);
    this.reviewBtn.tabIndex = ok ? 0 : -1;
    setText(this.reviewBtn.querySelector('span'), t('Review run changes'));
    setTitle(this.reviewBtn, t('Review run changes'));
  }

  private mirrorStatuses(d: RunDetail): void {
    if (this.tailing?.id === d.id) return;
    for (const node of studio.getDoc().nodes) {
      const visits = d.nodes[node.id];
      const last = visits && visits.length ? visits[visits.length - 1] : null;
      studio.setNodeStatus(node.id, last ? NODE_STATUS[last.status] ?? null : null);
    }
  }

  async refresh(): Promise<void> {
    try {
      this.runs = (await runsApi.list()).runs;
    } catch {
      return;
    }
    this.paintList();
    if (this.selected && !this.runs.some((r) => r.id === this.selected)) this.select(null);
    else if (this.current) {
      const row = this.runs.find((r) => r.id === this.selected);
      if (row && (row.status !== this.current.status || row.events !== this.current.events.length)) void this.loadDetail();
    }
  }

  private paintList(): void {
    patchList(this.list, this.runs, {
      key: (r) => r.id,
      create: (r) => { const row = this.createRow(r); this.updateRow(row, r); return row; },
      update: (n, r) => this.updateRow(n, r),
    });
    setHidden(this.empty, this.runs.length > 0);
  }

  private createRow(r: RunSummary): HTMLElement {
    const row = document.createElement('div');
    row.className = 'rn-row';
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;
    row.dataset.id = r.id;
    row.innerHTML = `<span class="rn-dot"></span><span class="rn-main"><span class="rn-name"></span><span class="rn-meta"></span></span><span class="rn-acts">${ROW_ACTIONS.map(([act, ic]) => `<button class="rn-act" type="button" data-act="${act}">${icon(ic, 13)}</button>`).join('')}</span>`;
    row.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); this.select(r.id); }
    });
    return row;
  }

  private updateRow(row: HTMLElement, r: RunSummary): void {
    row.dataset.state = r.status;
    setClass(row, 'is-selected', r.id === this.selected);
    setText(row.querySelector('.rn-name'), r.name || r.id);
    const usage = fmtUsage(r.usage);
    setText(row.querySelector('.rn-meta'), [r.status, r.mode === 'claude' ? 'claude' : t('simulator'), clock(r.created), usage].filter(Boolean).join(' · '));
    setTitle(row, r.task || r.id);
    for (const btn of Array.from(row.querySelectorAll<HTMLButtonElement>('.rn-act'))) {
      const act = btn.dataset.act ?? '';
      const label = ROW_ACTIONS.find((a) => a[0] === act)?.[2] ?? act;
      setTitle(btn, t(label));
      setHidden(btn, act === 'cancel' ? !ACTIVE.has(r.status) : act === 'remove' ? ACTIVE.has(r.status) : false);
      setDisabled(btn, this.busy.has(`${act}:${r.id}`));
    }
  }

  private onList(e: Event): void {
    const target = e.target instanceof Element ? e.target : null;
    const row = target?.closest<HTMLElement>('.rn-row');
    if (!row || !row.dataset.id) return;
    const id = row.dataset.id;
    const btn = target?.closest<HTMLButtonElement>('.rn-act');
    if (!btn) { this.select(id); return; }
    void this.rowAction(btn.dataset.act ?? '', id);
  }

  private async rowAction(act: string, id: string): Promise<void> {
    const key = `${act}:${id}`;
    if (this.busy.has(key)) return;
    this.busy.add(key);
    try {
      if (act === 'cancel') await runsApi.cancel(id);
      else if (act === 'rerun') {
        studio.clearStatus();
        const res = await runsApi.rerun(id, workspaceTrusted());
        this.live.clear();
        await this.refresh();
        this.select(res.run_id, true);
      } else if (act === 'remove') {
        if (!(await confirmAction(t('Delete run'), t('Delete this run from history?'), t('Delete'), true))) return;
        await runsApi.remove(id);
        if (this.selected === id) this.select(null);
      }
    } catch (err) {
      toast(detailOf(err), 'error');
    } finally {
      this.busy.delete(key);
      await this.refresh();
      this.paintList();
    }
  }

  private onPark(e: Event): void {
    const btn = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('[data-act]') : null;
    const id = this.selected;
    const park = btn?.closest<HTMLElement>('.rn-park')?.dataset.park;
    if (!btn || !id || !park || btn.disabled) return;
    const act = btn.dataset.act;
    setDisabled(btn, true);
    const call = act === 'resume' ? runsApi.resume(id, park) : runsApi.decide(id, park, act === 'approve');
    void call.then(() => this.scheduleDetail()).catch((err: unknown) => { setDisabled(btn, false); toast(detailOf(err), 'error'); });
  }

  private paintParks(): void {
    const list = this.current && this.current.status === 'parked' ? this.current.parks ?? [] : [];
    const fill = (card: HTMLElement, p: Park): void => {
      const on = p.on;
      const approval = on.type === 'approval';
      setText(card.querySelector('.rn-park-text'), `${p.label}: ${parkedText(on)}`);
      const full = approval ? (on.diff ?? JSON.stringify(on.args ?? {}, null, 1)) : '';
      const diff = q(card, '.rn-park-diff');
      setHidden(diff, !full);
      setText(diff, full);
      const resume = q(card, '[data-act="resume"]');
      const approve = q(card, '[data-act="approve"]');
      const deny = q(card, '[data-act="deny"]');
      setHidden(resume, approval);
      setHidden(approve, !approval);
      setHidden(deny, !approval);
      setText(resume, t('Resume'));
      setText(approve, t('Approve'));
      setText(deny, t('Deny'));
    };
    patchList(this.parks, list, {
      key: (p) => p.id,
      create: (p) => {
        const card = document.createElement('div');
        card.className = 'rn-park';
        card.dataset.park = p.id;
        card.innerHTML = '<div class="rn-park-text"></div><pre class="rn-park-diff" hidden></pre><div class="rn-park-btns"><button class="rn-btn is-primary" type="button" data-act="resume"></button><button class="rn-btn is-primary" type="button" data-act="approve"></button><button class="rn-btn" type="button" data-act="deny"></button></div>';
        fill(card, p);
        return card;
      },
      update: fill,
    });
  }

  private paintDetail(): void {
    const d = this.current;
    setHidden(this.detail, !d);
    if (!d) return;
    setText(this.dName, d.name || d.id);
    setText(this.dChip, d.status);
    this.dChip.dataset.state = d.status;
    const usage = fmtUsage(d.usage);
    setText(this.dMeta, [d.mode === 'claude' ? 'claude' : t('simulator'), d.task ? d.task.slice(0, 80) : '', usage].filter(Boolean).join(' · '));
    this.paintParks();
    this.paintStream();
    const shown = d.events.filter((e) => !HIDDEN_PHASES.has(e.phase)).slice(-EVENT_CAP);
    const fill = (node: HTMLElement, e: RunEvent): void => {
      setText(node.querySelector('.rn-ev-label'), e.label);
      setText(node.querySelector('.rn-ev-phase'), e.phase);
      setText(node.querySelector('.rn-ev-note'), (e.note ?? '').slice(0, 220));
      node.dataset.phase = e.phase;
    };
    patchList(this.events, shown, {
      key: (e) => `e${e.seq}`,
      create: (e) => {
        const row = document.createElement('div');
        row.className = 'rn-ev';
        row.innerHTML = '<span class="rn-ev-label"></span><span class="rn-ev-phase"></span><span class="rn-ev-note"></span>';
        fill(row, e);
        return row;
      },
      update: fill,
    });
  }

  private paintStream(): void {
    const on = !!this.current && ACTIVE.has(this.current.status) && this.streamText.length > 0;
    setHidden(this.stream, !on);
    setText(this.stream, this.streamText);
    if (on) this.stream.scrollTop = this.stream.scrollHeight;
  }

  dispose(): void {
    window.clearInterval(this.listTimer);
    window.clearTimeout(this.detailTimer);
    this.stopTail();
  }
}

register({
  id: 'runs',
  name: 'Runs',
  description: 'Run the open graph, stream node status onto the canvas, keep a run history and inspect any node.',
  setup(ctx: ExtensionContext, shell: Shell): void {
    let inspector: NodeInspector | null = null;
    const nodeSection = shell.rightSection?.({
      id: 'runs-node',
      title: 'Node',
      icon: 'sliders',
      render: (host) => { inspector = new NodeInspector(host, { engine: studio.engine }); },
    });
    let panel: RunsPanel | null = null;
    const runsSection = shell.rightSection?.({
      id: 'runs-list',
      title: 'Runs',
      icon: 'play',
      render: (host) => { if (inspector) panel = new RunsPanel(host, inspector); },
    });
    studio.onSelect((sel) => {
      inspector?.show(sel && sel.kind === 'node' ? sel.id : null);
    });
    studio.onChange(() => inspector?.nodeChanged());
    const runNow = (): void => { runsSection?.reveal(); void panel?.start(); };
    studio.registerAction({ id: 'runs-run', label: 'Run', icon: 'play', title: 'Run the graph', run: runNow });
    ctx.commands.add(
      { id: 'runs-run', label: 'Run Graph', keys: ['Alt+Mod+R'], enabled: () => !!ctx.store.workspace, run: runNow },
      { id: 'runs-show', label: 'Show Runs', run: () => { runsSection?.reveal(); panel?.focusTask(); } },
      { id: 'runs-node', label: 'Show Node Inspector', run: () => { nodeSection?.reveal(); } },
    );
  },
});
