import { DapConnection, capabilitiesOf, debugAdapters, frameOf, scopeOf, variableOf, type AdapterKind, type DapCapabilities, type DapEvent, type DapStackFrame, type DebugAdapter, type LaunchConfig } from '../../io/debug';
import { TRUST_EVENT } from '../../io/trust';
import { el, patchList as patchKeyed, q, setClass, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { breakpointPaths, breakpointsOf, clearBreakpoints, editBreakpointAtCursor, onBreakpoints, setBreakpointSupport, setDebugLocation, toggleBreakpointAtCursor } from '../../ui/editor/breakpoints';
import { onLanguage, t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { FOCUS_EVENT } from '../../ui/workbench';
import { lazyPanel, register, type ExtensionContext, type Shell, type SidebarSection } from '../registry';
import { LaunchPicker, keepFor, recallFor } from './launch';

type Phase = 'idle' | 'starting' | 'running' | 'paused';
type StepKind = 'next' | 'stepIn' | 'stepOut';
type LineKind = 'out' | 'err' | 'in' | 'result' | 'info' | 'log';
interface Watch { id: number; expr: string; node: VarNode; state: 'idle' | 'ok' | 'error' }

const WATCH_KEY = 'formsubstrate.debug.watch';
const WATCH_CAP = 40;
const WATCH_TEXT_MAX = 400;
const LOG_MARK = '⁣';
const LOG_TAG = /⁣(\d+)⁣/;
const NODE_FILE = /\.(?:[cm]?js|[cm]?ts)$/i;
const ALL_CAPS: DapCapabilities = { condition: true, hit: true, log: true };
const PENCIL = '<span class="icon" style="width:12px;height:12px" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l.6-2.8L10.9 2.9a1.2 1.2 0 0 1 1.7 0l.5.5a1.2 1.2 0 0 1 0 1.7L5.8 12.4z"/><path d="M9.8 4l2.2 2.2"/></svg></span>';
const JS_DEBUG_STEPS = 'js-debug was not found. Download js-debug-dap from the vscode-js-debug releases page on GitHub, unpack it, and set the unpacked folder in Preferences, Language Servers, Run and Debug.';

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
  private readonly watchEl: HTMLElement;
  private readonly watchIn: HTMLInputElement;
  private readonly launch: LaunchPicker;
  private adapters: DebugAdapter[] = [];
  private kind: AdapterKind = 'python';
  private caps: DapCapabilities = ALL_CAPS;
  private watches: Watch[] = [];
  private watchId = 0;
  private watchSeq = 0;
  private watchEditing = 0;
  private readonly watchOpen = new Set<string>();
  private readonly logPoints = new Map<number, string>();
  private logSeq = 0;
  private launchDirty = false;
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
  private readonly open = new Set<string>(['Locals', 'Local', 'Block']);
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
      `<div class="cv-dbg-cfg"><select class="cv-input cv-dbg-pick"></select><button class="cv-wb-tool" type="button" data-act="config">${icon('settings', 14)}</button></div>` +
      '<div class="cv-dbg-cfgnote cv-note"></div>' +
      '<div class="cv-dbg-args"><input class="cv-input cv-dbg-argin" type="text" spellcheck="false" autocomplete="off"></div>' +
      '<div class="cv-dbg-sec cv-dbg-sec-stack"><div class="cv-dbg-head"><span class="cv-dbg-head-t"></span><span class="cv-dbg-head-n"></span></div>' +
      '<div class="cv-dbg-list cv-dbg-stack" role="listbox"></div></div>' +
      '<div class="cv-dbg-sec cv-dbg-sec-vars"><div class="cv-dbg-head"><span class="cv-dbg-head-t"></span></div>' +
      '<div class="cv-dbg-list cv-dbg-vars" role="tree"></div><p class="cv-dbg-empty cv-note"></p></div>' +
      '<div class="cv-dbg-sec cv-dbg-sec-watch"><div class="cv-dbg-head"><span class="cv-dbg-head-t"></span></div>' +
      '<div class="cv-dbg-list cv-dbg-watch" role="tree"></div>' +
      '<div class="cv-dbg-exprrow"><input class="cv-input cv-dbg-watchin" type="text" spellcheck="false" autocomplete="off" maxlength="400"></div></div>' +
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
    this.watchEl = q(host, '.cv-dbg-watch');
    this.watchIn = q(host, '.cv-dbg-watchin');
    this.launch = new LaunchPicker(
      q<HTMLSelectElement>(host, '.cv-dbg-pick'), q(host, '.cv-dbg-cfgnote'), q<HTMLButtonElement>(host, '[data-act="config"]'),
      (path) => shell.openEditorTab(path),
      () => this.paint(),
      (text) => shell.setStatus(text, 'error'),
    );
    this.bind();
    this.relabel();
    onLanguage(() => { this.relabel(); this.launch.paint(); this.paint(); });
    this.wsPath = ctx.store.workspace?.path ?? '';
    this.loadWatches();
    ctx.store.on('workspace', (ws) => {
      const next = ws?.path ?? '';
      if (next !== this.wsPath) {
        this.wsPath = next;
        clearBreakpoints();
        this.root = '';
        this.loadWatches();
        if (this.phase !== 'idle') void this.stop();
      }
      void this.refreshAdapter();
    });
    ctx.store.on('active', () => this.paint());
    ctx.store.on('docs', (docs) => {
      const dirty = docs.some((d) => d.modified && /(^|\/)launch\.json$/.test(d.path));
      if (this.launchDirty && !dirty) void this.refreshAdapter();
      this.launchDirty = dirty;
    });
    window.addEventListener(TRUST_EVENT, () => { void this.refreshAdapter(); });
    host.addEventListener(FOCUS_EVENT, () => { void this.refreshAdapter(); });
    onBreakpoints((path) => { void this.sendBreakpoints(path); });
    this.paint();
    void this.refreshAdapter();
  }

  get currentPhase(): Phase { return this.phase; }

  private kindOfFile(path: string | undefined): AdapterKind | null {
    if (!path) return null;
    return PY.test(path) ? 'python' : NODE_FILE.test(path) ? 'node' : null;
  }

  private wantedKind(): AdapterKind | null {
    const choice = this.launch.selected();
    return choice ? choice.kind : this.kindOfFile(this.ctx.store.active?.path);
  }

  canStart(): boolean {
    if (this.phase !== 'idle' || !this.ctx.store.workspace) return false;
    const choice = this.launch.selected();
    if (choice) return !choice.needsFile || !!this.ctx.store.active;
    return this.kindOfFile(this.ctx.store.active?.path) !== null;
  }

  addConfiguration(): void { void this.launch.openFile(); }

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
    this.watchIn.placeholder = t('Add an expression to watch');
    if (this.watchIn.getAttribute('aria-label') !== t('Add an expression to watch')) this.watchIn.setAttribute('aria-label', t('Add an expression to watch'));
    setText(q(this.host, '.cv-dbg-sec-watch .cv-dbg-head-t'), t('Watch'));
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
    this.watchIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const text = this.watchIn.value.trim();
      if (!text) return;
      this.watchIn.value = '';
      this.addWatch(text);
    });
    const watchOf = (target: EventTarget | null): { row: HTMLElement; watch: Watch | undefined } | null => {
      const row = target instanceof Element ? target.closest<HTMLElement>('.cv-dbg-wrow') : null;
      return row ? { row, watch: this.watches.find((w) => w.node.key === row.dataset.node) } : null;
    };
    this.watchEl.addEventListener('click', (e) => {
      const hit = watchOf(e.target);
      if (!hit || (e.target instanceof Element && e.target.closest('.cv-dbg-wedit'))) return;
      const act = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]')?.dataset.act : undefined;
      if (act === 'remove' && hit.watch) { this.removeWatch(hit.watch.id); return; }
      if (act === 'edit' && hit.watch) { this.editWatch(hit.watch.id); return; }
      const node = this.flattenWatch().find((n) => n.key === hit.row.dataset.node);
      if (node) void this.toggleWatchNode(node);
    });
    this.watchEl.addEventListener('dblclick', (e) => {
      const hit = watchOf(e.target);
      if (hit?.watch && !(e.target instanceof Element && e.target.closest('button, input'))) this.editWatch(hit.watch.id);
    });
    this.watchEl.addEventListener('keydown', (e) => {
      const input = e.target instanceof HTMLInputElement && e.target.classList.contains('cv-dbg-wedit') ? e.target : null;
      if (!input) return;
      if (e.key === 'Enter') { e.preventDefault(); this.commitWatch(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.commitWatch(null); }
    });
    this.watchEl.addEventListener('focusout', (e) => {
      if (this.watchEditing && e.target instanceof HTMLInputElement && e.target.classList.contains('cv-dbg-wedit')) this.commitWatch(null);
    });
  }

  private loadWatches(): void {
    const kept = recallFor<unknown>(WATCH_KEY, this.wsPath, []);
    const list = Array.isArray(kept) ? kept.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, WATCH_CAP) : [];
    this.watchSeq++;
    this.watchEditing = 0;
    this.watchOpen.clear();
    this.watches = list.map((expr) => this.newWatch(expr.slice(0, WATCH_TEXT_MAX)));
    this.paintWatch();
  }

  private newWatch(expr: string): Watch {
    const id = ++this.watchId;
    return { id, expr, state: 'idle', node: { key: `w${id}`, name: expr, value: '', type: '', ref: 0, depth: 0, scope: false, kids: null } };
  }

  private keepWatches(): void {
    keepFor(WATCH_KEY, this.wsPath, this.watches.map((w) => w.expr));
  }

  private addWatch(expr: string): void {
    if (this.watches.length >= WATCH_CAP) { this.shell.setStatus(t('The watch list is full'), 'error'); return; }
    this.watches.push(this.newWatch(expr.slice(0, WATCH_TEXT_MAX)));
    this.keepWatches();
    this.paintWatch();
    this.watchEl.scrollTop = this.watchEl.scrollHeight;
    void this.evalWatches();
  }

  private removeWatch(id: number): void {
    this.watches = this.watches.filter((w) => w.id !== id);
    this.keepWatches();
    this.paintWatch();
  }

  private editWatch(id: number): void {
    this.watchEditing = id;
    this.paintWatch();
    const input = this.watchEl.querySelector<HTMLInputElement>('.cv-dbg-wrow.is-editing .cv-dbg-wedit');
    if (input) { input.value = this.watches.find((w) => w.id === id)?.expr ?? ''; input.focus(); input.select(); }
  }

  private commitWatch(text: string | null): void {
    const id = this.watchEditing;
    if (!id) return;
    this.watchEditing = 0;
    const watch = this.watches.find((w) => w.id === id);
    const next = text?.trim().slice(0, WATCH_TEXT_MAX);
    if (watch && next && next !== watch.expr) {
      watch.expr = next;
      watch.node = { ...watch.node, name: next, value: '', type: '', ref: 0, kids: null };
      watch.state = 'idle';
      this.keepWatches();
      this.paintWatch();
      void this.evalWatches();
      return;
    }
    this.paintWatch();
  }

  private flattenWatch(): VarNode[] {
    const out: VarNode[] = [];
    const walk = (nodes: VarNode[]): void => {
      for (const n of nodes) {
        out.push(n);
        if (n.kids && this.watchOpen.has(n.key)) walk(n.kids);
      }
    };
    walk(this.watches.map((w) => w.node));
    return out;
  }

  private paintWatch(): void {
    const tops = new Map(this.watches.map((w) => [w.node.key, w]));
    patchList(this.watchEl, this.flattenWatch(), {
      key: (n) => `w:${n.key}`,
      create: () => el(
        `<div class="cv-dbg-row cv-dbg-var cv-dbg-wrow" role="treeitem"><span class="cv-dbg-twist">${icon('chevronRight', 12)}</span>` +
        '<span class="cv-dbg-vn"></span><span class="cv-dbg-vv"></span>' +
        '<input class="cv-input cv-dbg-wedit" type="text" spellcheck="false" autocomplete="off" maxlength="400" hidden>' +
        `<span class="cv-dbg-wacts"><button class="cv-wb-tool" type="button" data-act="edit">${PENCIL}</button><button class="cv-wb-tool" type="button" data-act="remove">${icon('close', 12)}</button></span></div>`),
      update: (node, n) => {
        const watch = tops.get(n.key);
        const editing = !!watch && watch.id === this.watchEditing;
        const idle = !!watch && watch.state === 'idle';
        node.dataset.node = n.key;
        if (node.style.getPropertyValue('--depth') !== String(n.depth)) node.style.setProperty('--depth', String(n.depth));
        setText(q(node, '.cv-dbg-vn'), n.name);
        setText(q(node, '.cv-dbg-vv'), idle ? t('not available') : n.value);
        setTitle(node, idle ? n.name : `${n.name}: ${n.type ? `${n.type} = ` : ''}${n.value}`);
        setClass(node, 'is-expandable', n.ref > 0);
        setClass(node, 'is-open', n.ref > 0 && this.watchOpen.has(n.key));
        setClass(node, 'is-error', !!watch && watch.state === 'error');
        setClass(node, 'is-idle', idle);
        setClass(node, 'is-child', !watch);
        setClass(node, 'is-editing', editing);
        setHidden(q(node, '.cv-dbg-wedit'), !editing);
        const edit = q<HTMLButtonElement>(node, '[data-act="edit"]');
        const remove = q<HTMLButtonElement>(node, '[data-act="remove"]');
        setTitle(edit, t('Edit Expression'));
        setTitle(remove, t('Remove Expression'));
        if (edit.getAttribute('aria-label') !== t('Edit Expression')) edit.setAttribute('aria-label', t('Edit Expression'));
        if (remove.getAttribute('aria-label') !== t('Remove Expression')) remove.setAttribute('aria-label', t('Remove Expression'));
      },
    });
  }

  private async evalWatches(): Promise<void> {
    const conn = this.conn;
    const seq = ++this.watchSeq;
    if (!conn || this.phase !== 'paused') return;
    const frameId = this.frames.some((f) => f.id === this.selected) ? this.selected : undefined;
    for (const watch of [...this.watches]) {
      let node: VarNode;
      let state: Watch['state'] = 'ok';
      try {
        const res = await conn.request<{ result?: string; type?: string; variablesReference?: number }>('evaluate', { expression: watch.expr, frameId, context: 'watch' });
        node = { ...watch.node, value: String(res.result ?? ''), type: String(res.type ?? ''), ref: Number(res.variablesReference ?? 0), kids: null };
      } catch (err) {
        state = 'error';
        node = { ...watch.node, value: failText(err), type: '', ref: 0, kids: null };
      }
      if (seq !== this.watchSeq || this.conn !== conn) return;
      if (node.ref > 0 && this.watchOpen.has(node.key)) {
        try { await this.fetchKids(conn, node, seq, 'watchSeq', this.watchOpen); } catch { node.kids = []; }
        if (seq !== this.watchSeq || this.conn !== conn) return;
      }
      if (!this.watches.includes(watch) || watch.node.name !== node.name) continue;
      if (node.kids === null && watch.node.kids && watch.node.ref === node.ref) node.kids = watch.node.kids;
      watch.node = node;
      watch.state = state;
      this.paintWatch();
    }
  }

  private idleWatches(): void {
    this.watchSeq++;
    for (const watch of this.watches) {
      watch.state = 'idle';
      watch.node = { ...watch.node, value: '', type: '', ref: 0, kids: null };
    }
    this.paintWatch();
  }

  private async toggleWatchNode(node: VarNode): Promise<void> {
    if (node.ref <= 0) return;
    if (this.watchOpen.has(node.key)) {
      this.watchOpen.delete(node.key);
      this.paintWatch();
      return;
    }
    this.watchOpen.add(node.key);
    const conn = this.conn;
    if (node.kids === null && conn) {
      try { await this.fetchKids(conn, node, this.watchSeq, 'watchSeq', this.watchOpen); } catch (err) { this.log('info', failText(err)); }
      const live = this.flattenWatch().find((n) => n.key === node.key);
      if (live && live !== node && live.kids === null && live.ref === node.ref) live.kids = node.kids;
    }
    this.paintWatch();
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
    const wsPath = this.wsPath;
    try {
      const [info] = await Promise.all([debugAdapters(), this.launch.refresh(wsPath)]);
      this.adapters = info.adapters;
      this.root = info.root ?? this.root;
      this.adapterError = '';
    } catch (err) {
      this.adapters = [];
      this.adapterError = failText(err);
    }
    this.adapter = this.adapters.find((a) => a.id === (this.wantedKind() ?? 'python')) ?? null;
    this.paint();
  }

  private missingText(a: DebugAdapter): string {
    if (a.id === 'node') return a.reason === 'no-node' ? t('Node.js was not found on this computer.') : t(JS_DEBUG_STEPS);
    return `${t('debugpy was not found.')} ${a.install ? `${t('Install')}: ${a.install}` : a.note}`;
  }

  private adapterText(): string {
    if (!this.ctx.store.workspace) return t('Open a folder to debug');
    if (this.adapterError) return this.adapterError;
    const a = this.adapter;
    if (!a) return t('Checking for debugpy');
    if (!a.available) return this.missingText(a);
    if (a.id === 'node') return `js-debug · Node.js ${a.nodeVersion ?? ''} · ${t(a.source ?? '')}`;
    return `debugpy ${a.debugpy ?? ''} · ${t(a.source ?? '')}`;
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
    setDisabled(this.argsEl, p !== 'idle' || !!this.launch.selected());
    this.launch.setDisabled(p !== 'idle');
    setDisabled(this.exprEl, p !== 'paused');
    const kind = p === 'idle' ? this.wantedKind() ?? 'python' : this.kind;
    this.adapter = this.adapters.find((a) => a.id === kind) ?? null;
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
    this.paintWatch();
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
    const seq = ++this.startSeq;
    this.kind = this.wantedKind() ?? 'python';
    this.phase = 'starting';
    this.note = '';
    this.paint();
    const saved = doc ? await this.saveFirst(doc.path) : true;
    if (seq !== this.startSeq) return;
    if (!saved) {
      this.reset('');
      this.shell.setStatus(t('Save the file before debugging'), 'error');
      return;
    }
    await this.refreshAdapter();
    if (seq !== this.startSeq) return;
    const choice = this.launch.selected();
    const kind = choice ? choice.kind : this.kindOfFile(doc?.path);
    if (!kind || (!choice && !doc)) {
      this.reset('');
      this.shell.setStatus(t('Choose a launch configuration or open a Python or JavaScript file'), 'error');
      return;
    }
    this.kind = kind;
    const adapter = this.adapters.find((a) => a.id === kind);
    if (!adapter?.available) {
      this.reset('');
      if (adapter) this.log('info', this.missingText(adapter));
      this.shell.setStatus(adapter ? this.missingText(adapter) : t('No debug adapter is available'), 'error');
      return;
    }
    const launch: LaunchConfig = choice ? { configuration: { index: choice.index, name: choice.name }, file: doc?.path ?? '' } : { program: doc?.path ?? '', args: splitArgs(this.argsEl.value) };
    this.sessionRoot = this.root;
    this.logPoints.clear();
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
      await conn.open(kind);
      const initialized = this.waitFor(conn, 'initialized');
      initialized.catch(() => undefined);
      const offered = await conn.request('initialize', { clientID: 'formsubstrate', clientName: 'formsubstrate', adapterID: kind === 'node' ? 'pwa-node' : 'python', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsVariableType: true });
      this.caps = capabilitiesOf(offered);
      setBreakpointSupport(this.caps);
      const launching = conn.request('launch', { ...launch }).then(() => '', (err: unknown) => failText(err));
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
    const caps = this.caps;
    const lines: number[] = [];
    const breakpoints: Array<Record<string, unknown>> = [];
    for (const b of breakpointsOf(path)) {
      if (!b.enabled) continue;
      if ((b.condition && !caps.condition) || (b.hitCondition && !caps.hit) || (b.logMessage && !caps.log)) {
        if (report) this.log('info', `${t('Breakpoint skipped, this debugger does not support its condition or message')}: ${baseOf(path)}:${b.line}`);
        continue;
      }
      const item: Record<string, unknown> = { line: b.line };
      if (b.condition) item.condition = b.condition;
      if (b.hitCondition) item.hitCondition = b.hitCondition;
      if (b.logMessage) {
        const id = ++this.logSeq;
        this.logPoints.set(id, `${baseOf(path)}:${b.line}`);
        item.logMessage = `${LOG_MARK}${id}${LOG_MARK}${b.logMessage}`;
      }
      lines.push(b.line);
      breakpoints.push(item);
    }
    try {
      const res = await conn.request<{ breakpoints?: Array<{ verified?: boolean; line?: number }> }>('setBreakpoints', { source: { path: this.absOf(path) }, breakpoints, lines });
      if (!report || this.kind !== 'python') return;
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
      const kind: LineKind = category === 'stderr' ? 'err' : category === 'console' || category === 'important' ? 'info' : 'out';
      if (!body.output.includes(LOG_MARK)) { this.log(kind, body.output); return; }
      for (const piece of body.output.match(/[^\n]*\n|[^\n]+/g) ?? []) {
        const tag = LOG_TAG.exec(piece);
        if (tag) this.log('log', `${this.logPoints.get(Number(tag[1])) ?? ''}  ${piece.replace(tag[0], '')}`);
        else this.log(kind, piece);
      }
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
    } else if (e.event === 'formsubstrate/adapterExited') {
      const tail = typeof body.stderr === 'string' ? body.stderr : '';
      if (tail) this.log('err', tail);
      void this.end(t('Adapter stopped'));
    } else if (e.event === 'formsubstrate/busy' || e.event === 'formsubstrate/unavailable') {
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
    this.caps = ALL_CAPS;
    setBreakpointSupport(null);
    setDebugLocation(null);
    this.idleWatches();
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
    await Promise.all([this.loadScopes(frame.id), this.evalWatches()]);
  }

  private async loadScopes(frameId: number): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    const seq = ++this.varSeq;
    try {
      const res = await conn.request<{ scopes?: Array<Record<string, unknown>> }>('scopes', { frameId });
      const taken = new Set<string>();
      const roots = (res.scopes ?? []).map((raw) => {
        const s = scopeOf(raw);
        let key = s.name;
        while (taken.has(key)) key += '+';
        taken.add(key);
        const node: VarNode = { key, name: s.name, value: '', type: '', ref: s.variablesReference, depth: 0, scope: true, kids: null };
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

  private async fetchKids(conn: DapConnection, node: VarNode, seq: number, counter: 'varSeq' | 'watchSeq' = 'varSeq', open: Set<string> = this.open): Promise<void> {
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
      if (seq !== this[counter]) return;
      if (open.has(k.key) && k.ref > 0) await this.fetchKids(conn, k, seq, counter, open);
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
      const res = await conn.request<{ result?: string; type?: string }>('evaluate', { expression, frameId: this.frames.some((f) => f.id === this.selected) ? this.selected : undefined, context: 'repl' });
      this.log('result', String(res.result ?? ''));
      await Promise.all([this.loadScopes(this.selected), this.evalWatches()]);
    } catch (err) {
      this.log('err', failText(err));
    }
  }
}

let panel: DebugPanel | null = null;

register({
  id: 'debug',
  name: 'Run and Debug',
  description: 'Python and Node.js debugging: conditional breakpoints, logpoints, stepping, call stack, variables, watch and a console.',
  required: true,
  setup(ctx, shell) {
    let section: SidebarSection | null = null;
    section = shell.sidebarSection({
      id: 'debug',
      title: 'Run and Debug',
      icon: 'bug',
      render: (host) => { lazyPanel(host, () => Promise.resolve(), () => { panel = new DebugPanel(host, ctx, shell); }, true); },
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
      { id: 'debug-conditional-breakpoint', label: 'Add Conditional Breakpoint', enabled: () => !!ctx.store.active, run: () => { editBreakpointAtCursor('condition'); } },
      { id: 'debug-logpoint', label: 'Add Logpoint', enabled: () => !!ctx.store.active, run: () => { editBreakpointAtCursor('log'); } },
      { id: 'debug-add-configuration', label: 'Add Configuration', enabled: ws, run: () => { panel?.addConfiguration(); } },
      { id: 'debug-focus', label: 'Run and Debug', keys: ['Shift+Mod+D'], enabled: () => !!ctx.store.workspace, run: () => section?.reveal() },
    );
  },
});
