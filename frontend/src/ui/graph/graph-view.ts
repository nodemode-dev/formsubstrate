import { fetchGraph, isUnchanged, type GraphReply } from '../../io/graph';
import { formslotState } from '../../io/formslot';
import { el, q, setClass, setHidden, setText, setTitle } from '../dom';
import { enhanceSelect } from '../dropdown';
import { t } from '../i18n';
import { icon } from '../icons';
import type { EditorPrefs, ViewDoc } from '../review/views';
import type { LayoutIn, LayoutOut } from './graph-layout';

const MM_KEY = 'subform.graph.minimap';
const MIN_K = 0.02;
const MAX_K = 8;
const GRID = 22;
const RECHECK_MS = 6000;
const CLICK_SLOP = 4;
const SETTLE_MS = 110;
const LIVE_MS = 350;
const CATS = ['code', 'lang', 'style', 'doc', 'data', 'other', 'slot'] as const;
const CAT_VARS = ['--syn-blue', '--syn-teal', '--syn-violet', '--ok-soft', '--warn', '--text-muted', '--accent-color'];
const CAT_NAMES = ['Web code', 'Other code', 'Styles', 'Docs and pages', 'Data and config', 'Other', 'Slots'];
const WEB = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte']);
const LANG = new Set(['py', 'pyi', 'rs', 'go', 'java', 'kt', 'swift', 'rb', 'php', 'cs', 'lua', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'c', 'h', 'cc', 'cpp', 'hpp', 'cxx', 'hxx', 'm', 'mm', 'sql']);
const STYLE = new Set(['css', 'scss', 'sass', 'less']);
const DOC = new Set(['md', 'mdx', 'markdown', 'html', 'htm', 'txt', 'svg']);
const DATA = new Set(['json', 'jsonc', 'toml', 'yaml', 'yml', 'ini', 'cfg', 'xml', 'lock', 'graphql', 'proto']);

interface Saved {
  sig: string;
  pos: Map<string, [number, number]>;
  pinned: Set<string>;
  view: { x: number; y: number; k: number } | null;
  placed: boolean;
}

const memory = new Map<string, Saved>();

const extOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};

const catOf = (ext: string): number => (WEB.has(ext) ? 0 : LANG.has(ext) ? 1 : STYLE.has(ext) ? 2 : DOC.has(ext) ? 3 : DATA.has(ext) ? 4 : 5);

export const GRAPH_ID = 'graph:files';

export class GraphTab implements ViewDoc {
  readonly root = el<HTMLElement>(`<div class="cv-gr">
<div class="cv-gr-bar">
<label class="cv-gr-find">${icon('search', 14)}<input class="cv-input cv-gr-search" type="search" spellcheck="false" autocomplete="off"></label>
<select class="cv-gr-folder"></select>
<select class="cv-gr-ext"></select>
<div class="cv-seg" role="group">
<button class="cv-seg-btn cv-gr-orphans is-on" type="button">${icon('file', 14)}<span class="cv-gr-orphans-t"></span></button>
<button class="cv-seg-btn cv-gr-slots" type="button" disabled>${icon('slot', 14)}<span class="cv-gr-slots-t"></span></button>
</div>
<span class="cv-gr-count cv-note"></span>
<div class="cv-gr-tools">
<button class="cv-wb-tool cv-gr-fit" type="button">${icon('fit', 14)}</button>
<button class="cv-wb-tool cv-gr-refresh" type="button">${icon('refresh', 14)}</button>
</div>
</div>
<div class="cv-gr-stage">
<canvas class="cv-gr-canvas" tabindex="0"></canvas>
<div class="cv-gr-tip"><span class="cv-gr-tip-path"></span><span class="cv-gr-tip-meta cv-note"></span></div>
<div class="cv-gr-zoom">
<button class="cv-gr-zbtn" type="button" data-z="in">${icon('plus', 14)}</button>
<button class="cv-gr-zbtn" type="button" data-z="out">${icon('minus', 14)}</button>
<button class="cv-gr-zbtn" type="button" data-z="fit">${icon('fit', 14)}</button>
</div>
<canvas class="cv-gr-mini"></canvas>
<button class="cv-gr-mm" type="button">${icon('chevronRight', 12)}</button>
<div class="cv-gr-legend cv-note"></div>
<p class="cv-gr-note cv-note"></p>
</div>
</div>`);
  private readonly stage = q(this.root, '.cv-gr-stage');
  private readonly canvas = q<HTMLCanvasElement>(this.root, '.cv-gr-canvas');
  private readonly mini = q<HTMLCanvasElement>(this.root, '.cv-gr-mini');
  private readonly mmBtn = q<HTMLButtonElement>(this.root, '.cv-gr-mm');
  private readonly tip = q(this.root, '.cv-gr-tip');
  private readonly tipPath = q(this.root, '.cv-gr-tip-path');
  private readonly tipMeta = q(this.root, '.cv-gr-tip-meta');
  private readonly note = q(this.root, '.cv-gr-note');
  private readonly count = q(this.root, '.cv-gr-count');
  private readonly search = q<HTMLInputElement>(this.root, '.cv-gr-search');
  private readonly folderSel = q<HTMLSelectElement>(this.root, '.cv-gr-folder');
  private readonly extSel = q<HTMLSelectElement>(this.root, '.cv-gr-ext');
  private readonly orphanBtn = q<HTMLButtonElement>(this.root, '.cv-gr-orphans');
  private readonly slotBtn = q<HTMLButtonElement>(this.root, '.cv-gr-slots');
  private readonly refreshBtn = q<HTMLButtonElement>(this.root, '.cv-gr-refresh');
  private readonly probe = el<HTMLElement>('<i class="cv-gr-probe" aria-hidden="true"></i>');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly mctx: CanvasRenderingContext2D;
  private readonly worker: Worker;
  private readonly poppers: HTMLElement[] = [];
  private readonly offs: Array<() => void> = [];
  private readonly resizer: ResizeObserver;
  private readonly themer: MutationObserver;

  private base: GraphReply | null = null;
  private sig: string | null = null;
  private n = 0;
  private paths: string[] = [];
  private names: string[] = [];
  private dirs: string[] = [];
  private exts: string[] = [];
  private cats = new Uint8Array(0);
  private inDeg = new Int32Array(0);
  private outDeg = new Int32Array(0);
  private radius = new Float32Array(0);
  private radBase = new Float32Array(0);
  private radK = 0;
  private adjOut = new Uint8Array(0);
  private readonly scene = document.createElement('canvas');
  private readonly mbase = document.createElement('canvas');
  private readonly sctx: CanvasRenderingContext2D = this.scene.getContext('2d') as CanvasRenderingContext2D;
  private readonly mbctx: CanvasRenderingContext2D = this.mbase.getContext('2d') as CanvasRenderingContext2D;
  private sceneV = { x: 0, y: 0, k: 1 };
  private sceneOk = false;
  private sceneStale = true;
  private mbOk = false;
  private lastScene = 0;
  private lastInteract = 0;
  private timer = 0;
  private hide = -1;
  private mx = 0;
  private my = 0;
  private edges = new Int32Array(0);
  private adjOff = new Int32Array(0);
  private adj = new Int32Array(0);
  private pos = new Float32Array(0);
  private pinned = new Uint8Array(0);
  private visible = new Uint8Array(0);
  private matched = new Uint8Array(0);
  private slotCount = 0;
  private simIdx = new Int32Array(0);
  private placed = false;
  private settled = false;
  private matchCount = 0;
  private matchList: number[] = [];
  private matchAt = -1;
  private layers: { slots: boolean; orphans: boolean } = { slots: false, orphans: true };
  private folder = '';
  private extFilter = '';
  private view = { x: 0, y: 0, k: 1 };
  private fitted = false;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private colors: string[] = [];
  private ink = { line: '', lineHot: '', text: '', muted: '', bg: '', accent: '', dot: '', halo: '' };
  private font = '';
  private dirty = false;
  private frame = 0;
  private hover = -1;
  private selected = -1;
  private mouse = { x: 0, y: 0, in: false };
  private drag: { mode: 'pan' | 'node'; x: number; y: number; vx: number; vy: number; node: number; moved: boolean; id: number } | null = null;
  private fetching: AbortController | null = null;
  private lastCheck = 0;
  private active = false;
  private stale = true;
  private mmOpen = true;
  private mmBox = { minX: 0, minY: 0, scale: 1, ox: 0, oy: 0 };
  private rootKey: string;
  private loaded = false;

  constructor(rootKey: string, private readonly openFile: (path: string) => void) {
    this.rootKey = rootKey;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.mctx = this.mini.getContext('2d') as CanvasRenderingContext2D;
    this.stage.append(this.probe);
    this.worker = new Worker(new URL('./graph-layout.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<LayoutOut>) => this.onTick(e.data);
    try { this.mmOpen = localStorage.getItem(MM_KEY) !== '0'; } catch { this.mmOpen = true; }
    this.text();
    this.legend();
    this.enhance();
    this.wire();
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.stage);
    this.themer = new MutationObserver(() => this.retheme());
    this.themer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    this.themer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const onSettings = (): void => this.retheme();
    document.addEventListener('nm:ui-settings-changed', onSettings);
    this.offs.push(() => document.removeEventListener('nm:ui-settings-changed', onSettings));
    this.offs.push(formslotState.on('status', () => this.syncSlotBtn()));
    this.syncMm();
    this.syncSlotBtn();
    this.showNote(t('Reading the project...'));
  }

  private text(): void {
    this.search.placeholder = t('Search files');
    this.search.setAttribute('aria-label', t('Search files'));
    this.folderSel.setAttribute('aria-label', t('Folder'));
    this.extSel.setAttribute('aria-label', t('File type'));
    setText(q(this.root, '.cv-gr-orphans-t'), t('Unlinked'));
    setText(q(this.root, '.cv-gr-slots-t'), t('Slots'));
    setTitle(this.orphanBtn, t('Show files with no links'));
    setTitle(this.slotBtn, t('Show formslot slots as nodes'));
    setTitle(this.refreshBtn, t('Refresh graph'));
    setTitle(q(this.root, '.cv-gr-fit'), t('Fit to window'));
    setTitle(this.mmBtn, t('Toggle minimap'));
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.cv-gr-zbtn'))) setTitle(b, t(b.dataset.z === 'in' ? 'Zoom in' : b.dataset.z === 'out' ? 'Zoom out' : 'Fit to window'));
  }

  private legend(): void {
    const host = q(this.root, '.cv-gr-legend');
    host.append(el(`<span class="cv-gr-hint">${t('Click a file to open it. Drag to pan, scroll to zoom.')}</span>`));
    for (let i = 0; i < 6; i++) host.append(el(`<span class="cv-gr-key"><i class="cv-gr-dot" data-cat="${i}"></i>${t(CAT_NAMES[i])}</span>`));
  }

  private enhance(): void {
    const overlay = document.getElementById('overlay-root') ?? document.body;
    const before = new Set(Array.from(overlay.children));
    enhanceSelect(this.folderSel, { search: t('Find a folder') });
    enhanceSelect(this.extSel);
    for (const c of Array.from(overlay.children)) if (!before.has(c) && c instanceof HTMLElement) this.poppers.push(c);
    this.folderSel.addEventListener('change', () => { this.folder = this.folderSel.value; this.refilter(); });
    this.extSel.addEventListener('change', () => { this.extFilter = this.extSel.value; this.refilter(); });
    this.fillOptions(this.folderSel, [['', t('All folders')]]);
    this.fillOptions(this.extSel, [['', t('All types')]]);
  }

  private fillOptions(sel: HTMLSelectElement, items: Array<[string, string]>): void {
    const keep = sel.value;
    const have = Array.from(sel.options);
    items.forEach(([value, label], i) => {
      let o = have[i];
      if (!o) { o = document.createElement('option'); sel.append(o); }
      if (o.value !== value) o.value = value;
      if (o.textContent !== label) o.textContent = label;
    });
    for (let i = have.length - 1; i >= items.length; i--) have[i].remove();
    sel.value = items.some(([v]) => v === keep) ? keep : '';
  }

  private wire(): void {
    this.search.addEventListener('input', () => this.runSearch());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.stepMatch(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.stopPropagation(); if (this.search.value) { this.search.value = ''; this.runSearch(); } else this.canvas.focus(); }
    });
    this.orphanBtn.addEventListener('click', () => {
      this.layers.orphans = !this.layers.orphans;
      setClass(this.orphanBtn, 'is-on', this.layers.orphans);
      this.refilter();
    });
    this.slotBtn.addEventListener('click', () => { void this.toggleSlots(); });
    this.refreshBtn.addEventListener('click', () => { void this.load(true); });
    q(this.root, '.cv-gr-fit').addEventListener('click', () => this.fit());
    this.mmBtn.addEventListener('click', () => {
      this.mmOpen = !this.mmOpen;
      try { localStorage.setItem(MM_KEY, this.mmOpen ? '1' : '0'); } catch { return; }
      this.syncMm();
      this.refreshScene();
    });
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.cv-gr-zbtn'))) {
      b.addEventListener('click', () => {
        if (b.dataset.z === 'fit') this.fit();
        else this.zoomAt(this.w / 2, this.h / 2, b.dataset.z === 'in' ? 1.25 : 0.8);
      });
    }
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => { this.mouse.in = false; this.setHover(-1); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const step = e.ctrlKey ? 0.01 : 0.0016;
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * step));
    }, { passive: false });
    c.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') this.zoomAt(this.w / 2, this.h / 2, 1.25);
      else if (e.key === '-') this.zoomAt(this.w / 2, this.h / 2, 0.8);
      else if (e.key === '0') this.fit();
      else return;
      e.preventDefault();
    });
    this.mini.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const r = this.mini.getBoundingClientRect();
      const b = this.mmBox;
      const wx = b.minX + (e.clientX - r.left - b.ox) / b.scale;
      const wy = b.minY + (e.clientY - r.top - b.oy) / b.scale;
      this.view.x = this.w / 2 - wx * this.view.k;
      this.view.y = this.h / 2 - wy * this.view.k;
      this.rememberView();
      this.invalidate();
    });
  }

  private syncMm(): void {
    setHidden(this.mini, !this.mmOpen);
    setClass(this.mmBtn, 'is-open', this.mmOpen);
  }

  private showNote(text: string): void {
    setText(this.note, text);
    setHidden(this.note, !text);
  }

  private syncSlotBtn(): void {
    const ok = formslotState.phase === 'running';
    if (this.slotBtn.disabled === !ok) return;
    this.slotBtn.disabled = !ok;
    if (!ok && this.layers.slots) { this.layers.slots = false; setClass(this.slotBtn, 'is-on', false); void this.rebuild(); }
  }

  private async toggleSlots(): Promise<void> {
    this.layers.slots = !this.layers.slots;
    setClass(this.slotBtn, 'is-on', this.layers.slots);
    if (this.layers.slots) await formslotState.ensureDrift(true);
    await this.rebuild();
  }

  activate(): void {
    this.active = true;
    this.resize();
    if (this.stale) this.retheme(true);
    this.invalidate();
    if (!this.loaded) { void this.load(false); return; }
    if (Date.now() - this.lastCheck > RECHECK_MS) void this.load(false);
  }

  save(): Promise<boolean> { return Promise.resolve(false); }

  setOptions(_o: EditorPrefs): void {
    return;
  }

  find(): void {
    this.search.focus();
    this.search.select();
  }

  dispose(): void {
    this.remember();
    this.fetching?.abort();
    this.worker.postMessage({ type: 'stop' } satisfies LayoutIn);
    this.worker.terminate();
    this.resizer.disconnect();
    this.themer.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    for (const off of this.offs) off();
    for (const p of this.poppers) p.remove();
  }

  async load(force: boolean): Promise<void> {
    this.fetching?.abort();
    const ctl = new AbortController();
    this.fetching = ctl;
    this.lastCheck = Date.now();
    setClass(this.refreshBtn, 'is-busy', true);
    if (!this.loaded) this.showNote(t('Reading the project...'));
    try {
      const r = await fetchGraph(force ? null : this.sig, ctl.signal);
      if (ctl.signal.aborted) return;
      this.loaded = true;
      if (isUnchanged(r)) { if (this.n === 0) this.showNote(t('No files to graph in this folder')); return; }
      this.base = r;
      this.sig = r.sig;
      await this.rebuild();
    } catch (err) {
      if (ctl.signal.aborted) return;
      const msg = err instanceof Error ? err.message.replace(/^\d{3}\s*/, '') : String(err);
      if (!this.loaded) this.showNote(`${t('Could not read the project')}: ${msg}`);
    } finally {
      if (this.fetching === ctl) { this.fetching = null; setClass(this.refreshBtn, 'is-busy', false); }
    }
  }

  private async rebuild(): Promise<void> {
    const r = this.base;
    if (!r) return;
    const keepPos = new Map<string, [number, number]>();
    for (let i = 0; i < this.n; i++) keepPos.set(this.paths[i], [this.pos[i * 2], this.pos[i * 2 + 1]]);
    const saved = memory.get(this.rootKey);
    if (saved && keepPos.size === 0) for (const [k, v] of saved.pos) keepPos.set(k, v);
    const wasPlaced = this.placed || !!saved?.placed;
    const pinnedPaths = new Set<string>(saved?.pinned ?? []);
    for (let i = 0; i < this.n; i++) if (this.pinned[i]) pinnedPaths.add(this.paths[i]);

    const files = r.nodes;
    const slotFiles = new Map<string, number[]>();
    if (this.layers.slots) {
      const index = new Map<string, number>();
      files.forEach((f, i) => index.set(f.path, i));
      for (const d of formslotState.driftFiles) {
        const at = index.get(d.path);
        if (at === undefined || !d.slot) continue;
        const list = slotFiles.get(d.slot) ?? [];
        list.push(at);
        slotFiles.set(d.slot, list);
      }
    }
    const baseN = files.length;
    const slotIds = Array.from(slotFiles.keys());
    const n = baseN + slotIds.length;
    this.n = n;
    this.slotCount = slotIds.length;
    this.paths = new Array<string>(n);
    this.names = new Array<string>(n);
    this.dirs = new Array<string>(n);
    this.exts = new Array<string>(n);
    this.cats = new Uint8Array(n);
    this.inDeg = new Int32Array(n);
    this.outDeg = new Int32Array(n);
    for (let i = 0; i < baseN; i++) {
      const p = files[i].path;
      const cut = p.lastIndexOf('/');
      this.paths[i] = p;
      this.names[i] = p.slice(cut + 1);
      this.dirs[i] = cut < 0 ? '' : p.slice(0, cut);
      this.exts[i] = extOf(p);
      this.cats[i] = catOf(this.exts[i]);
    }
    const list: number[] = [];
    for (const [a, b] of r.edges) list.push(a, b);
    slotIds.forEach((id, k) => {
      const i = baseN + k;
      this.paths[i] = `slot:${id}`;
      this.names[i] = id;
      this.dirs[i] = '';
      this.exts[i] = 'slot';
      this.cats[i] = 6;
      for (const f of slotFiles.get(id) ?? []) list.push(i, f);
    });
    this.edges = Int32Array.from(list);
    for (let e = 0; e < this.edges.length; e += 2) { this.outDeg[this.edges[e]]++; this.inDeg[this.edges[e + 1]]++; }
    this.radius = new Float32Array(n);
    this.radBase = new Float32Array(n);
    for (let i = 0; i < n; i++) this.radBase[i] = this.cats[i] === 6 ? 6 : 2.4 + Math.min(7, Math.sqrt(this.inDeg[i]) * 1.1 + Math.sqrt(this.outDeg[i]) * 0.35);
    this.radK = 0;
    this.scaleRadii();
    const cnt = new Int32Array(n + 1);
    for (let e = 0; e < this.edges.length; e++) cnt[this.edges[e] + 1]++;
    for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
    this.adjOff = cnt;
    this.adj = new Int32Array(this.edges.length);
    this.adjOut = new Uint8Array(this.edges.length);
    const fill = cnt.slice(0, n);
    for (let e = 0; e < this.edges.length; e += 2) {
      const a = this.edges[e], b = this.edges[e + 1];
      this.adjOut[fill[a]] = 1;
      this.adj[fill[a]++] = b;
      this.adj[fill[b]++] = a;
    }
    this.pinned = new Uint8Array(n);
    this.pos = new Float32Array(n * 2);
    const sim: number[] = [];
    for (let i = 0; i < n; i++) if (this.inDeg[i] + this.outDeg[i] > 0) sim.push(i);
    this.simIdx = Int32Array.from(sim);
    let reused = 0;
    const spiral = (i: number): [number, number] => {
      const rr = 16 * Math.sqrt(i + 1);
      return [Math.cos(i * 2.39996) * rr, Math.sin(i * 2.39996) * rr];
    };
    const unknown: number[] = [];
    const rank = new Map<number, number>();
    sim.forEach((i, k) => rank.set(i, k));
    for (let k = 0; k < sim.length; k++) {
      const i = sim[k];
      const old = keepPos.get(this.paths[i]);
      if (old) { this.pos[i * 2] = old[0]; this.pos[i * 2 + 1] = old[1]; reused++; } else unknown.push(i);
    }
    for (const i of unknown) {
      let sx = 0, sy = 0, c = 0;
      for (let a = this.adjOff[i]; a < this.adjOff[i + 1]; a++) {
        const j = this.adj[a];
        if (keepPos.has(this.paths[j]) || this.pos[j * 2] !== 0 || this.pos[j * 2 + 1] !== 0) { sx += this.pos[j * 2]; sy += this.pos[j * 2 + 1]; c++; }
      }
      if (c > 0 && reused > 0) { this.pos[i * 2] = sx / c + ((i * 37) % 17) - 8; this.pos[i * 2 + 1] = sy / c + ((i * 53) % 19) - 9; }
      else { const [x, y] = spiral(rank.get(i) ?? 0); this.pos[i * 2] = x; this.pos[i * 2 + 1] = y; }
    }
    let orphansKnown = wasPlaced && sim.length < n;
    for (let i = 0; i < n && orphansKnown; i++) if (this.inDeg[i] + this.outDeg[i] === 0 && !keepPos.has(this.paths[i])) orphansKnown = false;
    if (orphansKnown) {
      for (let i = 0; i < n; i++) {
        if (this.inDeg[i] + this.outDeg[i] > 0) continue;
        const old = keepPos.get(this.paths[i]);
        if (old) { this.pos[i * 2] = old[0]; this.pos[i * 2 + 1] = old[1]; }
      }
    }
    this.placed = orphansKnown || sim.length === n;
    for (let i = 0; i < n; i++) if (pinnedPaths.has(this.paths[i])) this.pinned[i] = 1;
    this.visible = new Uint8Array(n);
    this.matched = new Uint8Array(n);
    this.fillFilters(files);
    this.refilter(true);
    this.runSearch(true);

    this.showNote(n === 0 ? t('No files to graph in this folder') : '');
    const simPos = new Float32Array(sim.length * 2);
    const back = new Int32Array(n).fill(-1);
    sim.forEach((i, k) => { back[i] = k; simPos[k * 2] = this.pos[i * 2]; simPos[k * 2 + 1] = this.pos[i * 2 + 1]; });
    const se: number[] = [];
    for (let e = 0; e < this.edges.length; e += 2) se.push(back[this.edges[e]], back[this.edges[e + 1]]);
    const calm = sim.length > 0 && reused / sim.length > 0.85;
    this.settled = sim.length === 0;
    if (this.settled) this.afterSettle();
    this.worker.postMessage({ type: 'init', n: sim.length, pos: simPos, edges: Int32Array.from(se), alpha: calm ? 0.12 : 1 } satisfies LayoutIn, [simPos.buffer]);
    sim.forEach((i, k) => { if (this.pinned[i]) this.worker.postMessage({ type: 'pin', i: k, x: this.pos[i * 2], y: this.pos[i * 2 + 1] } satisfies LayoutIn); });
    if (!this.fitted) {
      const sv = memory.get(this.rootKey)?.view;
      if (sv && reused > 0) { this.view = { ...sv }; this.fitted = true; }
    }
    this.syncCount();
    this.refreshScene();
  }

  private onTick(m: LayoutOut): void {
    const sim = this.simIdx;
    const src = m.pos;
    for (let k = 0; k < sim.length; k++) {
      const i = sim[k];
      if (this.drag?.node === i && this.drag.moved) continue;
      this.pos[i * 2] = src[k * 2];
      this.pos[i * 2 + 1] = src[k * 2 + 1];
    }
    if (m.done) { this.settled = true; this.afterSettle(); }
    else if (!this.fitted && this.w > 0) this.fit(true);
    this.refreshScene();
  }

  private afterSettle(): void {
    if (!this.placed) this.placeOrphans();
    if (!this.fitted) this.fit();
    this.remember();
  }

  private placeOrphans(): void {
    const loose: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.inDeg[i] + this.outDeg[i] === 0) loose.push(i);
    this.placed = true;
    if (!loose.length) return;
    let minY = Infinity, maxX = -Infinity;
    let any = false;
    for (const i of this.simIdx) {
      any = true;
      if (this.pos[i * 2] > maxX) maxX = this.pos[i * 2];
      if (this.pos[i * 2 + 1] < minY) minY = this.pos[i * 2 + 1];
    }
    if (!any) { maxX = -140; minY = 0; }
    const cols = Math.max(4, Math.ceil(Math.sqrt(loose.length * 1.4)));
    const gap = 14;
    loose.forEach((i, k) => {
      this.pos[i * 2] = maxX + 140 + (k % cols) * gap;
      this.pos[i * 2 + 1] = minY + Math.floor(k / cols) * gap;
    });
  }

  private fillFilters(files: GraphReply['nodes']): void {
    const dirCount = new Map<string, number>();
    const extCount = new Map<string, number>();
    for (let i = 0; i < files.length; i++) {
      const parts = this.dirs[i].split('/').filter(Boolean);
      for (let d = 1; d <= Math.min(2, parts.length); d++) {
        const key = parts.slice(0, d).join('/');
        dirCount.set(key, (dirCount.get(key) ?? 0) + 1);
      }
      const e = this.exts[i] || '(none)';
      extCount.set(e, (extCount.get(e) ?? 0) + 1);
    }
    const folders: Array<[string, string]> = [['', t('All folders')]];
    for (const key of Array.from(dirCount.keys()).sort()) folders.push([key, `${key} (${dirCount.get(key)})`]);
    const types: Array<[string, string]> = [['', t('All types')]];
    for (const [e, c] of Array.from(extCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) types.push([e, `.${e} (${c})`.replace('.(none)', '(none)')]);
    this.fillOptions(this.folderSel, folders);
    this.fillOptions(this.extSel, types);
    this.folder = this.folderSel.value;
    this.extFilter = this.extSel.value;
  }

  private refilter(quiet = false): void {
    const f = this.folder, e = this.extFilter;
    for (let i = 0; i < this.n; i++) {
      let ok = true;
      if (this.cats[i] === 6) ok = this.layers.slots;
      else {
        if (f && this.dirs[i] !== f && !this.dirs[i].startsWith(`${f}/`)) ok = false;
        if (ok && e && (this.exts[i] || '(none)') !== e) ok = false;
        if (ok && !this.layers.orphans && this.inDeg[i] + this.outDeg[i] === 0) ok = false;
      }
      this.visible[i] = ok ? 1 : 0;
    }
    if (!quiet) { this.runSearch(true); this.syncCount(); this.refreshScene(); }
  }

  private runSearch(quiet = false): void {
    const terms = this.search.value.toLowerCase().split(/\s+/).filter(Boolean);
    this.matched.fill(0);
    this.matchList = [];
    this.matchAt = -1;
    if (terms.length) {
      for (let i = 0; i < this.n; i++) {
        if (!this.visible[i]) continue;
        const hay = this.paths[i].toLowerCase();
        if (terms.every((x) => hay.includes(x))) { this.matched[i] = 1; this.matchList.push(i); }
      }
    }
    this.matchCount = this.matchList.length;
    if (!quiet) { this.syncCount(); this.refreshScene(); }
  }

  private stepMatch(by: number): void {
    if (!this.matchList.length) return;
    this.matchAt = (this.matchAt + by + this.matchList.length) % this.matchList.length;
    const i = this.matchList[this.matchAt];
    this.selected = i;
    this.view.x = this.w / 2 - this.pos[i * 2] * this.view.k;
    this.view.y = this.h / 2 - this.pos[i * 2 + 1] * this.view.k;
    if (this.view.k < 0.6) { this.zoomAt(this.w / 2, this.h / 2, 0.6 / this.view.k); return; }
    this.rememberView();
    this.invalidate();
  }

  private syncCount(): void {
    let shown = 0;
    for (let i = 0; i < this.n; i++) if (this.visible[i] && this.cats[i] !== 6) shown++;
    const total = this.n - this.slotCount;
    let text = this.search.value.trim() ? `${this.matchCount} / ${shown}` : shown === total ? `${total}` : `${shown} / ${total}`;
    text += ` ${t('files')} · ${this.edges.length / 2 - this.slotEdges()} ${t('links')}`;
    if (this.base?.truncated) text += ` · ${t('partial')}`;
    setText(this.count, text);
    setTitle(this.count, this.base?.truncated ? this.base.reason : '');
  }

  private slotEdges(): number {
    let c = 0;
    for (let e = 0; e < this.edges.length; e += 2) if (this.cats[this.edges[e]] === 6) c++;
    return c;
  }

  private resize(): void {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    if (this.w > 0 && this.fitted) { this.view.x += (w - this.w) / 2; this.view.y += (h - this.h) / 2; }
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const mw = this.mini.clientWidth, mh = this.mini.clientHeight;
    this.mini.width = Math.round(mw * dpr);
    this.mini.height = Math.round(mh * dpr);
    if (!this.fitted && this.n > 0 && this.settled) this.fit();
    this.refreshScene();
  }

  private retheme(force = false): void {
    if (!this.active && !force) { this.stale = true; return; }
    this.stale = false;
    const cs = getComputedStyle(this.root);
    const read = (name: string): string => {
      this.probe.style.color = `var(${name})`;
      return getComputedStyle(this.probe).color;
    };
    this.colors = CAT_VARS.map(read);
    this.ink = {
      line: read('--line-2'), lineHot: read('--accent-color'), text: read('--text-primary'), muted: read('--text-muted'),
      bg: read('--bg-primary'), accent: read('--accent-color'), dot: read('--line-1'), halo: read('--bg-primary'),
    };
    this.font = cs.fontFamily || 'sans-serif';
    this.refreshScene();
  }

  private invalidate(): void {
    this.dirty = true;
    if (this.frame || !this.active) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; if (this.dirty) this.paint(); });
  }

  private remember(): void {
    if (!this.base || this.n === 0) return;
    const pos = new Map<string, [number, number]>();
    const pinned = new Set<string>();
    for (let i = 0; i < this.n; i++) {
      if (this.cats[i] === 6) continue;
      pos.set(this.paths[i], [this.pos[i * 2], this.pos[i * 2 + 1]]);
      if (this.pinned[i]) pinned.add(this.paths[i]);
    }
    memory.set(this.rootKey, { sig: this.base.sig, pos, pinned, view: { ...this.view }, placed: this.placed });
  }

  private fit(soft = false): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < this.n; i++) {
      if (!this.visible[i] || !(this.placed || this.inDeg[i] + this.outDeg[i] > 0)) continue;
      const x = this.pos[i * 2], y = this.pos[i * 2 + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (!isFinite(minX) || this.w === 0) return;
    const pad = 48;
    const bw = Math.max(maxX - minX, 40), bh = Math.max(maxY - minY, 40);
    const k = Math.min(2, Math.max(MIN_K, Math.min((this.w - pad * 2) / bw, (this.h - pad * 2) / bh)));
    this.view = { k, x: this.w / 2 - ((minX + maxX) / 2) * k, y: this.h / 2 - ((minY + maxY) / 2) * k };
    if (!soft) this.fitted = true;
    this.rememberView();
    this.invalidate();
  }

  private zoomAt(sx: number, sy: number, factor: number): void {
    const k = Math.min(MAX_K, Math.max(MIN_K, this.view.k * factor));
    this.view.x = sx - ((sx - this.view.x) / this.view.k) * k;
    this.view.y = sy - ((sy - this.view.y) / this.view.k) * k;
    this.view.k = k;
    this.fitted = true;
    this.touch();
    this.rememberView();
    this.invalidate();
  }

  private rememberView(): void {
    const s = memory.get(this.rootKey);
    if (s) s.view = { ...this.view };
  }

  private scaleRadii(): void {
    const k = this.view.k;
    if (this.radius.length !== this.n) this.radius = new Float32Array(this.n);
    else if (k === this.radK) return;
    this.radK = k;
    const f = k > 1 ? Math.pow(k, -0.6) : 1;
    for (let i = 0; i < this.n; i++) this.radius[i] = this.radBase[i] * f;
  }

  private hit(sx: number, sy: number): number {
    this.scaleRadii();
    const wx = (sx - this.view.x) / this.view.k, wy = (sy - this.view.y) / this.view.k;
    const slop = 3 / this.view.k;
    let best = -1, bestD = Infinity;
    for (let i = this.n - 1; i >= 0; i--) {
      if (!this.visible[i]) continue;
      if (!this.placed && this.inDeg[i] + this.outDeg[i] === 0) continue;
      const dx = this.pos[i * 2] - wx, dy = this.pos[i * 2 + 1] - wy;
      const r = this.radius[i] + slop;
      const d = dx * dx + dy * dy;
      if (d <= r * r && d < bestD) { best = i; bestD = d; }
    }
    return best;
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const s = r.width > 0 ? this.w / r.width : 1;
    return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s };
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.canvas.focus({ preventScroll: true });
    const p = this.local(e);
    const node = this.hit(p.x, p.y);
    this.drag = { mode: node >= 0 ? 'node' : 'pan', x: p.x, y: p.y, vx: this.view.x, vy: this.view.y, node, moved: false, id: e.pointerId };
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e);
    this.mouse = { x: p.x, y: p.y, in: true };
    const d = this.drag;
    if (!d) { this.setHover(this.hit(p.x, p.y)); return; }
    const dx = p.x - d.x, dy = p.y - d.y;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    d.moved = true;
    if (d.mode === 'pan') {
      this.view.x = d.vx + dx;
      this.view.y = d.vy + dy;
      this.fitted = true;
      this.touch();
    } else {
      const i = d.node;
      if (this.hide !== i) { this.hide = i; this.renderScene(); }
      const x = (p.x - this.view.x) / this.view.k, y = (p.y - this.view.y) / this.view.k;
      this.pos[i * 2] = x; this.pos[i * 2 + 1] = y;
      this.pinned[i] = 1;
      const k = this.simIdx.indexOf(i);
      if (k >= 0) this.worker.postMessage({ type: 'pin', i: k, x, y } satisfies LayoutIn);
      this.worker.postMessage({ type: 'heat', alpha: 0.25 } satisfies LayoutIn);
      this.setHover(i);
    }
    this.invalidate();
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (this.canvas.hasPointerCapture(d.id)) this.canvas.releasePointerCapture(d.id);
    if (d.mode === 'node' && !d.moved) {
      const i = d.node;
      this.selected = i;
      const path = this.cats[i] === 6 ? this.firstFileOf(i) : this.paths[i];
      if (path) this.openFile(path);
    } else if (d.mode === 'pan' && !d.moved) {
      this.selected = -1;
    }
    this.remember();
    if (this.hide >= 0) this.hide = -1;
    this.refreshScene();
    void e;
  }

  private firstFileOf(slot: number): string {
    const a = this.adjOff[slot];
    return this.adjOff[slot + 1] > a ? this.paths[this.adj[a]] : '';
  }

  private setHover(i: number): void {
    if (i === this.hover) { if (i >= 0) this.placeTip(); return; }
    this.hover = i;
    this.canvas.style.cursor = i >= 0 ? 'pointer' : '';
    if (i >= 0) {
      const slot = this.cats[i] === 6;
      setText(this.tipPath, slot ? `${t('Slot')} ${this.names[i]}` : this.paths[i]);
      const files = this.base?.nodes[i];
      setText(this.tipMeta, slot ? `${this.adjOff[i + 1] - this.adjOff[i]} ${t('files')}` : `${this.outDeg[i]} ${t('imports')} · ${this.inDeg[i]} ${t('imported by')}${files ? ` · ${this.size(files.size)}` : ''}`);
      this.placeTip();
    }
    setClass(this.tip, 'is-on', i >= 0);
    this.invalidate();
  }

  private size(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  }

  private placeTip(): void {
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    let x = this.mouse.x + 14, y = this.mouse.y + 14;
    if (x + tw > this.w - 8) x = this.mouse.x - tw - 14;
    if (y + th > this.h - 8) y = this.mouse.y - th - 14;
    this.tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }

  private touch(): void {
    this.lastInteract = performance.now();
  }

  private later(ms: number): void {
    if (this.timer) return;
    this.timer = window.setTimeout(() => { this.timer = 0; this.invalidate(); }, ms);
  }

  private refreshScene(): void {
    this.sceneStale = true;
    this.invalidate();
  }

  private paint(): void {
    this.dirty = false;
    const { ctx, w, h, dpr } = this;
    if (w === 0) return;
    if (this.colors.length === 0) { if (this.active) this.retheme(true); if (this.colors.length === 0) return; }
    this.scaleRadii();
    const now = performance.now();
    const v = this.view;
    const moved = !this.sceneOk || v.k !== this.sceneV.k || v.x !== this.sceneV.x || v.y !== this.sceneV.y;
    const carrying = this.drag?.mode === 'node' && this.drag.moved;
    const busy = carrying || now - this.lastInteract < SETTLE_MS;
    if ((this.sceneStale || moved) && !busy && (this.settled || !this.sceneOk || now - this.lastScene >= LIVE_MS)) this.renderScene();
    else if (this.sceneStale || moved) this.later(busy && !carrying ? SETTLE_MS : LIVE_MS);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.paintGrid();
    if (this.sceneOk) {
      const s = v.k / this.sceneV.k;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (v.x - this.sceneV.x * s), dpr * (v.y - this.sceneV.y * s));
      ctx.drawImage(this.scene, -this.mx, -this.my, w + this.mx * 2, h + this.my * 2);
    }
    this.paintFocus();
    this.drawMini();
  }

  private renderScene(): void {
    const { w, h, dpr } = this;
    const mx = Math.round(w * 0.2), my = Math.round(h * 0.2);
    const sw = Math.round((w + mx * 2) * dpr), sh = Math.round((h + my * 2) * dpr);
    if (this.scene.width !== sw || this.scene.height !== sh) { this.scene.width = sw; this.scene.height = sh; }
    this.mx = mx; this.my = my;
    this.sceneV = { ...this.view };
    this.sceneOk = true;
    this.sceneStale = false;
    this.lastScene = performance.now();
    const ctx = this.sctx;
    const { x: vx, y: vy, k } = this.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, sw, sh);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (vx + mx), dpr * (vy + my));
    const x0 = -(vx + mx) / k - 20, y0 = -(vy + my) / k - 20, x1 = (w + mx - vx) / k + 20, y1 = (h + my - vy) / k + 20;
    const pos = this.pos, n = this.n;
    const focus = -1;
    const near = (i: number): boolean => {
      if (focus < 0) return false;
      if (i === focus) return true;
      for (let a = this.adjOff[focus]; a < this.adjOff[focus + 1]; a++) if (this.adj[a] === i) return true;
      return false;
    };
    const live = (i: number): boolean => this.visible[i] === 1 && i !== this.hide && (this.placed || this.inDeg[i] + this.outDeg[i] > 0);
    const searching = this.matchCount > 0 || this.search.value.trim().length > 0;
    const dimmed = focus >= 0 || searching;

    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = this.ink.line;
    ctx.globalAlpha = dimmed ? 0.35 : 0.8;
    ctx.beginPath();
    const arrows = k >= 1.6;
    const hot: number[] = [];
    for (let e = 0; e < this.edges.length; e += 2) {
      const a = this.edges[e], b = this.edges[e + 1];
      if (!live(a) || !live(b)) continue;
      const ax = pos[a * 2], ay = pos[a * 2 + 1], bx = pos[b * 2], by = pos[b * 2 + 1];
      if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1) || (ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
      if (focus >= 0 && (a === focus || b === focus)) { hot.push(e); continue; }
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      if (arrows) this.arrow(ctx, a, b);
    }
    ctx.stroke();
    if (hot.length) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.ink.lineHot;
      ctx.lineWidth = 1.6 / k;
      ctx.beginPath();
      for (const e of hot) {
        const a = this.edges[e], b = this.edges[e + 1];
        ctx.moveTo(pos[a * 2], pos[a * 2 + 1]);
        ctx.lineTo(pos[b * 2], pos[b * 2 + 1]);
        this.arrow(ctx, a, b);
      }
      ctx.stroke();
    }

    for (let pass = 0; pass < 2; pass++) {
      for (let c = 0; c < 7; c++) {
        ctx.globalAlpha = pass === 0 ? 0.22 : 0.92;
        ctx.fillStyle = this.colors[c];
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (this.cats[i] !== c || !live(i)) continue;
          const bright = searching ? this.matched[i] === 1 : focus >= 0 ? near(i) : true;
          if (pass === 0 ? bright : !bright) continue;
          const x = pos[i * 2], y = pos[i * 2 + 1];
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          const r = this.radius[i];
          if (c === 6) { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
          else { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
        }
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (this.pinnedAny()) {
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = this.ink.muted;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (!this.pinned[i] || !live(i)) continue;
        ctx.moveTo(pos[i * 2] + this.radius[i] + 2 / k, pos[i * 2 + 1]);
        ctx.arc(pos[i * 2], pos[i * 2 + 1], this.radius[i] + 2 / k, 0, 6.2832);
      }
      ctx.stroke();
    }
    this.paintLabels(x0, y0, x1, y1, focus, near, live);
    this.renderMini();
  }

  private paintFocus(): void {
    const focus = this.hover >= 0 ? this.hover : this.selected;
    const { ctx, w, h, dpr } = this;
    const { x: vx, y: vy, k } = this.view;
    const live = (i: number): boolean => this.visible[i] === 1 && (this.placed || this.inDeg[i] + this.outDeg[i] > 0);
    if (focus < 0 || !live(focus)) return;
    const pos = this.pos;
    const veil = this.hover >= 0 || this.selected >= 0;
    if (veil) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = this.ink.bg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * vx, dpr * vy);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.ink.lineHot;
    ctx.lineWidth = 1.6 / k;
    ctx.beginPath();
    const from = this.adjOff[focus], to = this.adjOff[focus + 1];
    for (let a = from; a < to; a++) {
      const j = this.adj[a];
      if (!live(j)) continue;
      ctx.moveTo(pos[focus * 2], pos[focus * 2 + 1]);
      ctx.lineTo(pos[j * 2], pos[j * 2 + 1]);
      if (this.adjOut[a]) this.arrow(ctx, focus, j); else this.arrow(ctx, j, focus);
    }
    ctx.stroke();
    for (let c = 0; c < 7; c++) {
      ctx.fillStyle = this.colors[c];
      ctx.beginPath();
      for (let a = from - 1; a < to; a++) {
        const i = a < from ? focus : this.adj[a];
        if (this.cats[i] !== c || !live(i)) continue;
        const x = pos[i * 2], y = pos[i * 2 + 1], r = this.radius[i];
        if (c === 6) { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
        else { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
      }
      ctx.fill();
    }
    ctx.strokeStyle = this.ink.accent;
    ctx.lineWidth = 2 / k;
    ctx.beginPath();
    ctx.arc(pos[focus * 2], pos[focus * 2 + 1], this.radius[focus] + 2 / k, 0, 6.2832);
    ctx.stroke();
    const size = 11 / k;
    ctx.font = `${size}px ${this.font}`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 / k;
    let shown = 0;
    for (let a = from - 1; a < to && shown < 80; a++) {
      const i = a < from ? focus : this.adj[a];
      if (!live(i)) continue;
      shown++;
      const x = pos[i * 2] + this.radius[i] + 3 / k, y = pos[i * 2 + 1];
      ctx.strokeStyle = this.ink.halo;
      ctx.strokeText(this.names[i], x, y);
      ctx.fillStyle = i === focus ? this.ink.accent : this.ink.text;
      ctx.fillText(this.names[i], x, y);
    }
  }

  private pinnedAny(): boolean {
    for (let i = 0; i < this.n; i++) if (this.pinned[i]) return true;
    return false;
  }

  private arrow(ctx: CanvasRenderingContext2D, a: number, b: number): void {
    const ax = this.pos[a * 2], ay = this.pos[a * 2 + 1], bx = this.pos[b * 2], by = this.pos[b * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const d = Math.hypot(dx, dy);
    if (d < 1) return;
    const ux = dx / d, uy = dy / d;
    const tx = bx - ux * (this.radius[b] + 1), ty = by - uy * (this.radius[b] + 1);
    const s = 5 / Math.max(this.view.k, 1) + 2;
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - ux * s - uy * s * 0.5, ty - uy * s + ux * s * 0.5);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - ux * s + uy * s * 0.5, ty - uy * s - ux * s * 0.5);
  }

  private paintLabels(x0: number, y0: number, x1: number, y1: number, focus: number, near: (i: number) => boolean, live: (i: number) => boolean): void {
    const ctx = this.sctx;
    const k = this.sceneV.k;
    const size = 11 / k;
    ctx.font = `${size}px ${this.font}`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 / k;
    const shown = new Set<number>();
    const want: number[] = [];
    const add = (i: number): void => { if (i >= 0 && !shown.has(i) && live(i)) { shown.add(i); want.push(i); } };
    if (focus >= 0) { add(focus); for (let a = this.adjOff[focus]; a < this.adjOff[focus + 1]; a++) add(this.adj[a]); }
    if (this.matchCount > 0 && this.matchCount <= 400) for (const i of this.matchList) add(i);
    if (k >= 1.1) {
      const cand: number[] = [];
      for (let i = 0; i < this.n; i++) {
        if (!live(i)) continue;
        const x = this.pos[i * 2], y = this.pos[i * 2 + 1];
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) cand.push(i);
      }
      cand.sort((a, b) => this.inDeg[b] - this.inDeg[a]);
      for (const i of cand.slice(0, k >= 2 ? 500 : 140)) add(i);
    } else if (k >= 0.35) {
      const cand: number[] = [];
      for (let i = 0; i < this.n; i++) {
        if (!live(i) || this.inDeg[i] < 6) continue;
        const x = this.pos[i * 2], y = this.pos[i * 2 + 1];
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) cand.push(i);
      }
      cand.sort((a, b) => this.inDeg[b] - this.inDeg[a]);
      for (const i of cand.slice(0, 40)) add(i);
    }
    for (const i of want) {
      const x = this.pos[i * 2] + this.radius[i] + 3 / k, y = this.pos[i * 2 + 1];
      const hotLabel = i === focus || near(i) || this.matched[i] === 1;
      ctx.globalAlpha = hotLabel || focus < 0 ? 1 : 0.5;
      ctx.strokeStyle = this.ink.halo;
      ctx.strokeText(this.names[i], x, y);
      ctx.fillStyle = i === focus ? this.ink.accent : this.ink.text;
      ctx.fillText(this.names[i], x, y);
    }
    ctx.globalAlpha = 1;
  }

  private paintGrid(): void {
    const { ctx, w, h, view } = this;
    let step = GRID * view.k;
    if (step < 7) return;
    while ((w / step) * (h / step) > 4500) step *= 2;
    const ox = ((view.x % step) + step) % step, oy = ((view.y % step) + step) % step;
    ctx.fillStyle = this.ink.dot;
    ctx.beginPath();
    for (let x = ox; x < w; x += step) for (let y = oy; y < h; y += step) ctx.rect(x - 0.5, y - 0.5, 1.2, 1.2);
    ctx.fill();
  }

  private renderMini(): void {
    if (!this.mmOpen) return;
    const { mbctx: m, dpr } = this;
    const mw = this.mini.width / dpr, mh = this.mini.height / dpr;
    if (mw === 0) return;
    if (this.mbase.width !== this.mini.width || this.mbase.height !== this.mini.height) { this.mbase.width = this.mini.width; this.mbase.height = this.mini.height; }
    m.setTransform(dpr, 0, 0, dpr, 0, 0);
    m.clearRect(0, 0, mw, mh);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < this.n; i++) {
      if (!this.visible[i] || !(this.placed || this.inDeg[i] + this.outDeg[i] > 0)) continue;
      const x = this.pos[i * 2], y = this.pos[i * 2 + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (!isFinite(minX)) { this.mbOk = false; return; }
    this.mbOk = true;
    const pad = 6;
    const bw = Math.max(maxX - minX, 1), bh = Math.max(maxY - minY, 1);
    const scale = Math.min((mw - pad * 2) / bw, (mh - pad * 2) / bh);
    const ox = (mw - bw * scale) / 2, oy = (mh - bh * scale) / 2;
    this.mmBox = { minX, minY, scale, ox, oy };
    const dim = this.matchCount > 0;
    for (let c = 0; c < 7; c++) {
      m.fillStyle = this.colors[c];
      m.globalAlpha = dim ? 0.3 : 0.85;
      m.beginPath();
      for (let i = 0; i < this.n; i++) {
        if (this.cats[i] !== c || !this.visible[i] || !(this.placed || this.inDeg[i] + this.outDeg[i] > 0)) continue;
        if (dim && this.matched[i]) continue;
        m.rect(ox + (this.pos[i * 2] - minX) * scale - 0.5, oy + (this.pos[i * 2 + 1] - minY) * scale - 0.5, 1.4, 1.4);
      }
      m.fill();
    }
    if (dim) {
      m.globalAlpha = 1;
      m.fillStyle = this.ink.accent;
      m.beginPath();
      for (const i of this.matchList) m.rect(ox + (this.pos[i * 2] - minX) * scale - 1, oy + (this.pos[i * 2 + 1] - minY) * scale - 1, 2.6, 2.6);
      m.fill();
    }
    m.globalAlpha = 1;
  }

  private drawMini(): void {
    if (!this.mmOpen) return;
    const { mctx: m, dpr } = this;
    const mw = this.mini.width / dpr, mh = this.mini.height / dpr;
    if (mw === 0) return;
    m.setTransform(dpr, 0, 0, dpr, 0, 0);
    m.clearRect(0, 0, mw, mh);
    if (!this.mbOk || this.mbase.width !== this.mini.width) return;
    m.drawImage(this.mbase, 0, 0, mw, mh);
    const { minX, minY, scale, ox, oy } = this.mmBox;
    m.strokeStyle = this.ink.accent;
    m.lineWidth = 1;
    const wx = -this.view.x / this.view.k, wy = -this.view.y / this.view.k;
    m.strokeRect(ox + (wx - minX) * scale, oy + (wy - minY) * scale, (this.w / this.view.k) * scale, (this.h / this.view.k) * scale);
  }
}
