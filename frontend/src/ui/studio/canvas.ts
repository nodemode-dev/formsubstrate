import { nextId, ROUTES, type Command, type GraphDoc, type GraphEdge, type GraphNode, type NodeKind } from '../../engine';
import { promptName } from '../dialogs';
import { el, q, setClass, setHidden, setStyleVar, setText, setTitle } from '../dom';
import { t } from '../i18n';
import { icon } from '../icons';
import { studio } from './api';
import { CtxMenu, type CtxItem } from './context-menu';
import { KIND_LIST, kindMeta, NODE_H, NODE_W } from './kinds';
import { patchKeyed, setAttr, svgEl } from './keyed';

export const DRAG_TYPE = 'application/x-subform-node';

const GRID = 10;
const MIN_K = 0.25;
const MAX_K = 2.5;
const MINI_W = 148;
const MINI_H = 92;
const MM_KEY = 'subform.studio.minimap';

interface View { x: number; y: number; k: number }
interface NodeView { el: HTMLElement; kind: string; label: string; x: number; y: number; status: string }
interface EdgeView { g: SVGElement; hit: SVGElement; line: SVGElement; pill: HTMLElement; from: string; to: string; label: string; d: string; px: number; py: number; state: string }
interface Pt { x: number; y: number }

type Gesture =
  | { mode: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { mode: 'node'; id: string; dx: number; dy: number; moved: boolean }
  | { mode: 'wire'; from: string; x: number; y: number };

const snap = (n: number): number => Math.round(n / GRID) * GRID;

function route(a: Pt, b: Pt): { d: string; mx: number; my: number } {
  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
  let c1x: number, c1y: number, c2x: number, c2y: number;
  if (x2 >= x1 + 24) {
    const c = Math.max(40, (x2 - x1) / 2);
    c1x = x1 + c; c1y = y1; c2x = x2 - c; c2y = y2;
  } else {
    const dip = Math.max(y1, y2) + 70 + Math.abs(y1 - y2) * 0.2;
    c1x = x1 + 70; c1y = dip; c2x = x2 - 70; c2y = dip;
  }
  return {
    d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
    mx: Math.round(((x1 + 3 * c1x + 3 * c2x + x2) / 8) * 10) / 10,
    my: Math.round(((y1 + 3 * c1y + 3 * c2y + y2) / 8) * 10) / 10,
  };
}

export class StudioCanvas {
  readonly stage: HTMLElement;
  private readonly world: HTMLElement;
  private readonly nodeLayer: HTMLElement;
  private readonly pillLayer: HTMLElement;
  private readonly edgeSvg: SVGElement;
  private readonly edgeLayer: SVGElement;
  private readonly wirePath: SVGElement;
  private readonly note: HTMLElement;
  private readonly mini: SVGElement;
  private readonly miniEdges: SVGElement;
  private readonly miniNodes: SVGElement;
  private readonly miniView: SVGElement;
  private readonly miniBtn: HTMLButtonElement;
  private readonly zoomLabel: HTMLElement;
  private readonly menu = new CtxMenu();
  private readonly nodes = new Map<string, NodeView>();
  private readonly edges = new Map<string, EdgeView>();
  private readonly pos = new Map<string, Pt>();
  private readonly offs: Array<() => void> = [];
  private readonly resizer: ResizeObserver;
  private view: View = { x: 40, y: 40, k: 1 };
  private gesture: Gesture | null = null;
  private miniOpen = true;
  private needFit = true;
  private frame = 0;
  private miniFrame = 0;
  private miniBox = { minX: 0, minY: 0, k: 1, ox: 0, oy: 0 };
  private spawns = 0;

  constructor(host: HTMLElement) {
    this.stage = el(
      '<div class="cv-st-stage" tabindex="0">' +
      '<div class="cv-st-world"><svg class="cv-st-edges" width="1" height="1" aria-hidden="true"><defs>' +
      '<marker id="st-arr" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1L9 5L0 9z" class="cv-st-arr"/></marker>' +
      '<marker id="st-arr-hot" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1L9 5L0 9z" class="cv-st-arr is-hot"/></marker>' +
      '<marker id="st-arr-sel" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1L9 5L0 9z" class="cv-st-arr is-sel"/></marker>' +
      '</defs><g class="cv-st-edge-layer"></g><path class="cv-st-wire is-off" d=""></path></svg>' +
      '<div class="cv-st-pills"></div><div class="cv-st-nodes" role="listbox" aria-orientation="horizontal"></div></div>' +
      '<p class="cv-st-note cv-note"></p>' +
      '<div class="cv-st-ui cv-st-zoom">' +
      `<button class="cv-st-zbtn" type="button" data-z="in">${icon('zoomIn', 16)}</button>` +
      `<button class="cv-st-zbtn" type="button" data-z="out">${icon('zoomOut', 16)}</button>` +
      `<button class="cv-st-zbtn" type="button" data-z="fit">${icon('fit', 16)}</button>` +
      '<span class="cv-st-zoom-pct"></span></div>' +
      `<svg class="cv-st-ui cv-st-mini" viewBox="0 0 ${MINI_W} ${MINI_H}" width="${MINI_W}" height="${MINI_H}"><g class="cv-st-mini-edges"></g><g class="cv-st-mini-nodes"></g><rect class="cv-st-mini-view" x="0" y="0" width="0" height="0"></rect></svg>` +
      `<button class="cv-st-ui cv-st-mm" type="button">${icon('chevronRight', 14)}</button>` +
      '</div>');
    host.append(this.stage);
    this.world = q(this.stage, '.cv-st-world');
    this.nodeLayer = q(this.stage, '.cv-st-nodes');
    this.pillLayer = q(this.stage, '.cv-st-pills');
    this.edgeSvg = q<SVGElement>(this.stage, '.cv-st-edges');
    this.edgeLayer = q<SVGElement>(this.stage, '.cv-st-edge-layer');
    this.wirePath = q<SVGElement>(this.stage, '.cv-st-wire');
    this.note = q(this.stage, '.cv-st-note');
    this.mini = q<SVGElement>(this.stage, '.cv-st-mini');
    this.miniEdges = q<SVGElement>(this.stage, '.cv-st-mini-edges');
    this.miniNodes = q<SVGElement>(this.stage, '.cv-st-mini-nodes');
    this.miniView = q<SVGElement>(this.stage, '.cv-st-mini-view');
    this.miniBtn = q<HTMLButtonElement>(this.stage, '.cv-st-mm');
    this.zoomLabel = q(this.stage, '.cv-st-zoom-pct');
    try { this.miniOpen = localStorage.getItem(MM_KEY) !== '0'; } catch { this.miniOpen = true; }
    setText(this.note, t('Right-click the canvas or drag a node from the palette to start.'));
    this.labels();
    this.wire();
    this.resizer = new ResizeObserver(() => this.resized());
    this.resizer.observe(this.stage);
    this.offs.push(studio.engine.onChange(() => this.sync()));
    this.offs.push(studio.engine.statusChanged.on(() => this.paintStatus()));
    this.offs.push(studio.onSelect(() => this.paintSelection()));
    this.sync();
    this.applyView();
  }

  private labels(): void {
    for (const b of Array.from(this.stage.querySelectorAll<HTMLButtonElement>('.cv-st-zbtn'))) {
      const z = b.dataset.z;
      const text = z === 'in' ? t('Zoom in') : z === 'out' ? t('Zoom out') : t('Fit to window');
      setTitle(b, text);
      b.setAttribute('aria-label', text);
    }
    this.syncMiniBtn();
  }

  private syncMiniBtn(): void {
    setClass(this.miniBtn, 'is-open', this.miniOpen);
    this.miniBtn.setAttribute('aria-pressed', String(this.miniOpen));
    const text = this.miniOpen ? t('Hide minimap') : t('Show minimap');
    setTitle(this.miniBtn, text);
    this.miniBtn.setAttribute('aria-label', text);
    setClass(this.mini, 'is-off', !this.miniOpen || this.nodes.size === 0);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.resizer.disconnect();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.miniFrame);
  }

  activate(): void {
    this.resized();
  }

  requestFit(): void {
    this.needFit = true;
    this.resized();
  }

  private resized(): void {
    const r = this.stage.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    if (this.needFit) { this.needFit = false; this.fit(); return; }
    this.drawMini();
  }

  private toWorld(cx: number, cy: number): Pt {
    const r = this.stage.getBoundingClientRect();
    return { x: (cx - r.left - this.view.x) / this.view.k, y: (cy - r.top - this.view.y) / this.view.k };
  }

  private applyView(): void {
    const v = this.view;
    this.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    setStyleVar(this.stage, '--st-gx', `${v.x}px`);
    setStyleVar(this.stage, '--st-gy', `${v.y}px`);
    setStyleVar(this.stage, '--st-gs', `${22 * v.k}px`);
    setText(this.zoomLabel, `${Math.round(v.k * 100)}%`);
    this.drawMini();
  }

  zoomAt(factor: number, cx: number, cy: number): void {
    const r = this.stage.getBoundingClientRect();
    const mx = cx - r.left, my = cy - r.top;
    const k = Math.min(MAX_K, Math.max(MIN_K, this.view.k * factor));
    this.view = { x: mx - ((mx - this.view.x) / this.view.k) * k, y: my - ((my - this.view.y) / this.view.k) * k, k };
    this.applyView();
  }

  zoomBy(factor: number): void {
    const r = this.stage.getBoundingClientRect();
    this.zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  fit(): void {
    const doc = studio.getDoc();
    const r = this.stage.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) { this.needFit = true; return; }
    if (!doc.nodes.length) { this.view = { x: 40, y: 40, k: 1 }; this.applyView(); return; }
    const b = this.bounds(doc);
    const w = b.maxX - b.minX + 120, h = b.maxY - b.minY + 120;
    const k = Math.min(1.4, Math.max(MIN_K, Math.min(r.width / w, r.height / h)));
    this.view = { k, x: (r.width - (b.maxX - b.minX) * k) / 2 - b.minX * k, y: (r.height - (b.maxY - b.minY) * k) / 2 - b.minY * k };
    this.applyView();
  }

  private bounds(doc: GraphDoc): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of doc.nodes) {
      const p = this.pos.get(n.id) ?? n;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + NODE_H);
    }
    return { minX, minY, maxX, maxY };
  }

  sync(): void {
    const doc = studio.getDoc();
    const dragging = this.gesture?.mode === 'node' ? this.gesture.id : '';
    const live = new Set(doc.nodes.map((n) => n.id));
    for (const id of Array.from(this.pos.keys())) if (!live.has(id)) this.pos.delete(id);
    for (const n of doc.nodes) if (n.id !== dragging || !this.pos.has(n.id)) this.pos.set(n.id, { x: n.x, y: n.y });
    patchKeyed(this.nodeLayer, doc.nodes, (n) => n.id, (n) => this.createNode(n), (node, n) => this.updateNode(node as HTMLElement, n));
    for (const id of Array.from(this.nodes.keys())) if (!live.has(id)) this.nodes.delete(id);
    patchKeyed(this.edgeLayer, doc.edges, (e) => e.id, (e) => this.createEdge(e), (node, e) => this.updateEdge(node, e));
    patchKeyed(this.pillLayer, doc.edges, (e) => e.id, (e) => this.edges.get(e.id)?.pill ?? el('<div></div>'), () => undefined);
    const edgeIds = new Set(doc.edges.map((e) => e.id));
    for (const id of Array.from(this.edges.keys())) if (!edgeIds.has(id)) this.edges.delete(id);
    for (const e of doc.edges) this.drawEdge(e.id);
    setHidden(this.note, doc.nodes.length > 0);
    this.syncMiniBtn();
    this.paintSelection();
    this.paintStatus();
    this.drawMini();
  }

  private createNode(n: GraphNode): HTMLElement {
    const node = el(
      '<div class="cv-st-node" role="option" tabindex="-1" aria-selected="false"><span class="cv-st-n-ico"></span><span class="cv-st-n-txt"><span class="cv-st-n-kind"></span><span class="cv-st-n-name"></span></span>' +
      '<i class="cv-st-n-dot"></i><i class="cv-st-port is-in"></i><i class="cv-st-port is-out"></i></div>');
    this.nodes.set(n.id, { el: node, kind: '', label: '\u0000', x: NaN, y: NaN, status: '' });
    this.updateNode(node, n);
    return node;
  }

  private updateNode(node: HTMLElement, n: GraphNode): void {
    let nv = this.nodes.get(n.id);
    if (!nv) { nv = { el: node, kind: '', label: '\u0000', x: NaN, y: NaN, status: '' }; this.nodes.set(n.id, nv); }
    if (nv.kind !== n.kind) {
      nv.kind = n.kind;
      const meta = kindMeta(n.kind);
      node.dataset.kind = n.kind;
      q(node, '.cv-st-n-ico').innerHTML = icon(meta.icon, 16);
      setText(q(node, '.cv-st-n-kind'), t(meta.label));
      nv.label = '\u0000';
    }
    if (nv.label !== n.label) {
      nv.label = n.label;
      setText(q(node, '.cv-st-n-name'), n.label);
      setTitle(node, `${n.label} (${t(kindMeta(n.kind).label)})`);
    }
    const name = `${t(kindMeta(n.kind).label)} ${n.label}`;
    if (node.getAttribute('aria-label') !== name) node.setAttribute('aria-label', name);
    const p = this.pos.get(n.id) ?? n;
    if (nv.x !== p.x || nv.y !== p.y) {
      nv.x = p.x; nv.y = p.y;
      node.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
  }

  private createEdge(e: GraphEdge): SVGElement {
    const g = svgEl('g');
    const hit = svgEl('path');
    const line = svgEl('path');
    hit.setAttribute('class', 'cv-st-edge-hit');
    line.setAttribute('class', 'cv-st-edge');
    g.append(hit, line);
    g.setAttribute('class', 'cv-st-edge-g');
    const pill = el('<div class="cv-st-pill" hidden></div>');
    pill.dataset.edge = e.id;
    g.dataset.edge = e.id;
    this.edges.set(e.id, { g, hit, line, pill, from: e.from, to: e.to, label: '\u0000', d: '', px: NaN, py: NaN, state: '' });
    this.updateEdge(g, e);
    return g;
  }

  private updateEdge(_node: Element, e: GraphEdge): void {
    const ev = this.edges.get(e.id);
    if (!ev) return;
    ev.from = e.from;
    ev.to = e.to;
    const label = e.label ?? '';
    const nameOf = (id: string): string => this.nodes.get(id)?.label ?? id;
    const spoken = `${nameOf(e.from)} ${t('to')} ${nameOf(e.to)}${label ? `: ${label}` : ''}`;
    if (_node.getAttribute('aria-label') !== spoken) {
      _node.setAttribute('aria-label', spoken);
      _node.setAttribute('role', 'img');
    }
    if (ev.label !== label) {
      ev.label = label;
      setText(ev.pill, label);
      setHidden(ev.pill, !label);
      ev.px = NaN;
    }
  }

  private drawEdge(id: string): void {
    const ev = this.edges.get(id);
    if (!ev) return;
    const a = this.pos.get(ev.from), b = this.pos.get(ev.to);
    if (!a || !b) return;
    const r = route(a, b);
    if (ev.d !== r.d) {
      ev.d = r.d;
      ev.hit.setAttribute('d', r.d);
      ev.line.setAttribute('d', r.d);
    }
    if (ev.label && (ev.px !== r.mx || ev.py !== r.my)) {
      ev.px = r.mx; ev.py = r.my;
      ev.pill.style.transform = `translate(${r.mx}px, ${r.my}px) translate(-50%, -50%)`;
    }
  }

  private paintStatus(): void {
    const eng = studio.engine;
    for (const [id, nv] of this.nodes) {
      const s = eng.nodeStatus(id) ?? '';
      if (nv.status === s) continue;
      nv.status = s;
      for (const c of ['running', 'done', 'error', 'parked']) setClass(nv.el, `is-${c}`, c === s);
    }
    this.paintEdges();
  }

  private paintSelection(): void {
    const sel = studio.selection;
    for (const [id, nv] of this.nodes) {
      const on = sel?.kind === 'node' && sel.id === id;
      setClass(nv.el, 'is-selected', on);
      const v = String(on);
      if (nv.el.getAttribute('aria-selected') !== v) nv.el.setAttribute('aria-selected', v);
    }
    this.paintEdges();
    this.drawMini();
  }

  private paintEdges(): void {
    const sel = studio.selection;
    for (const [id, ev] of this.edges) {
      const hot = this.nodes.get(ev.from)?.status === 'running' || this.nodes.get(ev.to)?.status === 'running';
      const selected = sel?.kind === 'edge' && sel.id === id;
      const state = selected ? 'sel' : hot ? 'hot' : '';
      if (ev.state === state) continue;
      ev.state = state;
      setClass(ev.line as unknown as Element, 'is-hot', state === 'hot');
      setClass(ev.line as unknown as Element, 'is-sel', state === 'sel');
      setAttr(ev.line, 'marker-end', state === 'sel' ? 'url(#st-arr-sel)' : state === 'hot' ? 'url(#st-arr-hot)' : 'url(#st-arr)');
      setClass(ev.pill, 'is-selected', selected);
    }
  }

  private drawMini(): void {
    if (this.miniFrame) return;
    this.miniFrame = requestAnimationFrame(() => { this.miniFrame = 0; this.paintMini(); });
  }

  private paintMini(): void {
    const doc = studio.getDoc();
    if (!this.miniOpen || !doc.nodes.length) return;
    const b = this.bounds(doc);
    const r = this.stage.getBoundingClientRect();
    const vx = -this.view.x / this.view.k, vy = -this.view.y / this.view.k, vw = r.width / this.view.k, vh = r.height / this.view.k;
    const minX = Math.min(b.minX, vx) - 30, minY = Math.min(b.minY, vy) - 30;
    const maxX = Math.max(b.maxX, vx + vw) + 30, maxY = Math.max(b.maxY, vy + vh) + 30;
    const k = Math.min(MINI_W / (maxX - minX), MINI_H / (maxY - minY));
    const ox = (MINI_W - (maxX - minX) * k) / 2, oy = (MINI_H - (maxY - minY) * k) / 2;
    this.miniBox = { minX, minY, k, ox, oy };
    const mx = (x: number): number => Math.round((ox + (x - minX) * k) * 100) / 100;
    const my = (y: number): number => Math.round((oy + (y - minY) * k) * 100) / 100;
    const sel = studio.selection;
    patchKeyed(this.miniNodes, doc.nodes, (n) => n.id, () => svgEl('rect'), (node, n) => {
      const p = this.pos.get(n.id) ?? n;
      setAttr(node, 'x', String(mx(p.x)));
      setAttr(node, 'y', String(my(p.y)));
      setAttr(node, 'width', String(Math.max(2, Math.round(NODE_W * k * 100) / 100)));
      setAttr(node, 'height', String(Math.max(1.5, Math.round(NODE_H * k * 100) / 100)));
      setAttr(node, 'rx', '1');
      setAttr(node, 'class', `cv-st-mm-node k-${n.kind}${sel?.kind === 'node' && sel.id === n.id ? ' is-selected' : ''}`);
    });
    patchKeyed(this.miniEdges, doc.edges, (e) => e.id, () => svgEl('line'), (node, e) => {
      const a = this.pos.get(e.from), c = this.pos.get(e.to);
      if (!a || !c) return;
      setAttr(node, 'x1', String(mx(a.x + NODE_W)));
      setAttr(node, 'y1', String(my(a.y + NODE_H / 2)));
      setAttr(node, 'x2', String(mx(c.x)));
      setAttr(node, 'y2', String(my(c.y + NODE_H / 2)));
      setAttr(node, 'class', 'cv-st-mm-edge');
    });
    setAttr(this.miniView, 'x', String(mx(vx)));
    setAttr(this.miniView, 'y', String(my(vy)));
    setAttr(this.miniView, 'width', String(Math.max(3, Math.round(vw * k * 100) / 100)));
    setAttr(this.miniView, 'height', String(Math.max(3, Math.round(vh * k * 100) / 100)));
  }

  private nextLabel(fromId: string, doc: GraphDoc): string | undefined {
    const from = doc.nodes.find((n) => n.id === fromId);
    const routes = from ? ROUTES[from.kind] : undefined;
    if (!routes) return undefined;
    const used = new Set(doc.edges.filter((e) => e.from === fromId).map((e) => e.label));
    return routes.find((r) => !used.has(r));
  }

  private connect(from: string, to: string): void {
    const doc = studio.getDoc();
    if (studio.engine.dispatch({ type: 'add_edge', from, to, label: this.nextLabel(from, doc) }, 'canvas')) {
      const added = studio.getDoc().edges.find((e) => e.from === from && e.to === to);
      if (added) studio.select({ kind: 'edge', id: added.id });
    }
  }

  addNode(kind: NodeKind, at: Pt, from?: string): string {
    const id = nextId('n');
    const doc = studio.getDoc();
    const cmds: Command[] = [{ type: 'add_node', kind, id, label: kind === 'call_graph' ? 'call graph' : kind, x: snap(at.x), y: snap(at.y), config: kind === 'foreach' ? { items: '', parallel: 1 } : undefined }];
    if (from) cmds.push({ type: 'add_edge', from, to: id, label: this.nextLabel(from, doc) });
    studio.engine.dispatchMany(cmds, 'canvas');
    studio.select({ kind: 'node', id });
    return id;
  }

  addAtCenter(kind: NodeKind): void {
    const r = this.stage.getBoundingClientRect();
    const c = this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    this.spawns += 1;
    this.addNode(kind, { x: c.x - NODE_W / 2 + ((this.spawns % 5) - 2) * 24, y: c.y - NODE_H / 2 + ((this.spawns % 4) - 1.5) * 28 });
  }

  autoLayout(): void {
    const doc = studio.getDoc();
    if (!doc.nodes.length) return;
    const out = new Map<string, string[]>();
    for (const e of doc.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    const layer = new Map<string, number>();
    const queue = doc.nodes.filter((n) => n.kind === 'start').map((n) => n.id);
    for (const id of queue) layer.set(id, 0);
    while (queue.length) {
      const id = queue.shift() as string;
      for (const next of out.get(id) ?? []) {
        if (layer.has(next)) continue;
        layer.set(next, (layer.get(id) ?? 0) + 1);
        queue.push(next);
      }
    }
    const reached = Math.max(-1, ...layer.values());
    const rows = new Map<number, number>();
    const moves = doc.nodes.map((n) => {
      const l = layer.get(n.id) ?? reached + 1;
      const row = rows.get(l) ?? 0;
      rows.set(l, row + 1);
      return { id: n.id, x: 60 + l * 240, y: 80 + row * 100 + (l % 2) * 30 };
    });
    studio.engine.dispatch({ type: 'move_nodes', moves }, 'canvas');
    this.fit();
  }

  duplicate(id: string): void {
    const n = studio.getDoc().nodes.find((x) => x.id === id);
    if (!n) return;
    const copy = nextId('n');
    studio.engine.dispatch({ type: 'add_node', kind: n.kind, id: copy, label: `${n.label} copy`, x: n.x + 30, y: n.y + 70, config: n.config ? structuredClone(n.config) : undefined }, 'canvas');
    studio.select({ kind: 'node', id: copy });
  }

  removeSelection(): void {
    const sel = studio.selection;
    if (!sel) return;
    studio.select(null);
    studio.engine.dispatch(sel.kind === 'node' ? { type: 'remove_node', id: sel.id } : { type: 'remove_edge', id: sel.id }, 'canvas');
  }

  async renameNode(id: string): Promise<void> {
    const n = studio.getDoc().nodes.find((x) => x.id === id);
    if (!n) return;
    const next = await promptName(t('Rename node'), n.label, t('Rename'));
    if (next !== null && next.trim()) studio.engine.dispatch({ type: 'rename_node', id, label: next.trim() }, 'canvas');
  }

  async editEdgeLabel(id: string): Promise<void> {
    const e = studio.getDoc().edges.find((x) => x.id === id);
    if (!e) return;
    const next = await promptName(t('Edge label'), e.label ?? '', t('Set'));
    if (next !== null) studio.engine.dispatch({ type: 'update_edge', id, label: next.trim() }, 'canvas');
  }

  private layoutOrder(): string[] {
    return [...this.nodes.keys()].sort((a, b) => {
      const p = this.pos.get(a), r = this.pos.get(b);
      return ((p?.x ?? 0) - (r?.x ?? 0)) || ((p?.y ?? 0) - (r?.y ?? 0)) || (a < b ? -1 : 1);
    });
  }

  private reveal(id: string): void {
    const p = this.pos.get(id);
    if (!p) return;
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    const sx = p.x * this.view.k + this.view.x, sy = p.y * this.view.k + this.view.y;
    const mx = NODE_W * this.view.k, my = NODE_H * this.view.k;
    let dx = 0, dy = 0;
    if (sx < 0) dx = -sx + 24; else if (sx + mx > w) dx = w - sx - mx - 24;
    if (sy < 0) dy = -sy + 24; else if (sy + my > h) dy = h - sy - my - 24;
    if (dx || dy) {
      this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
      this.applyView();
    }
  }

  private nodeMenu(x: number, y: number, id: string): void {
    studio.select({ kind: 'node', id });
    this.menu.show(x, y, [
      { label: t('Rename...'), run: () => { void this.renameNode(id); } },
      { label: t('Duplicate'), run: () => this.duplicate(id) },
      '-',
      { label: t('Delete'), run: () => { studio.select(null); studio.engine.dispatch({ type: 'remove_node', id }, 'canvas'); } },
    ]);
  }

  private edgeMenu(x: number, y: number, id: string): void {
    studio.select({ kind: 'edge', id });
    const e = studio.getDoc().edges.find((z) => z.id === id);
    const from = studio.getDoc().nodes.find((n) => n.id === e?.from);
    const routes = from ? ROUTES[from.kind] ?? [] : [];
    const items: CtxItem[] = routes.map((r) => ({ label: `${t('Label')}: ${r}`, run: () => { studio.engine.dispatch({ type: 'update_edge', id, label: r }, 'canvas'); } }));
    items.push({ label: t('Label: error'), run: () => { studio.engine.dispatch({ type: 'update_edge', id, label: 'error' }, 'canvas'); } });
    items.push({ label: t('Custom label...'), run: () => { void this.editEdgeLabel(id); } });
    items.push({ label: t('Clear label'), disabled: !e?.label, run: () => { studio.engine.dispatch({ type: 'update_edge', id, label: '' }, 'canvas'); } });
    items.push('-', { label: t('Delete edge'), run: () => { studio.select(null); studio.engine.dispatch({ type: 'remove_edge', id }, 'canvas'); } });
    this.menu.show(x, y, items);
  }

  private stageMenu(x: number, y: number, at: Pt): void {
    this.menu.show(x, y, [
      { label: t('Add node'), items: KIND_LIST.map((k) => ({ label: t(k.label), run: () => { this.addNode(k.kind, { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 }); } })) },
      '-',
      { label: t('Auto layout'), run: () => this.autoLayout() },
      { label: t('Fit to window'), run: () => this.fit() },
    ]);
  }

  private spawnMenu(x: number, y: number, from: string, at: Pt): void {
    this.menu.show(x, y, KIND_LIST.filter((k) => k.kind !== 'start').map((k) => ({ label: `${t('Add')} ${t(k.label)}`, run: () => { this.addNode(k.kind, { x: at.x, y: at.y - NODE_H / 2 }, from); } })));
  }

  private wire(): void {
    const stage = this.stage;
    stage.addEventListener('pointerdown', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest('.cv-st-ui')) return;
      if (e.button === 2) return;
      stage.focus({ preventScroll: true });
      const port = target.closest('.cv-st-port.is-out');
      const nodeEl = target.closest<HTMLElement>('.cv-st-node');
      const edgeEl = target.closest<Element>('[data-edge]');
      if (port && nodeEl?.dataset.key) {
        const w = this.toWorld(e.clientX, e.clientY);
        this.gesture = { mode: 'wire', from: nodeEl.dataset.key, x: w.x, y: w.y };
        studio.select({ kind: 'node', id: nodeEl.dataset.key });
      } else if (nodeEl?.dataset.key) {
        const id = nodeEl.dataset.key;
        const p = this.pos.get(id) ?? { x: 0, y: 0 };
        const w = this.toWorld(e.clientX, e.clientY);
        this.gesture = { mode: 'node', id, dx: w.x - p.x, dy: w.y - p.y, moved: false };
        studio.select({ kind: 'node', id });
      } else if (edgeEl instanceof Element && edgeEl.getAttribute('data-edge')) {
        studio.select({ kind: 'edge', id: edgeEl.getAttribute('data-edge') as string });
        return;
      } else {
        studio.select(null);
        this.gesture = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
        setClass(stage, 'is-panning', true);
      }
      try { stage.setPointerCapture(e.pointerId); } catch { return; }
    });
    stage.addEventListener('pointermove', (e) => {
      const g = this.gesture;
      if (!g) return;
      if (g.mode === 'pan') {
        this.view = { ...this.view, x: g.vx + (e.clientX - g.sx), y: g.vy + (e.clientY - g.sy) };
        this.applyView();
      } else if (g.mode === 'node') {
        const w = this.toWorld(e.clientX, e.clientY);
        const x = snap(w.x - g.dx), y = snap(w.y - g.dy);
        const cur = this.pos.get(g.id);
        if (cur && cur.x === x && cur.y === y) return;
        g.moved = true;
        this.pos.set(g.id, { x, y });
        const nv = this.nodes.get(g.id);
        if (nv) { nv.x = x; nv.y = y; nv.el.style.transform = `translate(${x}px, ${y}px)`; }
        for (const [id, ev] of this.edges) if (ev.from === g.id || ev.to === g.id) this.drawEdge(id);
        this.drawMini();
      } else {
        const w = this.toWorld(e.clientX, e.clientY);
        g.x = w.x; g.y = w.y;
        this.drawWire(g.from, w);
      }
    });
    const finish = (e: PointerEvent, cancelled: boolean): void => {
      const g = this.gesture;
      this.gesture = null;
      setClass(stage, 'is-panning', false);
      setClass(this.wirePath, 'is-off', true);
      if (!g) return;
      this.release(e.pointerId);
      if (cancelled) { this.sync(); return; }
      if (g.mode === 'node' && g.moved) {
        const p = this.pos.get(g.id);
        if (p) studio.engine.dispatch({ type: 'move_node', id: g.id, x: p.x, y: p.y }, 'canvas');
      } else if (g.mode === 'wire') {
        const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.cv-st-node');
        const to = under?.dataset.key;
        if (to && to !== g.from) this.connect(g.from, to);
        else if (!under) {
          const r = stage.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) this.spawnMenu(e.clientX, e.clientY, g.from, this.toWorld(e.clientX, e.clientY));
        }
      }
    };
    stage.addEventListener('pointerup', (e) => finish(e, false));
    stage.addEventListener('pointercancel', (e) => finish(e, true));
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
    }, { passive: false });
    stage.addEventListener('dblclick', (e) => {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = target?.closest<HTMLElement>('.cv-st-node');
      if (nodeEl?.dataset.key) { void this.renameNode(nodeEl.dataset.key); return; }
      const edgeEl = target?.closest<Element>('[data-edge]');
      const eid = edgeEl?.getAttribute('data-edge');
      if (eid) void this.editEdgeLabel(eid);
    });
    stage.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('.cv-st-ui')) return;
      const nodeEl = target?.closest<HTMLElement>('.cv-st-node');
      const edgeEl = target?.closest<Element>('[data-edge]');
      if (nodeEl?.dataset.key) this.nodeMenu(e.clientX, e.clientY, nodeEl.dataset.key);
      else if (edgeEl?.getAttribute('data-edge')) this.edgeMenu(e.clientX, e.clientY, edgeEl.getAttribute('data-edge') as string);
      else this.stageMenu(e.clientX, e.clientY, this.toWorld(e.clientX, e.clientY));
    });
    stage.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      const focused = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.cv-st-node') : null;
      if (e.target instanceof HTMLElement && e.target.closest('.cv-st-ui')) return;
      const arrow = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].indexOf(e.key);
      if (arrow >= 0 && !mod && !e.altKey) {
        const order = this.layoutOrder();
        if (order.length === 0) return;
        e.preventDefault();
        const at = focused?.dataset.key ? order.indexOf(focused.dataset.key) : -1;
        const to = e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : at < 0 ? 0 : (at + (arrow < 2 ? 1 : order.length - 1)) % order.length;
        const nv = this.nodes.get(order[to]);
        if (nv) {
          nv.el.focus({ preventScroll: true });
          this.reveal(order[to]);
        }
      } else if (e.key === 'Enter' && focused?.dataset.key) {
        e.preventDefault();
        studio.select({ kind: 'node', id: focused.dataset.key });
      } else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && (focused?.dataset.key || studio.selection?.kind === 'node')) {
        e.preventDefault();
        const id = focused?.dataset.key ?? (studio.selection?.id as string);
        const box = (this.nodes.get(id)?.el ?? focused)?.getBoundingClientRect();
        if (box) this.nodeMenu(box.left, box.bottom, id);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && studio.selection) {
        e.preventDefault();
        this.removeSelection();
      } else if (mod && !e.altKey && e.code === 'KeyZ') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) studio.engine.redo(); else studio.engine.undo();
      } else if (mod && !e.altKey && e.code === 'KeyY') {
        e.preventDefault();
        e.stopPropagation();
        studio.engine.redo();
      } else if (e.key === 'Escape') {
        if (this.gesture?.mode === 'wire') { this.gesture = null; setClass(this.wirePath, 'is-off', true); } else studio.select(null);
      }
    });
    stage.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    stage.addEventListener('drop', (e) => {
      const kind = e.dataTransfer?.getData(DRAG_TYPE);
      if (!kind) return;
      e.preventDefault();
      const meta = KIND_LIST.find((k) => k.kind === kind);
      if (!meta) return;
      const w = this.toWorld(e.clientX, e.clientY);
      this.addNode(meta.kind, { x: w.x - NODE_W / 2, y: w.y - NODE_H / 2 });
    });
    for (const b of Array.from(stage.querySelectorAll<HTMLButtonElement>('.cv-st-zbtn'))) {
      b.addEventListener('click', () => {
        const z = b.dataset.z;
        if (z === 'fit') this.fit(); else this.zoomBy(z === 'in' ? 1.2 : 1 / 1.2);
      });
    }
    this.miniBtn.addEventListener('click', () => {
      this.miniOpen = !this.miniOpen;
      try { localStorage.setItem(MM_KEY, this.miniOpen ? '1' : '0'); } catch { return; }
    });
    this.miniBtn.addEventListener('click', () => { this.syncMiniBtn(); this.drawMini(); });
    this.mini.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const m = this.mini.getBoundingClientRect();
      const px = ((e.clientX - m.left) / m.width) * MINI_W, py = ((e.clientY - m.top) / m.height) * MINI_H;
      const b = this.miniBox;
      const wx = b.minX + (px - b.ox) / b.k, wy = b.minY + (py - b.oy) / b.k;
      const r = this.stage.getBoundingClientRect();
      this.view = { ...this.view, x: r.width / 2 - wx * this.view.k, y: r.height / 2 - wy * this.view.k };
      this.applyView();
    });
  }

  private release(pointerId: number): void {
    try { this.stage.releasePointerCapture(pointerId); } catch { return; }
  }

  private drawWire(from: string, to: Pt): void {
    const a = this.pos.get(from);
    if (!a) return;
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
    setClass(this.wirePath, 'is-off', false);
    this.wirePath.setAttribute('d', `M ${x1} ${y1} C ${x1 + 50} ${y1}, ${to.x - 50} ${to.y}, ${to.x} ${to.y}`);
  }
}
