import { DapConnection, debugAdapters, frameOf, scopeOf, variableOf, type DapEvent, type DapStackFrame, type DebugAdapter } from '../../io/debug';
import { el, patchList as patchKeyed, q, setClass, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { breakpointPaths, breakpointsOf, clearBreakpoints, onBreakpoints, setDebugLocation, toggleBreakpointAtCursor } from '../../ui/editor/breakpoints';
import { onLanguage, t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { FOCUS_EVENT } from '../../ui/workbench';
import { register, type ExtensionContext, type Shell, type SidebarSection } from '../registry';

type Phase = 'idle' | 'starting' | 'running' | 'paused';
type StepKind = 'next' | 'stepIn' | 'stepOut';
type LineKind = 'out' | 'err' | 'in' | 'result' | 'info';

interface ConsoleLine { id: number; kind: LineKind; text: string }
interface Frame extends DapStackFrame { local: string }
interface VarNode {
  key: string;
  name: string;
  value: string;
  type: string;
  ref: number;
  depth: number;
  scope: boolean;
  kids: VarNode[] | null;
}

const CONSOLE_CAP = 600;
const VAR_CAP = 200;
const DEPTH_CAP = 8;
const FRAMES_CAP = 60;
const HISTORY_CAP = 50;
const SAVE_WAIT_MS = 4000;
const STOP_WAIT_MS = 1500;
const PY = /\.py$/i;

interface Patch<T> { key(item: T): string; create(): HTMLElement; update(node: HTMLElement, item: T): void }

function patchList<T>(container: HTMLElement, items: T[], opts: Patch<T>): void {
  patchKeyed(container, items, {
    key: opts.key,
    create: (item) => { const node = opts.create(); opts.update(node, item); return node; },
    update: opts.update,
  });
}

const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const sleep = (ms: number): Promise<void> => new Promise((r) => { window.setTimeout(r, ms); });
const failText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  let has = false;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = ''; else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

class DebugPanel {
  private readonly buttons: Record<'start' | 'continue' | 'next' | 'stepIn' | 'stepOut' | 'stop', HTMLButtonElement>;
  private readonly stateEl: HTMLElement;
  private readonly adapterEl: HTMLElement;
  private readonly argsEl: HTMLInputElement;
  private readonly stackEl: HTMLElement;
  private readonly stackCount: HTMLElement;
  private readonly varsEl: HTMLElement;
  private readonly varsEmpty: HTMLElement;
  private readonly consoleEl: HTMLElement;
  private readonly exprEl: HTMLInputElement;
  private phase: Phase = 'idle';
  private note = '';
  private conn: DapConnection | null = null;
  private root = '';
  private sessionRoot = '';
  private wsPath = '';
  private startSeq = 0;
  private adapter: DebugAdapter | null = null;
  private adapterError = '';
  private threadId = 0;
  private frames: Frame[] = [];
  private selected = 0;
  private roots: VarNode[] = [];
  private readonly open = new Set<string>(['Locals']);
  private varSeq = 0;
  private lines: ConsoleLine[] = [];
  private lineId = 0;
  private partial = false;
  private exitCode: number | null = null;
  private refusal = '';
  private configured = false;
  private readonly history: string[] = [];
  private historyAt = -1;
  private pausedAt = '';

  constructor(private readonly host: HTMLElement, private readonly ctx: ExtensionContext, private readonly shell: Shell) {
    host.append(el(
      '<div class="cv-dbg">' +
      '<div class="cv-dbg-bar">' +
      `<button class="cv-wb-tool" type="button" data-act="start">${icon('play', 14)}</button>` +
      `<button class="cv-wb-tool" type="button" data-act="continue">${icon('debugContinue', 14)}</button>` +
      `<button class="cv-wb-tool" type="button" data-act="next">${icon('stepOver', 14)}</button>` +
      `<button class="cv-wb-tool" type="button" data-act="stepIn">${icon('stepInto', 14)}</button>` +
      `<button class="cv-wb-tool" type="button" data-act="stepOut">${icon('stepOut', 14)}</button>` +
      `<button class="cv-wb-tool cv-dbg-stop" type="button" data-act="stop">${icon('stop', 14)}</button>` +
      '<span class="cv-dbg-state"></span></div>' +
      '<div class="cv-dbg-meta"><span class="cv-dbg-adapter cv-note"></span></div>' +
      '<div class="cv-dbg-args"><input class="cv-input cv-dbg-argin" type="text" spellcheck="false" autocomplete="off"></div>' +
      '<div class="cv-dbg-sec cv-dbg-sec-stack"><div class="cv-dbg-head"><span class="cv-dbg-head-t"></span><span class="cv-dbg-head-n"></span></div>' +
      '<div class="cv-dbg-list cv-dbg-stack" role="listbox"></div></div>' +
      '<div class="cv-dbg-sec cv-dbg-sec-vars"><div class="cv-dbg-head"><span class="cv-dbg-head-t"></span></div>' +
      '<div class="cv-dbg-list cv-dbg-vars" role="tree"></div><p class="cv-dbg-empty cv-note"></p></div>' +
      '<div class="cv-dbg-sec cv-dbg-sec-console"><div class="cv-dbg-head"><span class="cv-dbg-head-t"></span></div>' +
      '<div class="cv-dbg-list cv-dbg-console" role="log"></div>' +
      '<div class="cv-dbg-exprrow"><input class="cv-input cv-dbg-expr" type="text" spellcheck="false" autocomplete="off"></div></div>' +
      '</div>'));
    this.buttons = {
      start: q(host, '[data-act="start"]'),
      continue: q(host, '[data-act="continue"]'),
      next: q(host, '[data-act="next"]'),
      stepIn: q(host, '[data-act="stepIn"]'),
      stepOut: q(host, '[data-act="stepOut"]'),
      stop: q(host, '[data-act="stop"]'),
    };
    this.stateEl = q(host, '.cv-dbg-state');
    this.adapterEl = q(host, '.cv-dbg-adapter');
    this.argsEl = q(host, '.cv-dbg-argin');
    this.stackEl = q(host, '.cv-dbg-stack');
    this.stackCount = q(host, '.cv-dbg-head-n');
    this.varsEl = q(host, '.cv-dbg-vars');
    this.varsEmpty = q(host, '.cv-dbg-empty');
    this.consoleEl = q(host, '.cv-dbg-console');
    this.exprEl = q(host, '.cv-dbg-expr');
    this.bind();
    this.relabel();
    onLanguage(() => { this.relabel(); this.paint(); });
    this.wsPath = ctx.store.workspace?.path ?? '';
    ctx.store.on('workspace', (ws) => {
      const next = ws?.path ?? '';
      if (next !== this.wsPath) {
        this.wsPath = next;
        clearBreakpoints();
        this.root = '';
        if (this.phase !== 'idle') void this.stop();
      }
      void this.refreshAdapter();
    });
    ctx.store.on('active', () => this.paint());
    ctx.store.on('docs', () => this.paint());
    host.addEventListener(FOCUS_EVENT, () => { void this.refreshAdapter(); });
    onBreakpoints((path) => { void this.sendBreakpoints(path); });
    this.paint();
    void this.refreshAdapter();
  }

  get currentPhase(): Phase { return this.phase; }

  canStart(): boolean {
    const doc = this.ctx.store.active;
    return this.phase === 'idle' && !!this.ctx.store.workspace && !!doc && PY.test(doc.path);
  }

  canStep(): boolean { return this.phase === 'paused'; }
  canStop(): boolean { return this.phase !== 'idle'; }

  private relabel(): void {
    const names: Array<[HTMLButtonElement, string]> = [
      [this.buttons.start, 'Start Debugging'],
      [this.buttons.continue, 'Continue'],
      [this.buttons.next, 'Step Over'],
      [this.buttons.stepIn, 'Step Into'],
      [this.buttons.stepOut, 'Step Out'],
      [this.buttons.stop, 'Stop'],
    ];
    const keys: Record<string, string> = { start: 'F5', continue: 'F5', next: 'F10', stepIn: 'F11', stepOut: 'Shift+F11', stop: 'Shift+F5' };
    for (const [b, name] of names) {
      const key = keys[b.dataset.act ?? ''];
      setTitle(b, key ? `${t(name)} (${key})` : t(name));
      if (b.getAttribute('aria-label') !== t(name)) b.setAttribute('aria-label', t(name));
    }
    this.argsEl.placeholder = t('Arguments');
    this.exprEl.placeholder = t('Evaluate an expression');
    setText(q(this.host, '.cv-dbg-sec-stack .cv-dbg-head-t'), t('Call Stack'));
    setText(q(this.host, '.cv-dbg-sec-vars .cv-dbg-head-t'), t('Variables'));
    setText(q(this.host, '.cv-dbg-sec-console .cv-dbg-head-t'), t('Debug Console'));
    setText(this.varsEmpty, t('Variables appear when the program is paused'));
  }

  private bind(): void {
    const on = (b: HTMLButtonElement, fn: () => void): void => { b.addEventListener('click', fn); };
    on(this.buttons.start, () => { void this.start(); });
    on(this.buttons.continue, () => { void this.resume(); });
    on(this.buttons.next, () => { void this.step('next'); });
    on(this.buttons.stepIn, () => { void this.step('stepIn'); });
    on(this.buttons.stepOut, () => { void this.step('stepOut'); });
    on(this.buttons.stop, () => { void this.stop(); });
    this.argsEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (this.canStart()) void this.start(); }
    });
    this.stackEl.addEventListener('click', (e) => {
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-dbg-frame') : null;
      const frame = this.frames.find((f) => String(f.id) === row?.dataset.frame);
      if (frame) void this.selectFrame(frame);
    });
    this.varsEl.addEventListener('click', (e) => {
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-dbg-var') : null;
      const node = this.findNode(row?.dataset.node ?? '');
      if (node) void this.toggleNode(node);
    });
    this.exprEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.exprEl.value.trim();
        if (text) { this.remember(text); this.exprEl.value = ''; void this.evaluate(text); }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.recall(e.key === 'ArrowUp' ? 1 : -1);
      }
    });
  }

  private remember(text: string): void {
    if (this.history[0] !== text) this.history.unshift(text);
    if (this.history.length > HISTORY_CAP) this.history.length = HISTORY_CAP;
    this.historyAt = -1;
  }

  private recall(by: number): void {
    const next = Math.max(-1, Math.min(this.history.length - 1, this.historyAt + by));
    this.historyAt = next;
    this.exprEl.value = next < 0 ? '' : this.history[next];
  }

  async refreshAdapter(): Promise<void> {
    if (!this.ctx.store.workspace) {
      this.adapter = null;
      this.adapterError = '';
      this.paint();
      return;
    }
    try {
      const info = await debugAdapters();
      this.adapter = info.adapters.find((a) => a.id === 'python') ?? null;
      this.root = info.root ?? this.root;
      this.adapterError = '';
    } catch (err) {
      this.adapter = null;
      this.adapterError = failText(err);
    }
    this.paint();
  }

  private adapterText(): string {
    if (!this.ctx.store.workspace) return t('Open a folder to debug');
    if (this.adapterError) return this.adapterError;
    const a = this.adapter;
    if (!a) return t('Checking for debugpy');
    if (a.available) return `debugpy ${a.debugpy ?? ''} · ${t(a.source ?? '')}`;
    return `${t('debugpy was not found.')} ${a.install ? `${t('Install')}: ${a.install}` : a.note}`;
  }

  private stateText(): string {
    if (this.phase === 'starting') return t('Starting');
    if (this.phase === 'running') return t('Running');
    if (this.phase === 'paused') return this.pausedAt ? `${t('Paused')} · ${this.pausedAt}` : t('Paused');
    return this.note || t('Ready');
  }

  private paint(): void {
    const p = this.phase;
    setDisabled(this.buttons.start, !this.canStart());
    setDisabled(this.buttons.continue, p !== 'paused');
    setDisabled(this.buttons.next, p !== 'paused');
    setDisabled(this.buttons.stepIn, p !== 'paused');
    setDisabled(this.buttons.stepOut, p !== 'paused');
    setDisabled(this.buttons.stop, p === 'idle');
    setDisabled(this.argsEl, p !== 'idle');
    setDisabled(this.exprEl, p !== 'paused');
    const state = this.stateText();
    setText(this.stateEl, state);
    setTitle(this.stateEl, state);
    setClass(this.stateEl, 'is-paused', p === 'paused');
    setClass(this.stateEl, 'is-running', p === 'running' || p === 'starting');
    const adapter = this.adapterText();
    setText(this.adapterEl, adapter);
    setTitle(this.adapterEl, adapter);
    setClass(this.adapterEl, 'is-missing', !!this.adapterError || (!!this.adapter && !this.adapter.available));
    setText(this.stackCount, this.frames.length ? String(this.frames.length) : '');
    setHidden(this.varsEmpty, this.roots.length > 0);
    this.paintStack();
    this.paintVars();
    this.paintConsole();
  }

  private paintStack(): void {
    patchList(this.stackEl, this.frames, {
      key: (f) => `f:${f.id}`,
      create: () => el('<div class="cv-dbg-row cv-dbg-frame" role="option"><span class="cv-dbg-fn"></span><span class="cv-dbg-fl"></span></div>'),
      update: (node, f) => {
        node.dataset.frame = String(f.id);
        setText(q(node, '.cv-dbg-fn'), f.name);
        setText(q(node, '.cv-dbg-fl'), f.path ? `${baseOf(f.path)}:${f.line}` : '');
        setClass(node, 'is-selected', f.id === this.selected);
        setClass(node, 'is-outside', !f.local);
        const sel = String(f.id === this.selected);
        if (node.getAttribute('aria-selected') !== sel) node.setAttribute('aria-selected', sel);
      },
    });
  }

  private flatten(): VarNode[] {
    const out: VarNode[] = [];
    const walk = (nodes: VarNode[]): void => {
      for (const n of nodes) {
        out.push(n);
        if (n.kids && this.open.has(n.key)) walk(n.kids);
      }
    };
    walk(this.roots);
    return out;
  }

  private findNode(key: string): VarNode | undefined {
    return this.flatten().find((n) => n.key === key);
  }

  private paintVars(): void {
    patchList(this.varsEl, this.flatten(), {
      key: (n) => `v:${n.key}`,
      create: () => el(
        `<div class="cv-dbg-row cv-dbg-var" role="treeitem"><span class="cv-dbg-twist">${icon('chevronRight', 12)}</span>` +
        '<span class="cv-dbg-vn"></span><span class="cv-dbg-vv"></span></div>'),
      update: (node, n) => {
        node.dataset.node = n.key;
        if (node.style.getPropertyValue('--depth') !== String(n.depth)) node.style.setProperty('--depth', String(n.depth));
        setText(q(node, '.cv-dbg-vn'), n.name);
        setText(q(node, '.cv-dbg-vv'), n.scope ? '' : n.value);
        setTitle(node, n.scope ? n.name : `${n.name}: ${n.type ? `${n.type} = ` : ''}${n.value}`);
        setClass(node, 'is-expandable', n.ref > 0);
        setClass(node, 'is-open', n.ref > 0 && this.open.has(n.key));
        setClass(node, 'is-scope', n.scope);
        const expanded = n.ref > 0 ? String(this.open.has(n.key)) : '';
        if (expanded) { if (node.getAttribute('aria-expanded') !== expanded) node.setAttribute('aria-expanded', expanded); } else if (node.hasAttribute('aria-expanded')) node.removeAttribute('aria-expanded');
      },
    });
  }

  private paintConsole(): void {
    const stick = this.consoleEl.scrollHeight - this.consoleEl.scrollTop - this.consoleEl.clientHeight < 24;
    patchList(this.consoleEl, this.lines, {
      key: (l) => `l:${l.id}`,
      create: () => el('<div class="cv-dbg-line"></div>'),
      update: (node, l) => {
        if (node.dataset.kind !== l.kind) node.dataset.kind = l.kind;
        setText(node, l.text);
      },
    });
    if (stick) this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
  }

  private log(kind: LineKind, text: string): void {
    const parts = text.split(/\r?\n/);
    const endsOpen = !/\n$/.test(text);
    if (parts[parts.length - 1] === '') parts.pop();
    parts.forEach((part, i) => {
      const last = this.lines[this.lines.length - 1];
      if (i === 0 && this.partial && last && last.kind === kind) last.text += part;
      else this.lines.push({ id: ++this.lineId, kind, text: part });
    });
    this.partial = endsOpen && parts.length > 0 && (kind === 'out' || kind === 'err');
    if (this.lines.length > CONSOLE_CAP) this.lines = this.lines.slice(this.lines.length - CONSOLE_CAP);
    this.paintConsole();
  }

  private toRel(abs: string): string {
    if (!abs || !this.sessionRoot) return '';
    const root = this.sessionRoot.replace(/[\\/]+$/, '');
    const flat = abs.replace(/\\/g, '/');
    const base = root.replace(/\\/g, '/');
    return flat.startsWith(`${base}/`) ? flat.slice(base.length + 1) : '';
  }

  private absOf(rel: string): string {
    return `${this.sessionRoot.replace(/[\\/]+$/, '')}/${rel}`;
  }

  private waitFor(conn: DapConnection, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const offEvent = conn.onEvent((e) => { if (e.event === name) { offEvent(); offClose(); resolve(); } });
      const offClose = conn.onClose(() => { offEvent(); offClose(); reject(new Error('Disconnected')); });
    });
  }

  private async saveFirst(path: string): Promise<boolean> {
    const doc = this.ctx.store.docs.find((d) => d.path === path);
    if (!doc?.modified) return true;
    this.ctx.commands.run('save');
    const until = Date.now() + SAVE_WAIT_MS;
    while (Date.now() < until) {
      await sleep(80);
      if (!this.ctx.store.docs.find((d) => d.path === path)?.modified) return true;
    }
    return false;
  }

  async start(): Promise<void> {
    if (!this.canStart()) return;
    const doc = this.ctx.store.active;
    if (!doc) return;
    const seq = ++this.startSeq;
    this.phase = 'starting';
    this.note = '';
    this.paint();
    const saved = await this.saveFirst(doc.path);
    if (seq !== this.startSeq) return;
    if (!saved) {
      this.reset('');
      this.shell.setStatus(t('Save the file before debugging'), 'error');
      return;
    }
    await this.refreshAdapter();
    if (seq !== this.startSeq) return;
    const adapter = this.adapter;
    if (!adapter?.available) {
      this.reset('');
      this.shell.setStatus(adapter?.install ? `${t('debugpy was not found.')} ${t('Install')}: ${adapter.install}` : t('No debug adapter is available'), 'error');
      return;
    }
    this.sessionRoot = this.root;
    this.refusal = '';
    this.configured = false;
    this.exitCode = null;
    this.lines = [];
    this.partial = false;
    this.frames = [];
    this.roots = [];
    this.paint();
    const conn = new DapConnection();
    this.conn = conn;
    conn.onEvent((e) => { if (this.conn === conn) this.onEvent(e); });
    conn.onClose((reason) => { this.onClosed(conn, reason); });
    try {
      await conn.open();
      await conn.request('initialize', { clientID: 'subform', clientName: 'subform', adapterID: 'python', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsVariableType: true });
      const initialized = this.waitFor(conn, 'initialized');
      const launching = conn.request('launch', { program: doc.path, args: splitArgs(this.argsEl.value) }).then(() => '', (err: unknown) => failText(err));
      initialized.catch(() => undefined);
      await Promise.race([initialized, launching.then((failed) => (failed ? Promise.reject(new Error(failed)) : new Promise<never>(() => undefined)))]);
      this.configured = true;
      for (const path of breakpointPaths()) await this.sendBreakpoints(path, true);
      await conn.request('configurationDone');
      const failed = await launching;
      if (failed) throw new Error(failed);
      if (this.conn === conn && this.phase === 'starting') { this.phase = 'running'; this.paint(); }
    } catch (err) {
      if (this.conn !== conn) return;
      const text = this.refusal || failText(err);
      this.log('info', text);
      this.shell.setStatus(`${t('Debugging failed')}: ${text}`, 'error');
      await this.end(t('Failed to start'));
    }
  }

  private async sendBreakpoints(path: string, report = false): Promise<void> {
    const conn = this.conn;
    if (!conn || !conn.isOpen || !this.configured || !this.root) return;
    const lines = breakpointsOf(path);
    try {
      const res = await conn.request<{ breakpoints?: Array<{ verified?: boolean; line?: number }> }>('setBreakpoints', { source: { path: this.absOf(path) }, breakpoints: lines.map((line) => ({ line })), lines });
      if (!report) return;
      for (const [i, b] of (res.breakpoints ?? []).entries()) {
        if (b.verified === false) this.log('info', `${t('Breakpoint not verified')}: ${baseOf(path)}:${lines[i] ?? b.line ?? ''}`);
      }
    } catch (err) {
      this.log('info', failText(err));
    }
  }

  private onEvent(e: DapEvent): void {
    const body = e.body;
    if (e.event === 'output') {
      const category = typeof body.category === 'string' ? body.category : 'console';
      if (category === 'telemetry' || typeof body.output !== 'string') return;
      this.log(category === 'stderr' ? 'err' : category === 'console' || category === 'important' ? 'info' : 'out', body.output);
    } else if (e.event === 'stopped') {
      this.threadId = Number(body.threadId ?? this.threadId);
      this.phase = 'paused';
      this.paint();
      void this.refreshStack();
    } else if (e.event === 'continued') {
      if (this.phase === 'paused') { this.phase = 'running'; this.paint(); }
    } else if (e.event === 'exited') {
      this.exitCode = Number(body.exitCode ?? 0);
    } else if (e.event === 'terminated') {
      void this.end(this.exitCode === null ? t('Finished') : `${t('Finished')} · ${t('exit code')} ${this.exitCode}`);
    } else if (e.event === 'subform/adapterExited') {
      const tail = typeof body.stderr === 'string' ? body.stderr : '';
      if (tail) this.log('err', tail);
      void this.end(t('Adapter stopped'));
    } else if (e.event === 'subform/busy' || e.event === 'subform/unavailable') {
      const message = typeof body.message === 'string' ? body.message : '';
      const install = typeof body.install === 'string' && body.install ? ` ${t('Install')}: ${body.install}` : '';
      this.refusal = `${message}${install}`;
    }
  }

  private onClosed(conn: DapConnection, reason: string): void {
    if (this.conn !== conn) return;
    this.conn = null;
    const note = this.refusal ? this.refusal : reason === 'closed' ? t('Disconnected') : reason;
    if (this.phase !== 'idle') this.log('info', note);
    this.reset(this.refusal ? t('Failed to start') : t('Disconnected'));
  }

  private reset(note: string): void {
    this.phase = 'idle';
    this.note = note;
    this.threadId = 0;
    this.frames = [];
    this.selected = 0;
    this.roots = [];
    this.pausedAt = '';
    this.varSeq++;
    setDebugLocation(null);
    this.paint();
  }

  private async end(note: string): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    this.conn = null;
    if (conn.isOpen) {
      await Promise.race([conn.request('disconnect', { terminateDebuggee: true }).catch(() => undefined), sleep(STOP_WAIT_MS)]);
    }
    conn.close();
    this.reset(note);
  }

  async stop(): Promise<void> {
    if (this.phase === 'idle') return;
    this.startSeq++;
    this.log('info', t('Debug session stopped'));
    if (!this.conn) {
      this.reset(t('Stopped'));
      return;
    }
    await this.end(t('Stopped'));
  }

  private async refreshStack(): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    try {
      const res = await conn.request<{ stackFrames?: Array<Record<string, unknown>> }>('stackTrace', { threadId: this.threadId, levels: FRAMES_CAP });
      if (this.conn !== conn || this.phase !== 'paused') return;
      this.frames = (res.stackFrames ?? []).map((raw) => {
        const f = frameOf(raw);
        return { ...f, local: this.toRel(f.path) };
      });
      const top = this.frames.find((f) => f.local) ?? this.frames[0];
      if (top) await this.selectFrame(top);
      else this.paint();
    } catch (err) {
      this.log('info', failText(err));
    }
  }

  private async selectFrame(frame: Frame): Promise<void> {
    this.selected = frame.id;
    this.pausedAt = frame.path ? `${baseOf(frame.path)}:${frame.line}` : frame.name;
    if (frame.local) {
      setDebugLocation({ path: frame.local, line: frame.line });
      if (this.ctx.store.active?.path !== frame.local) this.shell.openEditorTab(frame.local);
    } else {
      setDebugLocation(null);
    }
    this.paint();
    await this.loadScopes(frame.id);
  }

  private async loadScopes(frameId: number): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    const seq = ++this.varSeq;
    try {
      const res = await conn.request<{ scopes?: Array<Record<string, unknown>> }>('scopes', { frameId });
      const roots = (res.scopes ?? []).map((raw) => {
        const s = scopeOf(raw);
        const node: VarNode = { key: s.name, name: s.name, value: '', type: '', ref: s.variablesReference, depth: 0, scope: true, kids: null };
        return node;
      });
      for (const n of roots) {
        if (!this.open.has(n.key)) continue;
        try { await this.fetchKids(conn, n, seq); } catch (err) { if (seq === this.varSeq) this.log('info', failText(err)); }
      }
      if (seq !== this.varSeq || this.conn !== conn) return;
      this.roots = roots;
      this.paint();
    } catch (err) {
      if (seq === this.varSeq) this.log('info', failText(err));
    }
  }

  private async fetchKids(conn: DapConnection, node: VarNode, seq: number): Promise<void> {
    if (node.ref <= 0 || node.depth >= DEPTH_CAP) { node.kids = []; return; }
    const res = await conn.request<{ variables?: Array<Record<string, unknown>> }>('variables', { variablesReference: node.ref, count: VAR_CAP });
    const taken = new Set<string>();
    const kids: VarNode[] = [];
    for (const raw of res.variables ?? []) {
      const v = variableOf(raw);
      let key = `${node.key}/${v.name}`;
      while (taken.has(key)) key += '+';
      taken.add(key);
      kids.push({ key, name: v.name, value: v.value, type: v.type, ref: v.variablesReference, depth: node.depth + 1, scope: false, kids: null });
    }
    node.kids = kids;
    for (const k of kids) {
      if (seq !== this.varSeq) return;
      if (this.open.has(k.key) && k.ref > 0) await this.fetchKids(conn, k, seq);
    }
  }

  private async toggleNode(node: VarNode): Promise<void> {
    if (node.ref <= 0) return;
    if (this.open.has(node.key)) {
      this.open.delete(node.key);
      this.paintVars();
      return;
    }
    this.open.add(node.key);
    const conn = this.conn;
    if (node.kids === null && conn) {
      try { await this.fetchKids(conn, node, this.varSeq); } catch (err) { this.log('info', failText(err)); }
    }
    this.paintVars();
  }

  private async resume(): Promise<void> {
    const conn = this.conn;
    if (this.phase !== 'paused' || !conn) return;
    this.phase = 'running';
    this.paint();
    try { await conn.request('continue', { threadId: this.threadId }); } catch (err) {
      this.log('info', failText(err));
      if (this.conn === conn && this.phase === 'running') { this.phase = 'paused'; this.paint(); }
    }
  }

  async step(kind: StepKind): Promise<void> {
    const conn = this.conn;
    if (this.phase !== 'paused' || !conn) return;
    this.phase = 'running';
    this.paint();
    try { await conn.request(kind, { threadId: this.threadId }); } catch (err) {
      this.log('info', failText(err));
      if (this.conn === conn && this.phase === 'running') { this.phase = 'paused'; this.paint(); }
    }
  }

  async resumeOrStart(): Promise<void> {
    if (this.phase === 'paused') await this.resume(); else await this.start();
  }

  private async evaluate(expression: string): Promise<void> {
    const conn = this.conn;
    this.log('in', expression);
    if (!conn || this.phase !== 'paused') { this.log('info', t('Evaluation needs a paused program')); return; }
    try {
      const res = await conn.request<{ result?: string; type?: string }>('evaluate', { expression, frameId: this.selected || undefined, context: 'repl' });
      this.log('result', String(res.result ?? ''));
      await this.loadScopes(this.selected);
    } catch (err) {
      this.log('err', failText(err));
    }
  }
}

let panel: DebugPanel | null = null;

register({
  id: 'debug',
  name: 'Run and Debug',
  description: 'Python debugging through debugpy: breakpoints, stepping, call stack, variables and a console.',
  required: true,
  setup(ctx, shell) {
    let section: SidebarSection | null = null;
    section = shell.sidebarSection({
      id: 'debug',
      title: 'Run and Debug',
      icon: 'bug',
      render: (host) => { panel = new DebugPanel(host, ctx, shell); },
    });
    const ws = (): boolean => !!ctx.store.workspace && !!panel;
    ctx.commands.add(
      {
        id: 'debug-start',
        label: () => (panel?.currentPhase === 'paused' ? 'Continue' : 'Start Debugging'),
        keys: ['F5'],
        enabled: () => ws() && (panel?.canStart() === true || panel?.currentPhase === 'paused'),
        run: () => { void panel?.resumeOrStart(); },
      },
      { id: 'debug-step-over', label: 'Step Over', keys: ['F10'], enabled: () => panel?.canStep() === true, run: () => { void panel?.step('next'); } },
      { id: 'debug-step-into', label: 'Step Into', keys: ['F11'], enabled: () => panel?.canStep() === true, run: () => { void panel?.step('stepIn'); } },
      { id: 'debug-step-out', label: 'Step Out', keys: ['Shift+F11'], enabled: () => panel?.canStep() === true, run: () => { void panel?.step('stepOut'); } },
      { id: 'debug-stop', label: 'Stop Debugging', keys: ['Shift+F5'], enabled: () => panel?.canStop() === true, run: () => { void panel?.stop(); } },
      { id: 'debug-toggle-breakpoint', label: 'Toggle Breakpoint', keys: ['F9'], enabled: () => !!ctx.store.active, run: () => { toggleBreakpointAtCursor(); } },
      { id: 'debug-focus', label: 'Run and Debug', keys: ['Shift+Mod+D'], enabled: () => !!ctx.store.workspace, run: () => section?.reveal() },
    );
  },
});
