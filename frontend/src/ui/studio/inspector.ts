import { ROUTES, type GraphNode } from '../../engine';
import { listSavedGraphs, listToolNames } from '../../io/studio';
import { el, patchList, q, setClass, setHidden, setText } from '../dom';
import { t } from '../i18n';
import { icon } from '../icons';
import { studio, STUDIO_GRAPHS_CHANGED, type Selection } from './api';
import { FLOW_KINDS, kindMeta } from './kinds';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const ROUTE_POOL = ['accept', 'revise', 'true', 'false', 'each', 'done', 'error'];

const put = (node: Field, value: string): void => {
  if (node.value !== value && document.activeElement !== node) node.value = value;
};

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v === undefined || v === null ? fallback : String(v));

export class Inspector {
  private readonly empty: HTMLElement;
  private readonly nodeForm: HTMLElement;
  private readonly edgeForm: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly label: HTMLInputElement;
  private readonly sections = new Map<string, HTMLElement>();
  private readonly err: HTMLElement;
  private readonly prompt: HTMLTextAreaElement;
  private readonly lean: HTMLInputElement;
  private readonly evalHint: HTMLElement;
  private readonly tool: HTMLInputElement;
  private readonly toolList: HTMLDataListElement;
  private readonly args: HTMLTextAreaElement;
  private readonly evType: HTMLSelectElement;
  private readonly evSeconds: HTMLInputElement;
  private readonly evGlob: HTMLInputElement;
  private readonly evSecondsRow: HTMLElement;
  private readonly evGlobRow: HTMLElement;
  private readonly expr: HTMLInputElement;
  private readonly items: HTMLInputElement;
  private readonly parallel: HTMLInputElement;
  private readonly tmode: HTMLSelectElement;
  private readonly tbody: HTMLTextAreaElement;
  private readonly tlabel: HTMLElement;
  private readonly graph: HTMLSelectElement;
  private readonly gtask: HTMLInputElement;
  private readonly retries: HTMLInputElement;
  private readonly backoff: HTMLInputElement;
  private readonly onErr: HTMLSelectElement;
  private readonly edgeEnds: HTMLElement;
  private readonly edgeLabel: HTMLInputElement;
  private readonly routeBtns: HTMLButtonElement[];
  private readonly edgeDelete: HTMLButtonElement;
  private current = '';
  private frame = 0;
  private toolsLoaded = false;
  private graphNames: string[] = [];
  private graphKey = '\u0000';
  private readonly offs: Array<() => void> = [];

  constructor(host: HTMLElement) {
    const field = (label: string, control: string): string => `<label class="cv-st-f"><span class="cv-st-f-l" data-t="${label}"></span>${control}</label>`;
    host.append(el(
      '<div class="cv-st-insp">' +
      '<p class="cv-st-insp-empty cv-note"></p>' +
      '<div class="cv-st-insp-node" hidden>' +
      '<div class="cv-st-insp-head"><span class="cv-st-chip"></span></div>' +
      field('Label', '<input class="cv-input" data-f="label" spellcheck="false">') +
      '<div class="cv-st-sec" data-sec="prompt">' +
      field('Role prompt', '<textarea class="cv-input cv-st-ta" data-f="prompt" spellcheck="false"></textarea>') +
      '<label class="cv-st-check"><input type="checkbox" data-f="lean"><span data-t="Lean context: meta-tools only, the agent discovers capabilities at run time"></span></label>' +
      '<p class="cv-st-hint cv-note" data-hint="evaluator"></p></div>' +
      '<div class="cv-st-sec" data-sec="tool">' +
      field('Tool', '<input class="cv-input" data-f="tool" list="cv-st-tools" spellcheck="false"><datalist id="cv-st-tools"></datalist>') +
      field('Arguments (JSON object)', '<textarea class="cv-input cv-st-ta cv-st-mono" data-f="args" spellcheck="false"></textarea>') +
      '<p class="cv-st-hint cv-note" data-hint="tool"></p></div>' +
      '<div class="cv-st-sec" data-sec="yield">' +
      field('Park until', '<select class="cv-input" data-f="evtype"><option value="manual">manual</option><option value="delay">delay</option><option value="watch">watch</option><option value="webhook">webhook</option><option value="approval">approval</option></select>') +
      '<div data-row="seconds">' + field('Seconds', '<input class="cv-input" type="number" min="1" data-f="seconds">') + '</div>' +
      '<div data-row="glob">' + field('Glob pattern', '<input class="cv-input cv-st-mono" data-f="glob" spellcheck="false">') + '</div>' +
      '<p class="cv-st-hint cv-note" data-hint="yield"></p></div>' +
      '<div class="cv-st-sec" data-sec="branch">' +
      field('Condition (expression)', '<input class="cv-input cv-st-mono" data-f="expr" spellcheck="false">') +
      '<p class="cv-st-hint cv-note" data-hint="branch"></p></div>' +
      '<div class="cv-st-sec" data-sec="foreach">' +
      field('Items (expression)', '<input class="cv-input cv-st-mono" data-f="items" spellcheck="false">') +
      field('Parallel (1 to 8)', '<input class="cv-input" type="number" min="1" max="8" data-f="parallel">') +
      '<p class="cv-st-hint cv-note" data-hint="foreach"></p></div>' +
      '<div class="cv-st-sec" data-sec="transform">' +
      field('Mode', '<select class="cv-input" data-f="tmode"><option value="template">template</option><option value="expr">expression</option></select>') +
      '<label class="cv-st-f"><span class="cv-st-f-l" data-f="tlabel"></span><textarea class="cv-input cv-st-ta cv-st-mono" data-f="tbody" spellcheck="false"></textarea></label>' +
      '<p class="cv-st-hint cv-note" data-hint="transform"></p></div>' +
      '<div class="cv-st-sec" data-sec="call_graph">' +
      field('Saved graph', '<select class="cv-input" data-f="graph"></select>') +
      field('Context override (optional template)', '<input class="cv-input cv-st-mono" data-f="gtask" spellcheck="false">') +
      '<p class="cv-st-hint cv-note" data-hint="call_graph"></p></div>' +
      '<div class="cv-st-sec" data-sec="flow">' +
      '<div class="cv-st-f-row">' +
      field('Retries', '<input class="cv-input" type="number" min="0" max="10" data-f="retries">') +
      field('Backoff (s)', '<input class="cv-input" type="number" min="0" step="0.5" data-f="backoff">') +
      field('On error', '<select class="cv-input" data-f="onerr"><option value="halt">halt</option><option value="continue">continue</option><option value="route">route</option></select>') +
      '</div></div>' +
      '<div class="cv-st-sec" data-sec="plain"><p class="cv-st-hint cv-note" data-hint="plain"></p></div>' +
      '<p class="cv-st-err" data-f="err"></p>' +
      '</div>' +
      '<div class="cv-st-insp-edge" hidden>' +
      '<div class="cv-st-insp-head"><span class="cv-st-chip is-edge" data-t="Edge"></span><span class="cv-st-ends"></span></div>' +
      field('Label', '<input class="cv-input" data-f="elabel" spellcheck="false">') +
      '<div class="cv-st-routes">' + ROUTE_POOL.map((r) => `<button class="cv-st-route" type="button" data-route="${r}" hidden>${r}</button>`).join('') + '</div>' +
      '<p class="cv-st-hint cv-note" data-hint="edge"></p>' +
      `<button class="cv-btn cv-st-del" type="button" data-f="edel">${icon('delete', 14)}<span data-t="Delete edge"></span></button>` +
      '</div></div>'));
    for (const n of Array.from(host.querySelectorAll<HTMLElement>('[data-t]'))) setText(n, t(n.dataset.t ?? ''));
    const hints: Record<string, string> = {
      evaluator: 'Evaluators end with VERDICT: accept or revise. Label out-edges accept and revise to route them.',
      tool: 'String arguments accept {{task}} {{context}} {{inputs.x}} {{steps.id}} {{item}}.',
      yield: 'manual: resume from the runs panel. delay: resume after N seconds. watch: resume when matching files change. webhook: resume from a trigger. approval: wait for an answer.',
      branch: 'Names: task, context, inputs, steps, item, json. A truthy result follows the true edge, otherwise false.',
      foreach: 'The each edge is the per-item body. The done edge continues after all items join. Body templates read {{item}} and {{item.key}}.',
      transform: 'Template: {{task}} {{context}} {{inputs.x}} {{steps.node_id}} {{item.key}}. Expression: python over the same names, the result becomes the context.',
      call_graph: 'Runs the saved graph inline as a subflow. Its end-node context returns here.',
      plain: '',
      edge: 'Labels route evaluator, branch and foreach nodes. An edge labeled error is taken when a node fails with on error set to route.',
    };
    for (const n of Array.from(host.querySelectorAll<HTMLElement>('[data-hint]'))) setText(n, t(hints[n.dataset.hint ?? ''] ?? ''));
    const f = (name: string): Field => q<Field>(host, `[data-f="${name}"]`);
    this.empty = q(host, '.cv-st-insp-empty');
    setText(this.empty, t('Select a node or an edge to edit it.'));
    this.nodeForm = q(host, '.cv-st-insp-node');
    this.edgeForm = q(host, '.cv-st-insp-edge');
    this.chip = q(host, '.cv-st-chip');
    this.label = f('label') as HTMLInputElement;
    for (const s of Array.from(host.querySelectorAll<HTMLElement>('[data-sec]'))) this.sections.set(s.dataset.sec ?? '', s);
    this.err = q(host, '[data-f="err"]');
    this.prompt = f('prompt') as HTMLTextAreaElement;
    this.lean = f('lean') as HTMLInputElement;
    this.evalHint = q(host, '[data-hint="evaluator"]');
    this.tool = f('tool') as HTMLInputElement;
    this.toolList = q<HTMLDataListElement>(host, '#cv-st-tools');
    this.args = f('args') as HTMLTextAreaElement;
    this.evType = f('evtype') as HTMLSelectElement;
    this.evSeconds = f('seconds') as HTMLInputElement;
    this.evGlob = f('glob') as HTMLInputElement;
    this.evSecondsRow = q(host, '[data-row="seconds"]');
    this.evGlobRow = q(host, '[data-row="glob"]');
    this.expr = f('expr') as HTMLInputElement;
    this.items = f('items') as HTMLInputElement;
    this.parallel = f('parallel') as HTMLInputElement;
    this.tmode = f('tmode') as HTMLSelectElement;
    this.tbody = f('tbody') as HTMLTextAreaElement;
    this.tlabel = q(host, '[data-f="tlabel"]');
    this.graph = f('graph') as HTMLSelectElement;
    this.gtask = f('gtask') as HTMLInputElement;
    this.retries = f('retries') as HTMLInputElement;
    this.backoff = f('backoff') as HTMLInputElement;
    this.onErr = f('onerr') as HTMLSelectElement;
    this.edgeEnds = q(host, '.cv-st-ends');
    this.edgeLabel = f('elabel') as HTMLInputElement;
    this.routeBtns = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-route]'));
    this.edgeDelete = q<HTMLButtonElement>(host, '[data-f="edel"]');
    for (const o of Array.from(host.querySelectorAll<HTMLOptionElement>('select option'))) o.textContent = t(o.value);
    this.wire();
    this.offs.push(studio.onSelect(() => this.queue()));
    this.offs.push(studio.engine.onChange(() => this.queue()));
    const reload = (): void => { void this.loadGraphs(); };
    window.addEventListener(STUDIO_GRAPHS_CHANGED, reload);
    this.offs.push(() => window.removeEventListener(STUDIO_GRAPHS_CHANGED, reload));
    this.render();
    void this.loadGraphs();
  }

  dispose(): void {
    for (const off of this.offs) off();
    cancelAnimationFrame(this.frame);
  }

  private queue(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }

  private async loadGraphs(): Promise<void> {
    try {
      const rows = await listSavedGraphs();
      this.graphNames = rows.map((r) => r.name);
    } catch {
      this.graphNames = [];
    }
    this.render();
  }

  private async loadTools(): Promise<void> {
    if (this.toolsLoaded) return;
    this.toolsLoaded = true;
    const names = await listToolNames();
    patchList<string>(this.toolList, names, {
      key: (n) => n,
      create: (n) => { const o = document.createElement('option'); o.value = n; return o; },
      update: () => undefined,
    });
  }

  private node(): GraphNode | undefined {
    const sel = studio.selection;
    return sel?.kind === 'node' ? studio.getDoc().nodes.find((n) => n.id === sel.id) : undefined;
  }

  private render(): void {
    const sel: Selection = studio.selection;
    const node = this.node();
    const edge = sel?.kind === 'edge' ? studio.getDoc().edges.find((e) => e.id === sel.id) : undefined;
    setHidden(this.empty, !!node || !!edge);
    setHidden(this.nodeForm, !node);
    setHidden(this.edgeForm, !edge);
    if (edge) this.renderEdge(edge.id, edge.from, edge.to, edge.label ?? '');
    if (!node) { this.current = ''; return; }
    const cfg = (node.config ?? {}) as Record<string, unknown>;
    const k = node.kind;
    this.current = node.id;
    setText(this.chip, t(kindMeta(k).label));
    this.chip.dataset.kind = k;
    put(this.label, node.label);
    const show = (name: string, on: boolean): void => { const s = this.sections.get(name); if (s) setHidden(s, !on); };
    show('prompt', k === 'agent' || k === 'evaluator');
    show('tool', k === 'tool');
    show('yield', k === 'yield');
    show('branch', k === 'branch');
    show('foreach', k === 'foreach');
    show('transform', k === 'transform');
    show('call_graph', k === 'call_graph');
    show('flow', FLOW_KINDS.has(k));
    show('plain', k === 'start' || k === 'end');
    setHidden(this.evalHint, k !== 'evaluator');
    const plain = this.sections.get('plain')?.querySelector<HTMLElement>('.cv-st-hint');
    if (plain) setText(plain, t(k === 'start' ? 'The run enters here.' : 'Reaching this node completes the run.'));
    if (k === 'agent' || k === 'evaluator') {
      put(this.prompt, str(cfg.prompt));
      if (this.lean.checked !== !!cfg.lean) this.lean.checked = !!cfg.lean;
    } else if (k === 'tool') {
      void this.loadTools();
      put(this.tool, str(cfg.tool));
      if (document.activeElement !== this.args) put(this.args, JSON.stringify(cfg.args ?? {}, null, 2));
    } else if (k === 'yield') {
      const ev = (cfg.event && typeof cfg.event === 'object' ? cfg.event : { type: 'manual' }) as Record<string, unknown>;
      const type = str(ev.type, 'manual');
      put(this.evType, type);
      put(this.evSeconds, str(ev.seconds, '60'));
      put(this.evGlob, str(ev.glob, '**/*'));
      setHidden(this.evSecondsRow, type !== 'delay');
      setHidden(this.evGlobRow, type !== 'watch');
    } else if (k === 'branch') {
      put(this.expr, str(cfg.expr));
    } else if (k === 'foreach') {
      put(this.items, str(cfg.items));
      put(this.parallel, str(cfg.parallel, '1'));
    } else if (k === 'transform') {
      const mode = cfg.expr ? 'expr' : 'template';
      put(this.tmode, mode);
      setText(this.tlabel, t(mode === 'expr' ? 'Expression' : 'Template'));
      put(this.tbody, mode === 'expr' ? str(cfg.expr) : str(cfg.template, '{{context}}'));
    } else if (k === 'call_graph') {
      this.fillGraphs(str(cfg.graph));
      put(this.gtask, str(cfg.task));
    }
    if (FLOW_KINDS.has(k)) {
      put(this.retries, str(cfg.retries, '0'));
      put(this.backoff, str(cfg.backoff_s, '1'));
      put(this.onErr, str(cfg.on_error, 'halt'));
    }
    setClass(this.args, 'is-invalid', false);
    setText(this.err, '');
  }

  private fillGraphs(current: string): void {
    const names = this.graphNames.includes(current) || !current ? this.graphNames : [current, ...this.graphNames];
    const key = names.join('\n');
    if (key !== this.graphKey) {
      this.graphKey = key;
      patchList<string>(this.graph, names.length ? names : [''], {
        key: (n) => n || '__none',
        create: (n) => { const o = document.createElement('option'); o.value = n; o.textContent = n || t('no saved graphs'); return o; },
        update: (n, v) => { (n as HTMLOptionElement).textContent = v || t('no saved graphs'); },
      });
    }
    put(this.graph, current || names[0] || '');
  }

  private renderEdge(id: string, from: string, to: string, label: string): void {
    const doc = studio.getDoc();
    const a = doc.nodes.find((n) => n.id === from), b = doc.nodes.find((n) => n.id === to);
    setText(this.edgeEnds, `${a?.label ?? from} → ${b?.label ?? to}`);
    put(this.edgeLabel, label);
    const routes = [...(a ? ROUTES[a.kind] ?? [] : []), 'error'];
    for (const b2 of this.routeBtns) {
      const r = b2.dataset.route ?? '';
      setHidden(b2, !routes.includes(r));
      setClass(b2, 'is-on', r === label);
    }
    this.edgeForm.dataset.edge = id;
  }

  private apply(): void {
    const node = this.node();
    if (!node || node.id !== this.current) return;
    const k = node.kind;
    const cfg: Record<string, unknown> = structuredClone(node.config ?? {});
    const flow = (): void => {
      const retries = Math.max(0, Math.min(10, Math.round(Number(this.retries.value || 0))));
      const backoff = Number(this.backoff.value || 1);
      const onErr = this.onErr.value;
      if (retries > 0) cfg.retries = retries; else delete cfg.retries;
      if (retries > 0 && backoff !== 1) cfg.backoff_s = backoff; else delete cfg.backoff_s;
      if (onErr !== 'halt') cfg.on_error = onErr; else delete cfg.on_error;
    };
    if (k === 'agent' || k === 'evaluator') {
      cfg.prompt = this.prompt.value;
      if (this.lean.checked) cfg.lean = true; else delete cfg.lean;
    } else if (k === 'tool') {
      let args: unknown = {};
      try {
        args = JSON.parse(this.args.value || '{}');
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('not an object');
      } catch {
        setClass(this.args, 'is-invalid', true);
        setText(this.err, t('Tool arguments must be a JSON object.'));
        return;
      }
      setClass(this.args, 'is-invalid', false);
      setText(this.err, '');
      cfg.tool = this.tool.value.trim();
      cfg.args = args;
    } else if (k === 'yield') {
      const type = this.evType.value;
      const event: Record<string, unknown> = { type };
      if (type === 'delay') event.seconds = Math.max(1, Number(this.evSeconds.value || 60));
      if (type === 'watch') event.glob = this.evGlob.value || '**/*';
      cfg.event = event;
    } else if (k === 'branch') {
      cfg.expr = this.expr.value;
    } else if (k === 'foreach') {
      cfg.items = this.items.value;
      cfg.parallel = Math.max(1, Math.min(8, Math.round(Number(this.parallel.value || 1))));
    } else if (k === 'transform') {
      if (this.tmode.value === 'expr') { cfg.expr = this.tbody.value; cfg.template = ''; } else { cfg.template = this.tbody.value; cfg.expr = ''; }
    } else if (k === 'call_graph') {
      cfg.graph = this.graph.value;
      cfg.task = this.gtask.value;
    }
    if (FLOW_KINDS.has(k)) flow();
    const hasCfg = Object.keys(cfg).length > 0;
    studio.engine.dispatch({ type: 'update_node', id: node.id, label: this.label.value.trim() || node.label, config: hasCfg ? cfg : (node.config ? {} : undefined) }, 'canvas');
  }

  private wire(): void {
    const targets: Field[] = [this.label, this.prompt, this.lean, this.tool, this.args, this.evType, this.evSeconds, this.evGlob, this.expr, this.items, this.parallel, this.tmode, this.tbody, this.graph, this.gtask, this.retries, this.backoff, this.onErr];
    for (const f of targets) f.addEventListener('change', () => this.apply());
    this.tmode.addEventListener('change', () => setText(this.tlabel, t(this.tmode.value === 'expr' ? 'Expression' : 'Template')));
    for (const f of [this.label, this.tool, this.expr, this.items, this.evGlob, this.gtask]) {
      f.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') this.apply(); });
    }
    this.edgeLabel.addEventListener('change', () => {
      const id = this.edgeForm.dataset.edge;
      if (id) studio.engine.dispatch({ type: 'update_edge', id, label: this.edgeLabel.value.trim() }, 'canvas');
    });
    this.edgeLabel.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.edgeLabel.blur(); });
    for (const b of this.routeBtns) {
      b.addEventListener('click', () => {
        const id = this.edgeForm.dataset.edge;
        if (id) studio.engine.dispatch({ type: 'update_edge', id, label: b.dataset.route ?? '' }, 'canvas');
      });
    }
    this.edgeDelete.addEventListener('click', () => {
      const id = this.edgeForm.dataset.edge;
      if (!id) return;
      studio.select(null);
      studio.engine.dispatch({ type: 'remove_edge', id }, 'canvas');
    });
  }
}
