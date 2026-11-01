import { request } from './api';

export type TerminalKind = 'shell' | 'claude';

export interface TerminalInfo {
  id: string;
  title: string;
  kind: TerminalKind;
  cwd: string;
  sessionId: string | null;
  alive: boolean;
  exitCode: number | null;
  created: number | string;
}

export interface CreateTerminal {
  kind: TerminalKind;
  cwd: string;
  title?: string;
  sessionId?: string;
  cols: number;
  rows: number;
}

export interface ChannelHandlers {
  data(bytes: Uint8Array, written: () => void): void;
  exit(code: number): void;
  title(title: string): void;
  error(message: string): void;
}

export const ACK_EVERY = 32 * 1024;
export const BACKOFF_FIRST_MS = 250;
export const BACKOFF_CAP_MS = 5000;

const FRAME_OUTPUT = 0x01;
const ID_LEN = 16;
const HEADER_LEN = 1 + ID_LEN + 8;
const WS_PATH = '/api/terminals/ws';

export async function listTerminals(): Promise<TerminalInfo[]> {
  const res = await request<{ terminals: TerminalInfo[] }>('/api/terminals');
  return res.terminals;
}

export function createTerminal(body: CreateTerminal): Promise<TerminalInfo> {
  return request<TerminalInfo>('/api/terminals', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteTerminal(id: string): Promise<void> {
  return request<void>(`/api/terminals/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

interface Channel {
  id: string;
  handlers: ChannelHandlers;
  start: number | null;
  next: number;
  got: boolean;
  unacked: number;
  epoch: number;
  exited: boolean;
  cols: number;
  rows: number;
}

export function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_FIRST_MS * 2 ** attempt);
}

export class TerminalSocket {
  private ws: WebSocket | null = null;
  private readonly channels = new Map<string, Channel>();
  private readonly listeners = new Set<(up: boolean) => void>();
  private attempt = 0;
  private timer = 0;
  private up = false;

  get connected(): boolean { return this.up; }

  get waiting(): boolean { return this.channels.size > 0 && !this.up; }

  onState(fn: (up: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  offsetOf(id: string): number | null {
    const c = this.channels.get(id);
    return c && c.got ? c.next : null;
  }

  attach(id: string, handlers: ChannelHandlers, from: number | null): void {
    this.channels.set(id, { id, handlers, start: from, next: from ?? 0, got: false, unacked: 0, epoch: 0, exited: false, cols: 0, rows: 0 });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.sendAttach(this.channels.get(id) as Channel);
    else this.ensure();
  }

  detach(id: string): void {
    if (!this.channels.delete(id)) return;
    this.send({ t: 'detach', id });
    if (this.channels.size === 0) this.shutdown();
  }

  input(id: string, data: string): void {
    this.send({ t: 'input', id, data });
  }

  resize(id: string, cols: number, rows: number): void {
    const c = this.channels.get(id);
    if (c) { c.cols = cols; c.rows = rows; }
    this.send({ t: 'resize', id, cols, rows });
  }

  private ensure(): void {
    if (this.ws || this.timer) return;
    this.connect();
  }

  private connect(): void {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${scheme}://${location.host}${WS_PATH}`);
    } catch {
      this.schedule();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.setUp(true);
      for (const c of this.channels.values()) if (!c.exited) this.sendAttach(c);
    });
    ws.addEventListener('message', (e) => { if (this.ws === ws) this.onMessage(e.data); });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setUp(false);
      if (this.channels.size > 0) this.schedule();
    });
    ws.addEventListener('error', () => undefined);
  }

  private schedule(): void {
    if (this.timer) return;
    const wait = backoffDelay(this.attempt++);
    this.timer = window.setTimeout(() => { this.timer = 0; if (this.channels.size > 0) this.connect(); }, wait);
  }

  private shutdown(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.attempt = 0;
    const ws = this.ws;
    this.ws = null;
    this.setUp(false);
    if (ws) ws.close();
  }

  private setUp(up: boolean): void {
    if (this.up === up) return;
    this.up = up;
    for (const fn of this.listeners) fn(up);
  }

  private sendAttach(c: Channel): void {
    c.unacked = 0;
    c.epoch++;
    this.send({ t: 'attach', id: c.id, from: c.got ? c.next : c.start });
    if (c.cols > 0 && c.rows > 0) this.send({ t: 'resize', id: c.id, cols: c.cols, rows: c.rows });
  }

  private send(msg: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private onMessage(data: unknown): void {
    if (data instanceof ArrayBuffer) { this.onOutput(data); return; }
    if (typeof data !== 'string') return;
    let msg: { t?: string; id?: string; code?: number; title?: string; message?: string };
    try { msg = JSON.parse(data) as typeof msg; } catch { return; }
    const c = msg.id ? this.channels.get(msg.id) : undefined;
    if (!c) return;
    if (msg.t === 'exit') { c.exited = true; c.handlers.exit(typeof msg.code === 'number' ? msg.code : 0); }
    else if (msg.t === 'title' && typeof msg.title === 'string') c.handlers.title(msg.title);
    else if (msg.t === 'error') c.handlers.error(typeof msg.message === 'string' ? msg.message : '');
  }

  private onOutput(buf: ArrayBuffer): void {
    if (buf.byteLength <= HEADER_LEN) return;
    const view = new DataView(buf);
    if (view.getUint8(0) !== FRAME_OUTPUT) return;
    let id = '';
    for (let i = 0; i < ID_LEN; i++) id += String.fromCharCode(view.getUint8(1 + i));
    const c = this.channels.get(id);
    if (!c) return;
    const seq = Number(view.getBigUint64(1 + ID_LEN));
    let bytes = new Uint8Array(buf, HEADER_LEN);
    let begin = seq;
    if (c.got && seq < c.next) {
      const skip = c.next - seq;
      if (skip >= bytes.length) return;
      bytes = bytes.subarray(skip);
      begin = c.next;
    }
    c.got = true;
    c.next = begin + bytes.length;
    const size = bytes.length, epoch = c.epoch;
    c.handlers.data(bytes, () => {
      if (epoch !== c.epoch) return;
      c.unacked += size;
      if (c.unacked < ACK_EVERY) return;
      const n = c.unacked;
      c.unacked = 0;
      this.send({ t: 'ack', id: c.id, bytes: n });
    });
  }
}

export const terminalSocket = new TerminalSocket();
