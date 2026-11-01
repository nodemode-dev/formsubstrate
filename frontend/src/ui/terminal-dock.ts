import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { createTerminal, deleteTerminal, listTerminals, terminalSocket, type TerminalInfo, type TerminalKind } from '../io/terminals';
import type { Commands } from './commands';
import { el, isMac, patchList, q, setClass, setHidden, setStyleVar, setText, setTitle } from './dom';
import { t } from './i18n';
import { icon } from './icons';
import { PopupMenu } from './menu';
import { loadPrefs, updatePrefs } from './prefs';
import { toast } from './toast';

export const DOCK_MIN = 120;
export const DOCK_MAX = 800;
export const DOCK_DEFAULT = 260;
const KEY_STEP = 16;
const FONT_WAIT_MS = 1200;
const EXIT_NOTE_WAIT_MS = 1500;
const PENDING_CAP = 2 * 1024 * 1024;

const safeStart = (chunk: Uint8Array): number => {
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === 0x1b) return i;
    if (chunk[i] === 0x0a) return i + 1;
  }
  return -1;
};
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const PASS_THROUGH = new Set(['terminal-toggle', 'command-palette', 'agent-new', 'focus-files']);

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

interface View {
  term: Terminal;
  fit: FitAddon;
  gl: WebglAddon | null;
}

interface Tab {
  info: TerminalInfo;
  title: string;
  exited: boolean;
  noted: boolean;
  code: number;
  pending: Uint8Array[];
  pendingSize: number;
  cut: boolean;
  host: HTMLElement | null;
  view: View | null;
}

const clampHeight = (n: number): number => Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, n)));

export class TerminalDock {
  readonly root = el<HTMLElement>(`<section class="ft-dock" aria-label="${t('Terminal')}">
<div class="ft-dock-grip" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="${t('Resize the terminal')}" aria-valuemin="${DOCK_MIN}" aria-valuemax="${DOCK_MAX}"></div>
<div class="ft-dock-head">
<div class="ft-dock-tabs" role="tablist" aria-label="${t('Terminals')}"></div>
<button type="button" class="cv-tt-btn ft-dock-new" title="${t('New terminal')}" aria-label="${t('New terminal')}" aria-haspopup="menu">${icon('plus', 15)}</button>
<span class="ft-dock-conn" role="status" hidden>${t('Reconnecting')}</span>
<span class="ft-dock-spacer"></span>
<button type="button" class="cv-tt-btn ft-dock-max" title="${t('Maximize')}" aria-label="${t('Maximize')}">${icon('maximize', 15)}</button>
<button type="button" class="cv-tt-btn ft-dock-hide" title="${t('Hide Terminal')} (${isMac ? 'Cmd' : 'Ctrl'}+J)" aria-label="${t('Hide Terminal')}">${icon('chevronDown', 15)}</button>
</div>
<div class="ft-dock-stage"><p class="ft-dock-empty cv-note" hidden>${t('No terminal is open. Start one with the plus button.')}</p></div>
<span class="ft-dock-probe" hidden></span>
</section>`);
  private readonly grip = q(this.root, '.ft-dock-grip');
  private readonly tabsEl = q(this.root, '.ft-dock-tabs');
  private readonly stage = q(this.root, '.ft-dock-stage');
  private readonly empty = q(this.root, '.ft-dock-empty');
  private readonly conn = q(this.root, '.ft-dock-conn');
  private readonly newBtn = q<HTMLButtonElement>(this.root, '.ft-dock-new');
  private readonly maxBtn = q<HTMLButtonElement>(this.root, '.ft-dock-max');
  private readonly probe = q(this.root, '.ft-dock-probe');
  private readonly menu: PopupMenu;
  private readonly tabs = new Map<string, Tab>();
  private order: string[] = [];
  private active: string | null = null;
  private open = false;
  private maxed = false;
  private height = DOCK_DEFAULT;
  private booted: Promise<void> | null = null;
  private theme: ITheme | null = null;
  private family = '';
  private glOk = true;
  private fitFrame = 0;
  private themeFrame = 0;
  private fontReady: Promise<void> | null = null;
  onChange: () => void = () => undefined;

  constructor(private readonly app: HTMLElement, private readonly commands: Commands) {
    this.height = clampHeight(loadPrefs().terminalDockHeight);
    this.menu = new PopupMenu(commands, null, true);
    const status = app.querySelector('.cv-status');
    app.insertBefore(this.root, status);
    this.newBtn.addEventListener('click', () => {
      if (this.menu.isOpen) { this.menu.close(); return; }
      this.menu.setItems(['terminal-new', 'terminal-new-claude']);
      const r = this.newBtn.getBoundingClientRect();
      this.menu.openAt(r.left, r.top);
    });
    this.maxBtn.addEventListener('click', () => this.setMaximized(!this.maxed));
    q(this.root, '.ft-dock-hide').addEventListener('click', () => this.toggle(false));
    this.tabsEl.addEventListener('click', (e) => this.onTabClick(e));
    this.tabsEl.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const id = this.tabId(e.target);
      if (id) { e.preventDefault(); void this.close(id); }
    });
    this.tabsEl.addEventListener('keydown', (e) => this.onTabKey(e));
    new ResizeObserver(() => this.scheduleFit()).observe(this.stage);
    document.addEventListener('nm:ui-settings-changed', () => this.restyle());
    terminalSocket.onState((up) => setHidden(this.conn, up || !terminalSocket.waiting));
    this.bindGrip();
    this.syncGrip();
  }

  get isOpen(): boolean { return this.open; }

  get isMaximized(): boolean { return this.maxed; }

  get count(): number { return this.order.length; }

  toggle(on: boolean = !this.open): void {
    if (on === this.open) return;
    this.open = on;
    document.documentElement.setAttribute('data-ft-dock', on ? 'open' : 'closed');
    this.applyHeight();
    if (on) {
      void this.boot().then(async () => {
        if (this.open && this.order.length === 0) await this.spawn('shell');
        else this.showActive(true);
      });
    } else {
      this.menu.close();
      for (const tab of this.tabs.values()) if (tab.view) this.dropGl(tab.view);
      if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    }
    this.onChange();
  }

  async create(kind: TerminalKind): Promise<void> {
    if (!this.open) {
      this.open = true;
      document.documentElement.setAttribute('data-ft-dock', 'open');
      this.applyHeight();
      this.onChange();
      await this.boot(true);
    } else if (this.order.length === 0) {
      await this.boot(true);
    }
    await this.spawn(kind);
  }

  refreshFont(): void {
    this.family = '';
    this.restyle();
  }

  async reveal(id: string): Promise<void> {
    if (!this.open) {
      this.open = true;
      document.documentElement.setAttribute('data-ft-dock', 'open');
      this.applyHeight();
      this.onChange();
    }
    await this.boot(true);
    if (!this.tabs.has(id)) {
      let existing: TerminalInfo[] = [];
      try { existing = await listTerminals(); } catch { existing = []; }
      for (const info of existing) if (!this.tabs.has(info.id)) this.addTab(info);
      this.patchTabs();
    }
    if (this.tabs.has(id)) this.select(id, true);
    else this.syncEmpty();
  }

  private boot(skipSeed = false): Promise<void> {
    this.booted ??= (async () => {
      let existing: TerminalInfo[] = [];
      try { existing = await listTerminals(); } catch { existing = []; }
      for (const info of existing) if (!this.tabs.has(info.id)) this.addTab(info);
      this.patchTabs();
      if (this.order.length > 0) { this.select(this.active ?? this.order[0], false); return; }
      if (!skipSeed) await this.spawn('shell');
      else this.syncEmpty();
    })();
    return this.booted;
  }

  private async spawn(kind: TerminalKind): Promise<void> {
    const cur = this.active ? this.tabs.get(this.active)?.view : null;
    try {
      const info = await createTerminal({
        kind,
        cwd: '.',
        cols: cur?.term.cols ?? DEFAULT_COLS,
        rows: cur?.term.rows ?? DEFAULT_ROWS,
      });
      this.addTab(info);
      this.patchTabs();
      this.select(info.id, true);
    } catch (e) {
      toast(`${t('Could not start the terminal')}: ${e instanceof Error ? e.message : String(e)}`, 'error');
      this.syncEmpty();
    }
  }

  private addTab(info: TerminalInfo): void {
    const tab: Tab = { info, title: info.title, exited: !info.alive, noted: false, code: info.exitCode ?? 0, pending: [], pendingSize: 0, cut: false, host: null, view: null };
    this.tabs.set(info.id, tab);
    this.order.push(info.id);
    this.wire(tab);
  }

  private wire(tab: Tab): void {
    terminalSocket.attach(tab.info.id, {
      data: (bytes, written) => this.onData(tab, bytes, written),
      exit: (code) => this.noteExit(tab, code),
      title: (title) => { if (title && title !== tab.title) { tab.title = title; this.patchTabs(); } },
      error: (message) => { if (message) toast(`${tab.title}: ${message}`, 'error'); },
    }, null);
    if (!tab.info.alive) window.setTimeout(() => this.noteExit(tab, tab.info.exitCode ?? 0), EXIT_NOTE_WAIT_MS);
  }

  private onData(tab: Tab, bytes: Uint8Array, written: () => void): void {
    if (tab.view) { tab.view.term.write(bytes, written); return; }
    tab.pending.push(bytes.slice());
    tab.pendingSize += bytes.length;
    written();
    while (tab.pendingSize > PENDING_CAP && tab.pending.length > 1) {
      tab.pendingSize -= (tab.pending.shift() as Uint8Array).length;
      tab.cut = true;
    }
    while (tab.cut && tab.pending.length > 0) {
      const head = tab.pending[0];
      const at = safeStart(head);
      if (at < 0) {
        if (tab.pending.length === 1) break;
        tab.pending.shift();
        tab.pendingSize -= head.length;
        continue;
      }
      tab.pending[0] = head.subarray(at);
      tab.pendingSize -= at;
      tab.cut = false;
      if (tab.pending[0].length === 0) tab.pending.shift();
    }
  }

  private flush(tab: Tab, term: Terminal): void {
    if (tab.pending.length > 0) {
      const all = new Uint8Array(tab.pendingSize);
      let at = 0;
      for (const part of tab.pending) { all.set(part, at); at += part.length; }
      tab.pending = [];
      tab.pendingSize = 0;
      tab.cut = false;
      term.write(all);
    }
    if (tab.exited) this.writeExit(tab);
  }


  private tabId(target: EventTarget | null): string | null {
    const node = target instanceof Element ? target.closest<HTMLElement>('.ft-dock-tab') : null;
    return node?.dataset.key ?? null;
  }

  private onTabClick(e: MouseEvent): void {
    const id = this.tabId(e.target);
    if (!id) return;
    if (e.target instanceof Element && e.target.closest('.ft-dock-tab-x')) { void this.close(id); return; }
    this.select(id, true);
  }

  private onTabKey(e: KeyboardEvent): void {
    const id = this.tabId(e.target);
    if (!id) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(id, true); return; }
    if (e.key === 'Delete') { e.preventDefault(); void this.close(id); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const at = this.order.indexOf(id), n = this.order.length;
    const to = this.order[(at + (e.key === 'ArrowRight' ? 1 : -1) + n) % n];
    this.select(to, true);
    this.tabsEl.querySelector<HTMLElement>(`[data-key="${to}"]`)?.focus();
  }

  private patchTabs(): void {
    const items = this.order.map((id) => this.tabs.get(id) as Tab);
    patchList(this.tabsEl, items, {
      key: (tab) => tab.info.id,
      create: (tab) => el<HTMLElement>(`<div class="ft-dock-tab is-${tab.info.kind}" role="tab" tabindex="-1">${icon(tab.info.kind === 'claude' ? 'agent' : 'terminal', 14)}<span class="ft-dock-tab-title"></span><button type="button" class="ft-dock-tab-x" tabindex="-1" aria-label="${t('Close terminal')}" title="${t('Close terminal')}">${icon('close', 10)}</button></div>`),
      update: (node, tab) => {
        setText(q(node, '.ft-dock-tab-title'), tab.title);
        setClass(node, 'is-on', tab.info.id === this.active);
        setClass(node, 'is-exited', tab.exited);
        const on = tab.info.id === this.active ? 'true' : 'false';
        if (node.getAttribute('aria-selected') !== on) node.setAttribute('aria-selected', on);
        const want = tab.info.id === this.active ? '0' : '-1';
        if (node.getAttribute('tabindex') !== want) node.setAttribute('tabindex', want);
        setTitle(node, tab.info.cwd ? `${tab.title} · ${tab.info.cwd}` : tab.title);
      },
    });
    this.syncEmpty();
  }

  private syncEmpty(): void {
    setHidden(this.empty, this.order.length > 0);
  }

  select(id: string, focus: boolean): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const prev = this.active && this.active !== id ? this.tabs.get(this.active) : undefined;
    if (prev) {
      if (prev.view) this.dropGl(prev.view);
      if (prev.host) setHidden(prev.host, true);
    }
    this.active = id;
    this.patchTabs();
    if (this.open) void this.showTab(tab, focus);
  }

  private showActive(focus: boolean): void {
    const tab = this.active ? this.tabs.get(this.active) : undefined;
    if (tab) void this.showTab(tab, focus);
  }

  private async showTab(tab: Tab, focus: boolean): Promise<void> {
    await this.fonts();
    if (this.active !== tab.info.id || !this.open) return;
    if (!tab.host) {
      tab.host = el<HTMLElement>('<div class="ft-term"></div>');
      this.stage.append(tab.host);
    }
    setHidden(tab.host, false);
    if (!tab.view) this.build(tab, tab.host);
    const view = tab.view as View;
    requestAnimationFrame(() => {
      if (this.active !== tab.info.id || !this.open) return;
      this.fitView(tab);
      this.attachGl(view);
      if (focus) view.term.focus();
    });
  }

  private fonts(): Promise<void> {
    this.fontReady ??= (async () => {
      const wait = new Promise<void>((resolve) => { window.setTimeout(resolve, FONT_WAIT_MS); });
      const load = document.fonts.load(`${this.fontSize()}px "JetBrains Mono"`).then(() => undefined, () => undefined);
      await Promise.race([load, wait]);
    })();
    return this.fontReady;
  }

  private fontSize(): number {
    return loadPrefs().terminalFontSize;
  }

  private fontFamily(): string {
    if (!this.family) this.family = getComputedStyle(document.documentElement).getPropertyValue('--font-code').trim() || 'monospace';
    return this.family;
  }

  private readTheme(): ITheme {
    if (this.theme) return this.theme;
    const probe = this.probe;
    const read = (name: string): string => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color;
    };
    const theme: ITheme = {
      background: read('--bg-primary'),
      foreground: read('--text-primary'),
      cursor: read('--accent-color'),
      cursorAccent: read('--bg-primary'),
      selectionBackground: read('--accent-color-dim'),
    };
    const rec = theme as Record<string, string>;
    for (const n of ANSI) {
      rec[n] = read(`--ft-ansi-${n}`);
      rec[`bright${n[0].toUpperCase()}${n.slice(1)}`] = read(`--ft-ansi-bright-${n}`);
    }
    probe.style.removeProperty('color');
    this.theme = theme;
    return theme;
  }

  private restyle(): void {
    this.theme = null;
    if (this.themeFrame) return;
    this.themeFrame = requestAnimationFrame(() => {
      this.themeFrame = 0;
      const theme = this.readTheme(), size = this.fontSize(), family = this.fontFamily();
      for (const tab of this.tabs.values()) {
        const term = tab.view?.term;
        if (!term) continue;
        term.options.theme = theme;
        if (term.options.fontSize !== size) term.options.fontSize = size;
        if (term.options.fontFamily !== family) term.options.fontFamily = family;
      }
      this.scheduleFit();
    });
  }

  private build(tab: Tab, host: HTMLElement): void {
    const term = new Terminal({
      fontFamily: this.fontFamily(),
      fontSize: this.fontSize(),
      theme: this.readTheme(),
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    const view: View = { term, fit, gl: null };
    tab.view = view;
    const id = tab.info.id;
    term.onData((d) => terminalSocket.input(id, d));
    term.onResize(({ cols, rows }) => terminalSocket.resize(id, cols, rows));
    term.attachCustomKeyEventHandler((e) => this.onKey(e, term));
    this.flush(tab, term);
  }

  private writeExit(tab: Tab): void {
    if (tab.noted || !tab.view) return;
    tab.noted = true;
    tab.view.term.write(`\r\n[${t('process exited with code')} ${tab.code}]\r\n`);
  }

  private noteExit(tab: Tab, code: number): void {
    if (!tab.exited || !tab.noted) tab.code = code;
    tab.exited = true;
    this.writeExit(tab);
    this.patchTabs();
  }

  private onKey(e: KeyboardEvent, term: Terminal): boolean {
    if (e.type !== 'keydown') return true;
    if (e.code === 'KeyC' && (isMac ? e.metaKey && !e.shiftKey : e.ctrlKey && e.shiftKey) && !e.altKey) {
      const text = term.getSelection();
      if (text) { e.preventDefault(); void this.copy(text); }
      return false;
    }
    if (e.code === 'KeyV' && (isMac ? e.metaKey && !e.shiftKey : e.ctrlKey && e.shiftKey) && !e.altKey) return false;
    return !this.appKey(e);
  }

  private appKey(e: KeyboardEvent): boolean {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) return false;
    if (isMac) return true;
    if (e.code === 'KeyJ' && !e.shiftKey && !e.altKey) return true;
    return e.shiftKey && PASS_THROUGH.has(this.commands.forEvent(e)?.id ?? '');
  }

  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = el<HTMLTextAreaElement>('<textarea class="ft-dock-clip" readonly></textarea>');
      area.value = text;
      this.root.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
  }

  private attachGl(view: View): void {
    if (view.gl || !this.glOk || !this.open) return;
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => { this.dropGl(view); });
      view.term.loadAddon(gl);
      view.gl = gl;
    } catch {
      view.gl = null;
      this.glOk = false;
    }
  }

  private dropGl(view: View): void {
    const gl = view.gl;
    view.gl = null;
    if (!gl) return;
    try { gl.dispose(); } catch { return; }
  }

  private scheduleFit(): void {
    if (this.fitFrame) return;
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = 0;
      const tab = this.active ? this.tabs.get(this.active) : undefined;
      if (tab && this.open) this.fitView(tab);
    });
  }

  private fitView(tab: Tab): void {
    const host = tab.host, view = tab.view;
    if (!host || !view || host.hidden || host.clientWidth < 8 || host.clientHeight < 8) return;
    try { view.fit.fit(); } catch { return; }
  }

  async close(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    terminalSocket.detach(id);
    await deleteTerminal(id).catch(() => undefined);
    if (!this.tabs.has(id)) return;
    if (tab.view) { this.dropGl(tab.view); tab.view.term.dispose(); }
    tab.pending = [];
    tab.pendingSize = 0;
    tab.host?.remove();
    this.tabsEl.querySelector(`[data-key="${id}"]`)?.remove();
    this.tabs.delete(id);
    const at = this.order.indexOf(id);
    this.order.splice(at, 1);
    if (this.active === id) {
      this.active = null;
      const next = this.order[Math.min(at, this.order.length - 1)];
      if (next) this.select(next, true);
    }
    this.patchTabs();
  }

  private setMaximized(on: boolean): void {
    this.maxed = on;
    setClass(this.maxBtn, 'is-on', on);
    const label = on ? t('Restore') : t('Maximize');
    setTitle(this.maxBtn, label);
    this.maxBtn.setAttribute('aria-label', label);
    this.applyHeight();
  }

  private applyHeight(): void {
    if (!this.open) { this.app.style.removeProperty('--ft-dock-h'); return; }
    setStyleVar(this.app, '--ft-dock-h', this.maxed ? 'var(--ft-dock-full)' : `min(${this.height}px, var(--ft-dock-cap))`);
  }

  private syncGrip(): void {
    this.grip.setAttribute('aria-valuenow', String(this.height));
  }

  private setHeight(h: number): void {
    const next = clampHeight(h);
    if (next === this.height) return;
    this.height = next;
    this.applyHeight();
    this.syncGrip();
  }

  private bindGrip(): void {
    const grip = this.grip;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      if (this.maxed) this.setMaximized(false);
      const zoom = parseFloat(document.documentElement.style.zoom) || 1;
      const startY = e.clientY, startH = this.root.getBoundingClientRect().height / zoom;
      setClass(this.root, 'is-dragging', true);
      const move = (ev: PointerEvent): void => { this.setHeight(startH + (startY - ev.clientY) / zoom); };
      const up = (): void => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        setClass(this.root, 'is-dragging', false);
        updatePrefs({ terminalDockHeight: this.height });
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', () => { this.setHeight(DOCK_DEFAULT); updatePrefs({ terminalDockHeight: this.height }); });
    grip.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      this.setHeight(this.height + (e.key === 'ArrowUp' ? KEY_STEP : -KEY_STEP));
      updatePrefs({ terminalDockHeight: this.height });
    });
  }
}
