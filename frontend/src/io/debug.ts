import { request } from './api';
import { trustQuery } from './trust';

export interface DebugCandidate { python: string; source: string; debugpy: string | null }

export interface DebugAdapter {
  id: string;
  label: string;
  available: boolean;
  python: string | null;
  adapterPython: string | null;
  debugpy: string | null;
  source: string | null;
  candidates: DebugCandidate[];
  install: string | null;
  note: string;
}

export interface DebugAdapters { root: string | null; adapters: DebugAdapter[] }

export interface DapEvent { event: string; body: Record<string, unknown> }

export interface LaunchConfig {
  program: string;
  args?: string[];
  cwd?: string;
  stopOnEntry?: boolean;
  justMyCode?: boolean;
}

export interface DapStackFrame { id: number; name: string; line: number; column: number; path: string }
export interface DapScope { name: string; variablesReference: number; expensive: boolean }
export interface DapVariable { name: string; value: string; type: string; variablesReference: number; evaluateName: string }

const WS_PATH = '/api/debug/ws';
const REQUEST_TIMEOUT_MS = 20000;
const OPEN_TIMEOUT_MS = 8000;
const CLOSE_CODES: Record<number, string> = { 4409: 'busy', 4404: 'unavailable' };

export function debugAdapters(): Promise<DebugAdapters> {
  return request<DebugAdapters>('/api/debug/adapters');
}

interface Pending { ok(body: unknown): void; fail(err: Error): void; timer: number }

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export class DapConnection {
  private ws: WebSocket | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly events = new Set<(e: DapEvent) => void>();
  private readonly closers = new Set<(reason: string) => void>();
  private closed = false;

  onEvent(fn: (e: DapEvent) => void): () => void {
    this.events.add(fn);
    return () => { this.events.delete(fn); };
  }

  onClose(fn: (reason: string) => void): () => void {
    this.closers.add(fn);
    return () => { this.closers.delete(fn); };
  }

  get isOpen(): boolean { return !this.closed && this.ws?.readyState === WebSocket.OPEN; }

  open(): Promise<void> {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try { ws = new WebSocket(`${scheme}://${location.host}${WS_PATH}${trustQuery('?')}`); } catch (err) { reject(err instanceof Error ? err : new Error(String(err))); return; }
      this.ws = ws;
      const timer = window.setTimeout(() => { reject(new Error('The engine did not answer')); this.close(); }, OPEN_TIMEOUT_MS);
      ws.onopen = () => { window.clearTimeout(timer); resolve(); };
      ws.onmessage = (e) => { if (typeof e.data === 'string') this.receive(e.data); };
      ws.onerror = () => { window.clearTimeout(timer); reject(new Error('The debug connection failed')); };
      ws.onclose = (e) => { window.clearTimeout(timer); this.finish(CLOSE_CODES[e.code] ?? 'closed'); };
    });
  }

  private receive(text: string): void {
    let msg: Record<string, unknown>;
    try { msg = asRecord(JSON.parse(text)); } catch { return; }
    if (msg.type === 'response') {
      const seq = Number(msg.request_seq);
      const p = this.pending.get(seq);
      if (!p) return;
      this.pending.delete(seq);
      window.clearTimeout(p.timer);
      if (msg.success === true) p.ok(msg.body ?? {});
      else p.fail(new Error(typeof msg.message === 'string' ? msg.message : 'The request failed'));
      return;
    }
    if (msg.type === 'event' && typeof msg.event === 'string') {
      const e: DapEvent = { event: msg.event, body: asRecord(msg.body) };
      for (const fn of Array.from(this.events)) fn(e);
    }
  }

  request<T = Record<string, unknown>>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((ok, fail) => {
      if (!this.isOpen || !this.ws) { fail(new Error('Not connected')); return; }
      const seq = ++this.seq;
      const timer = window.setTimeout(() => {
        if (this.pending.delete(seq)) fail(new Error(`${command} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(seq, { ok: (b) => ok(b as T), fail, timer });
      this.ws.send(JSON.stringify({ seq, type: 'request', command, arguments: args }));
    });
  }

  close(): void {
    const ws = this.ws;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    this.finish('closed');
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { window.clearTimeout(p.timer); p.fail(new Error('Disconnected')); }
    this.pending.clear();
    for (const fn of Array.from(this.closers)) fn(reason);
  }
}

export const frameOf = (raw: Record<string, unknown>): DapStackFrame => {
  const source = asRecord(raw.source);
  return {
    id: Number(raw.id),
    name: String(raw.name ?? ''),
    line: Number(raw.line ?? 0),
    column: Number(raw.column ?? 1),
    path: typeof source.path === 'string' ? source.path : '',
  };
};

export const variableOf = (raw: Record<string, unknown>): DapVariable => ({
  name: String(raw.name ?? ''),
  value: String(raw.value ?? ''),
  type: String(raw.type ?? ''),
  variablesReference: Number(raw.variablesReference ?? 0),
  evaluateName: String(raw.evaluateName ?? ''),
});

export const scopeOf = (raw: Record<string, unknown>): DapScope => ({
  name: String(raw.name ?? ''),
  variablesReference: Number(raw.variablesReference ?? 0),
  expensive: raw.expensive === true,
});
