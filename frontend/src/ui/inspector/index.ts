import type { Engine } from '../../engine';
import { fmtUsage, type RunDetail, type RunEvent, type Visit } from '../../io/runs';
import { mountOnce, patchList, q, setClass, setHidden, setText } from '../dom';
import { t } from '../i18n';
import { toast } from '../toast';
import { FIELDS, type Cfg, type Field, type Value } from './fields';

export interface InspectorDeps {
  engine: Engine;
}

interface Control {
  field: Field;
  wrap: HTMLElement;
  input: HTMLInputElement | HTMLSelectElement;
  label: HTMLElement;
  hint: HTMLElement | null;
}

const LOG_CAP = 200;
const QUIET_PHASES = new Set(['delta', 'usage']);
const PHASE_CLASS: Record<string, string> = { error: 'is-bad', halt: 'is-bad', retry: 'is-warn', parked: 'is-warn', waiting: 'is-warn', loop: 'is-warn' };

export class NodeInspector {
  private readonly empty: HTMLElement;
  private readonly body: HTMLElement;
  private readonly kind: HTMLElement;
  private readonly nodeId: HTMLElement;
  private readonly tabs: HTMLButtonElement[];
  private readonly paneSettings: HTMLElement;
  private readonly paneRun: HTMLElement;
  private readonly noFields: HTMLElement;
  private readonly apply: HTMLButtonElement;
  private readonly controls: Control[] = [];
  private readonly visitSel: HTMLSelectElement;
  private readonly runNone: HTMLElement;
  private readonly runView: HTMLElement;
  private readonly runStatus: HTMLElement;
  private readonly runInput: HTMLElement;
  private readonly runOutput: HTMLElement;
  private readonly runError: HTMLElement;
  private readonly runLive: HTMLElement;
  private readonly liveSec: HTMLElement;
  private readonly errSec: HTMLElement;
  private readonly runLog: HTMLElement;
  private current: string | null = null;
  private initial = new Map<string, Value>();
  private detail: RunDetail | null = null;
  private tab: 'run' | 'settings' = 'run';
  private liveText = new Map<string, string>();
  private frame = 0;
  private selectedVisit = 0;

  constructor(host: HTMLElement, private readonly deps: InspectorDeps) {
    mountOnce(host, `<div class="ri-root">
<p class="ri-empty cv-note"></p>
<div class="ri-body" hidden>
<div class="ri-head"><span class="ri-kind"></span><span class="ri-id"></span></div>
<div class="ri-tabs" role="tablist"><button class="ri-tab is-on" type="button" data-tab="run" role="tab"></button><button class="ri-tab" type="button" data-tab="settings" role="tab"></button></div>
<div class="ri-pane" data-pane="run">
<p class="ri-run-none cv-note"></p>
<div class="ri-run-view" hidden>
<div class="ri-run-bar"><select class="ri-in ri-visit"></select><span class="ri-run-status"></span></div>
<div class="ri-sec"><span class="ri-l ri-in-t"></span><pre class="ri-pre ri-run-input"></pre></div>
<div class="ri-sec ri-live-sec" hidden><span class="ri-l ri-live-t"></span><pre class="ri-pre ri-run-live"></pre></div>
<div class="ri-sec"><span class="ri-l ri-out-t"></span><pre class="ri-pre ri-run-output"></pre></div>
<div class="ri-sec ri-err-sec" hidden><span class="ri-l ri-err-t"></span><pre class="ri-pre ri-bad ri-run-error"></pre></div>
<div class="ri-sec"><span class="ri-l ri-log-t"></span><div class="ri-log"></div></div>
</div>
</div>
<div class="ri-pane" data-pane="settings" hidden>
<div class="ri-fields"></div>
<p class="ri-nofields cv-note" hidden></p>
<div class="ri-actions"><button class="ri-apply" type="button"></button></div>
</div>
</div>
</div>`);
    this.empty = q(host, '.ri-empty');
    this.body = q(host, '.ri-body');
    this.kind = q(host, '.ri-kind');
    this.nodeId = q(host, '.ri-id');
    this.tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('.ri-tab'));
    this.paneSettings = q(host, '[data-pane="settings"]');
    this.paneRun = q(host, '[data-pane="run"]');
    this.noFields = q(host, '.ri-nofields');
    this.apply = q<HTMLButtonElement>(host, '.ri-apply');
    this.visitSel = q<HTMLSelectElement>(host, '.ri-visit');
    this.runNone = q(host, '.ri-run-none');
    this.runView = q(host, '.ri-run-view');
    this.runStatus = q(host, '.ri-run-status');
    this.runInput = q(host, '.ri-run-input');
    this.runOutput = q(host, '.ri-run-output');
    this.runError = q(host, '.ri-run-error');
    this.runLive = q(host, '.ri-run-live');
    this.liveSec = q(host, '.ri-live-sec');
    this.errSec = q(host, '.ri-err-sec');
    this.runLog = q(host, '.ri-log');
    const fields = q(host, '.ri-fields');
    for (const field of FIELDS) this.controls.push(this.build(fields, field));
    for (const b of this.tabs) b.addEventListener('click', () => this.setTab(b.dataset.tab === 'settings' ? 'settings' : 'run'));
    this.apply.addEventListener('click', () => this.commit());
    this.paneSettings.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') { e.preventDefault(); this.commit(); }
    });
    this.visitSel.addEventListener('change', () => { this.selectedVisit = Number(this.visitSel.value) || 0; this.paintRun(); });
    this.paintStatic();
    this.show(null);
  }

  private build(into: HTMLElement, field: Field): Control {
    const wrap = document.createElement('div');
    wrap.className = field.type === 'check' ? 'ri-f ri-check' : 'ri-f';
    wrap.hidden = true;
    const label = document.createElement('span');
    label.className = 'ri-l';
    let input: Control['input'];
    if (field.type === 'select') {
      const s = document.createElement('select');
      for (const o of field.options ?? []) s.append(new Option(o, o));
      input = s;
    } else {
      const i = document.createElement('input');
      i.type = field.type === 'num' ? 'number' : field.type === 'check' ? 'checkbox' : 'text';
      if (field.type === 'num') {
        if (field.min !== undefined) i.min = String(field.min);
        if (field.max !== undefined) i.max = String(field.max);
      }
      if (field.placeholder) i.placeholder = field.placeholder;
      if (field.list) {
        const list = document.createElement('datalist');
        list.id = `ri-list-${field.id}`;
        for (const o of field.list) list.append(new Option(o));
        i.setAttribute('list', list.id);
        wrap.append(list);
      }
      input = i;
    }
    input.className = `ri-in${field.mono ? ' is-mono' : ''}`;
    input.spellcheck = false;
    const hint = field.hint ? document.createElement('span') : null;
    if (hint) hint.className = 'ri-hint';
    if (field.type === 'check') wrap.append(input, label); else wrap.append(label, input);
    if (hint) wrap.append(hint);
    into.append(wrap);
    return { field, wrap, input, label, hint };
  }

  private paintStatic(): void {
    setText(this.empty, t('Select a node on the canvas to see what it did in a run and to set how it runs.'));
    setText(this.apply, t('Apply'));
    setText(this.tabs[0], t('Last run'));
    setText(this.tabs[1], t('Run settings'));
    setText(this.noFields, t('This kind of node has no run settings.'));
    setText(q(this.paneRun, '.ri-in-t'), t('Input'));
    setText(q(this.paneRun, '.ri-live-t'), t('Streaming'));
    setText(q(this.paneRun, '.ri-out-t'), t('Output'));
    setText(q(this.paneRun, '.ri-err-t'), t('Error'));
    setText(q(this.paneRun, '.ri-log-t'), t('Log'));
    for (const c of this.controls) {
      setText(c.label, t(c.field.label));
      if (c.hint && c.field.hint) setText(c.hint, t(c.field.hint));
    }
  }

  private setTab(tab: 'run' | 'settings'): void {
    this.tab = tab;
    setHidden(this.paneSettings, tab !== 'settings');
    setHidden(this.paneRun, tab !== 'run');
    setClass(this.tabs[0], 'is-on', tab === 'run');
    setClass(this.tabs[1], 'is-on', tab === 'settings');
    if (tab === 'run') this.paintRun();
  }

  show(id: string | null): void {
    this.current = id;
    const node = id ? this.deps.engine.getDoc().nodes.find((n) => n.id === id) : undefined;
    setHidden(this.empty, !!node);
    setHidden(this.body, !node);
    if (!node) return;
    setText(this.kind, node.kind);
    this.kind.className = `ri-kind k-${node.kind}`;
    setText(this.nodeId, node.label === node.id ? node.id : `${node.label} · ${node.id}`);
    const cfg = (node.config ?? {}) as Cfg;
    this.initial.clear();
    let any = false;
    for (const c of this.controls) {
      const on = c.field.kinds.includes(node.kind);
      setHidden(c.wrap, !on);
      if (!on) continue;
      any = true;
      const value = c.field.get(cfg);
      this.initial.set(c.field.id, value);
      this.write(c, value);
    }
    setHidden(this.noFields, any);
    setHidden(this.apply, !any);
    this.selectedVisit = 0;
    this.paintRun();
  }

  private write(c: Control, value: Value): void {
    if (c.input instanceof HTMLInputElement && c.input.type === 'checkbox') {
      if (c.input.checked !== (value === true)) c.input.checked = value === true;
    } else if (c.input.value !== String(value) && document.activeElement !== c.input) {
      c.input.value = String(value);
    }
  }

  private read(c: Control): Value {
    return c.input instanceof HTMLInputElement && c.input.type === 'checkbox' ? c.input.checked : c.input.value;
  }

  private commit(): void {
    const node = this.current ? this.deps.engine.getDoc().nodes.find((n) => n.id === this.current) : undefined;
    if (!node) return;
    const cfg: Cfg = { ...((node.config ?? {}) as Cfg) };
    for (const c of this.controls) {
      if (!c.field.kinds.includes(node.kind)) continue;
      const value = this.read(c);
      if (this.initial.get(c.field.id) === value) continue;
      const bad = c.field.set(cfg, value);
      if (bad) { toast(t(bad), 'error'); return; }
    }
    this.deps.engine.dispatch({ type: 'update_node_config', id: node.id, config: cfg }, 'canvas');
    this.show(node.id);
    toast(`${t('Updated')} ${node.label}`);
  }

  nodeChanged(): void {
    if (!this.current) return;
    if (!this.deps.engine.getDoc().nodes.some((n) => n.id === this.current)) { this.show(null); return; }
    if (this.paneSettings.contains(document.activeElement)) return;
    this.show(this.current);
  }

  setRun(detail: RunDetail | null): void {
    this.detail = detail;
    this.schedule();
  }

  live(nodeId: string, text: string | null): void {
    if (text === null) this.liveText.delete(nodeId); else this.liveText.set(nodeId, text);
    if (nodeId === this.current) this.schedule();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paintRun(); });
  }

  private paintRun(): void {
    const id = this.current;
    if (this.tab !== 'run' || !id) return;
    const detail = this.detail;
    const visits: Visit[] = detail?.nodes[id] ?? [];
    const events: RunEvent[] = detail ? detail.events.filter((e) => e.node_id === id) : [];
    const has = !!detail && (visits.length > 0 || events.length > 0);
    setHidden(this.runNone, has);
    setHidden(this.runView, !has);
    if (!has) {
      setText(this.runNone, detail ? t('This node did not run in the open run.') : t('Open a run in the Runs panel to see this node\'s input, output and log.'));
      return;
    }
    const want = Math.min(this.selectedVisit, Math.max(0, visits.length - 1));
    if (this.visitSel.options.length !== visits.length) {
      this.visitSel.replaceChildren(...visits.map((v, i) => new Option(`${t('Visit')} ${v.n}`, String(i))));
      this.selectedVisit = visits.length ? visits.length - 1 : 0;
      this.visitSel.value = String(this.selectedVisit);
    } else if (this.selectedVisit !== want) {
      this.selectedVisit = want;
    }
    setHidden(this.visitSel, visits.length < 2);
    const v = visits[this.selectedVisit];
    const usage = fmtUsage(detail.usage);
    setText(this.runStatus, v ? `${v.status}${v.ended ? ` · ${(v.ended - v.started).toFixed(1)}s` : ''}${usage ? ` · ${usage}` : ''}` : detail.status);
    setText(this.runInput, v?.input ? v.input : t('(empty)'));
    const live = this.liveText.get(id) ?? '';
    const running = v?.status === 'running';
    setText(this.runLive, live);
    setHidden(this.liveSec, !(running && live));
    setText(this.runOutput, v?.output ?? (running ? t('(running)') : t('(none)')));
    setText(this.runError, v?.error ?? '');
    setHidden(this.errSec, !v?.error);
    const lo = v ? v.seq : 0;
    const hi = v && v.seq_end ? v.seq_end : Number.MAX_SAFE_INTEGER;
    const shown = events.filter((e) => !QUIET_PHASES.has(e.phase) && e.seq >= lo && e.seq <= hi + 1).slice(-LOG_CAP);
    const fill = (node: HTMLElement, e: RunEvent): void => {
      setText(node.children[0], e.phase);
      setText(node.children[1], (e.note ?? '').slice(0, 300));
      const cls = `ri-ev ${PHASE_CLASS[e.phase] ?? ''}`.trim();
      if (node.className !== cls) node.className = cls;
    };
    patchList(this.runLog, shown, {
      key: (e) => `e${e.seq}`,
      create: (e) => {
        const row = document.createElement('div');
        row.className = 'ri-ev';
        row.append(document.createElement('span'), document.createElement('span'));
        (row.children[0] as HTMLElement).className = 'ri-ev-phase';
        (row.children[1] as HTMLElement).className = 'ri-ev-note';
        fill(row, e);
        return row;
      },
      update: fill,
    });
  }
}
