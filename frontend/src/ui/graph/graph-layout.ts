export interface LayoutInit {
  type: 'init';
  n: number;
  pos: Float32Array;
  edges: Int32Array;
  alpha: number;
}

export type LayoutIn =
  | LayoutInit
  | { type: 'pin'; i: number; x: number; y: number }
  | { type: 'unpin'; i: number }
  | { type: 'heat'; alpha: number }
  | { type: 'stop' };

export interface LayoutOut { type: 'tick'; pos: Float32Array; alpha: number; done: boolean }

const REPEL = 34;
const REPEL_MAX = 420;
const THETA = 0.9;
const LINK = 26;
const GRAVITY = 0.035;
const DAMP = 0.6;
const ALPHA_MIN = 0.006;
const ALPHA_DECAY = 0.972;
const SLICE_MS = 14;

let n = 0;
let pos = new Float32Array(0);
let vel = new Float32Array(0);
let edges = new Int32Array(0);
let deg = new Int32Array(0);
let pinned = new Uint8Array(0);
let alpha = 0;
let timer = 0;

let cm = new Float32Array(0);
let sx = new Float32Array(0);
let sy = new Float32Array(0);
let bx = new Float32Array(0);
let by = new Float32Array(0);
let bh = new Float32Array(0);
let ch = new Int32Array(0);
let body = new Int32Array(0);
let used = 0;
let stack = new Int32Array(0);

function allocTree(): void {
  const cap = n * 16 + 64;
  cm = new Float32Array(cap);
  sx = new Float32Array(cap);
  sy = new Float32Array(cap);
  bx = new Float32Array(cap);
  by = new Float32Array(cap);
  bh = new Float32Array(cap);
  ch = new Int32Array(cap * 4);
  body = new Int32Array(cap);
  stack = new Int32Array(cap);
}

function fresh(x: number, y: number, h: number): number {
  const id = used++;
  cm[id] = 0; sx[id] = 0; sy[id] = 0;
  bx[id] = x; by[id] = y; bh[id] = h;
  body[id] = -1;
  const o = id * 4;
  ch[o] = -1; ch[o + 1] = -1; ch[o + 2] = -1; ch[o + 3] = -1;
  return id;
}

function quadrant(node: number, x: number, y: number): number {
  return (x >= bx[node] ? 1 : 0) + (y >= by[node] ? 2 : 0);
}

function child(node: number, q: number): number {
  const h = bh[node] / 2;
  return fresh(bx[node] + ((q & 1) ? h : -h), by[node] + ((q & 2) ? h : -h), h);
}

function build(): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 2], y = pos[i * 2 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const h = Math.max(maxX - minX, maxY - minY, 1) / 2 + 1;
  used = 0;
  const root = fresh((minX + maxX) / 2, (minY + maxY) / 2, h);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 2], y = pos[i * 2 + 1];
    let node = root;
    for (;;) {
      cm[node] += 1; sx[node] += x; sy[node] += y;
      const leaf = ch[node * 4] < 0 && ch[node * 4 + 1] < 0 && ch[node * 4 + 2] < 0 && ch[node * 4 + 3] < 0;
      if (leaf && body[node] < 0 && cm[node] === 1) { body[node] = i; break; }
      if (leaf && bh[node] < 0.01) break;
      if (leaf && body[node] >= 0) {
        const b = body[node];
        body[node] = -1;
        const bq = quadrant(node, pos[b * 2], pos[b * 2 + 1]);
        const c = child(node, bq);
        ch[node * 4 + bq] = c;
        cm[c] = 1; sx[c] = pos[b * 2]; sy[c] = pos[b * 2 + 1]; body[c] = b;
      }
      const q = quadrant(node, x, y);
      let c = ch[node * 4 + q];
      if (c < 0) {
        c = child(node, q);
        ch[node * 4 + q] = c;
        cm[c] = 1; sx[c] = x; sy[c] = y; body[c] = i;
        break;
      }
      node = c;
    }
  }
}

function repel(i: number): void {
  const x = pos[i * 2], y = pos[i * 2 + 1];
  let vx = 0, vy = 0, top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const node = stack[--top];
    const m = cm[node];
    if (m === 0) continue;
    const dx = sx[node] / m - x, dy = sy[node] / m - y;
    const d2 = dx * dx + dy * dy;
    const size = bh[node] * 2;
    const leaf = body[node] >= 0 || (ch[node * 4] < 0 && ch[node * 4 + 1] < 0 && ch[node * 4 + 2] < 0 && ch[node * 4 + 3] < 0);
    if (leaf || size * size < THETA * THETA * d2) {
      if (leaf && body[node] === i && m === 1) continue;
      if (d2 > REPEL_MAX * REPEL_MAX) continue;
      const dd = d2 < 1 ? 1 : d2;
      const w = (REPEL * alpha * m) / dd;
      vx -= dx * w; vy -= dy * w;
      continue;
    }
    const o = node * 4;
    for (let q = 0; q < 4; q++) if (ch[o + q] >= 0) stack[top++] = ch[o + q];
  }
  vel[i * 2] += vx; vel[i * 2 + 1] += vy;
}

function step(): void {
  build();
  for (let i = 0; i < n; i++) repel(i);
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e], b = edges[e + 1];
    let dx = pos[b * 2] + vel[b * 2] - pos[a * 2] - vel[a * 2];
    let dy = pos[b * 2 + 1] + vel[b * 2 + 1] - pos[a * 2 + 1] - vel[a * 2 + 1];
    if (dx === 0 && dy === 0) { dx = 0.01; dy = 0.01; }
    const d = Math.sqrt(dx * dx + dy * dy);
    const strength = 1 / Math.min(deg[a], deg[b]);
    const f = ((d - LINK) / d) * alpha * strength * 0.9;
    const bias = deg[a] / (deg[a] + deg[b]);
    vel[b * 2] -= dx * f * bias; vel[b * 2 + 1] -= dy * f * bias;
    vel[a * 2] += dx * f * (1 - bias); vel[a * 2 + 1] += dy * f * (1 - bias);
  }
  for (let i = 0; i < n; i++) {
    vel[i * 2] -= pos[i * 2] * GRAVITY * alpha;
    vel[i * 2 + 1] -= pos[i * 2 + 1] * GRAVITY * alpha;
    if (pinned[i]) { vel[i * 2] = 0; vel[i * 2 + 1] = 0; continue; }
    vel[i * 2] *= DAMP; vel[i * 2 + 1] *= DAMP;
    pos[i * 2] += vel[i * 2]; pos[i * 2 + 1] += vel[i * 2 + 1];
  }
  alpha *= ALPHA_DECAY;
}

function post(done: boolean): void {
  const copy = pos.slice();
  (self as unknown as { postMessage(m: LayoutOut, t: Transferable[]): void }).postMessage({ type: 'tick', pos: copy, alpha, done }, [copy.buffer]);
}

function run(): void {
  timer = 0;
  const end = performance.now() + SLICE_MS;
  while (alpha > ALPHA_MIN && performance.now() < end) step();
  const done = alpha <= ALPHA_MIN;
  post(done);
  if (!done) timer = self.setTimeout(run, 0);
}

function kick(): void {
  if (!timer && alpha > ALPHA_MIN) timer = self.setTimeout(run, 0);
}

self.onmessage = (ev: MessageEvent<LayoutIn>) => {
  const m = ev.data;
  if (m.type === 'init') {
    self.clearTimeout(timer);
    timer = 0;
    n = m.n;
    pos = new Float32Array(m.pos);
    vel = new Float32Array(n * 2);
    edges = new Int32Array(m.edges);
    deg = new Int32Array(n).fill(1);
    for (let e = 0; e < edges.length; e++) deg[edges[e]]++;
    pinned = new Uint8Array(n);
    alpha = m.alpha;
    allocTree();
    if (n === 0) { post(true); return; }
    kick();
  } else if (m.type === 'pin') {
    pinned[m.i] = 1;
    pos[m.i * 2] = m.x; pos[m.i * 2 + 1] = m.y;
  } else if (m.type === 'unpin') {
    pinned[m.i] = 0;
  } else if (m.type === 'heat') {
    alpha = Math.max(alpha, m.alpha);
    kick();
  } else if (m.type === 'stop') {
    self.clearTimeout(timer);
    timer = 0;
    alpha = 0;
  }
};
