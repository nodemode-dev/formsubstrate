import { request } from './api';
import type { HomeSession } from '../ui/home';
import type { SessionsSummary } from '../ui/workspace-store';

export type SessionMode = 'interactive' | 'headless';
export type SessionState = 'working' | 'needs-input' | 'done' | 'failed' | 'stopped';
export type NoticeKind = 'needs-input' | 'completed' | 'failed';

export interface Session {
  id: string;
  title: string;
  repo: string;
  branch: string;
  worktree: string;
  mode: SessionMode;
  state: SessionState;
  terminalId: string | null;
  claudeSessionId: string | null;
  created: number | string;
  updated: number | string;
  lastMessage: string | null;
  notes?: string[];
}

export interface SessionNotice { sessionId: string; kind: NoticeKind; text: string }
export interface NewSessionBody { title: string; mode: SessionMode; prompt?: string; base?: string }
export interface Skill { name: string; description: string; path: string; source: 'project' | 'user' }

export interface TranscriptLine {
  seq: number;
  sessionId: string;
  kind: 'message' | 'state' | 'notice';
  text: string;
  at: number;
}

export interface SessionsEvents {
  sessions: readonly Session[];
  notice: SessionNotice;
  line: TranscriptLine;
  connection: boolean;
}

type Listener<K extends keyof SessionsEvents> = (value: SessionsEvents[K]) => void;

export const STATE_ORDER: readonly SessionState[] = ['needs-input', 'working', 'done', 'failed', 'stopped'];

const EVENTS_URL = '/api/sessions/events';
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10000;
const TRANSCRIPT_MAX = 300;

export const stamp = (v: number | string): number => {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const n = Date.parse(v);
  return Number.isNaN(n) ? 0 : n;
};

export function elapsedLabel(s: Session, now = Date.now()): string {
  const end = s.state === 'working' || s.state === 'needs-input' ? now : stamp(s.updated);
  const secs = Math.max(0, Math.floor((end - stamp(s.created)) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ${String(secs % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

const isSession = (v: unknown): v is Session => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.state === 'string' && typeof o.title === 'string';
};

const json = (method: string, body?: unknown): RequestInit => (body === undefined ? { method } : { method, body: JSON.stringify(body) });

export class SessionsClient {
  private readonly byId = new Map<string, Session>();
  private readonly lines = new Map<string, TranscriptLine[]>();
  private readonly listeners: { [K in keyof SessionsEvents]: Set<Listener<K>> } = {
    sessions: new Set(), notice: new Set(), line: new Set(), connection: new Set(),
  };
  private source: EventSource | null = null;
  private retry = 0;
  private retryMs = RETRY_MIN_MS;
  private wanted = false;
  private online = false;
  private seq = 0;
  private refreshSeq = 0;
  private sorted: readonly Session[] = [];

  on<K extends keyof SessionsEvents>(event: K, fn: Listener<K>): () => void {
    (this.listeners[event] as Set<Listener<K>>).add(fn);
    return () => { (this.listeners[event] as Set<Listener<K>>).delete(fn); };
  }

  private emit<K extends keyof SessionsEvents>(event: K, value: SessionsEvents[K]): void {
    for (const fn of Array.from(this.listeners[event] as Set<Listener<K>>)) fn(value);
  }

  get list(): readonly Session[] { return this.sorted; }
  get connected(): boolean { return this.online; }
  get(id: string): Session | undefined { return this.byId.get(id); }
  transcript(id: string): readonly TranscriptLine[] { return this.lines.get(id) ?? []; }

  summary(): SessionsSummary {
    let working = 0, needsInput = 0;
    for (const s of this.sorted) {
      if (s.state === 'working') working++;
      else if (s.state === 'needs-input') needsInput++;
    }
    return { working, needsInput };
  }

  homeList(): HomeSession[] {
    const now = Date.now();
    return this.sorted.map((s) => ({
      id: s.id,
      title: s.title,
      repo: s.repo,
      branch: s.branch,
      state: s.state === 'working' || s.state === 'needs-input' ? s.state : 'done',
      elapsed: s.state === 'failed' || s.state === 'stopped' ? `${s.state} ${elapsedLabel(s, now)}` : elapsedLabel(s, now),
    }));
  }

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.connect();
  }

  stop(): void {
    this.wanted = false;
    window.clearTimeout(this.retry);
    this.source?.close();
    this.source = null;
    this.setOnline(false);
  }

  async refresh(): Promise<void> {
    const mine = ++this.refreshSeq;
    const before = new Set(this.byId.keys());
    const reply = await request<{ sessions: Session[] }>('/api/sessions');
    if (mine !== this.refreshSeq) return;
    const seen = new Set<string>();
    for (const s of reply.sessions) {
      if (!isSession(s)) continue;
      seen.add(s.id);
      const have = this.byId.get(s.id);
      if (!have && before.has(s.id)) continue;
      if (have && stamp(have.updated) > stamp(s.updated)) continue;
      this.merge(s, false);
    }
    for (const id of before) if (!seen.has(id) && this.byId.has(id)) { this.byId.delete(id); this.lines.delete(id); }
    this.publish();
  }

  async create(body: NewSessionBody): Promise<Session> {
    const s = await request<Session>('/api/sessions', json('POST', body));
    this.merge(s, true);
    this.publish();
    return s;
  }

  async resume(id: string): Promise<Session> {
    const s = await request<Session>(`/api/sessions/${encodeURIComponent(id)}/resume`, json('POST'));
    this.merge(s, true);
    this.publish();
    return s;
  }

  async stopSession(id: string): Promise<Session> {
    const s = await request<Session>(`/api/sessions/${encodeURIComponent(id)}/stop`, json('POST'));
    this.merge(s, true);
    this.publish();
    return s;
  }

  async remove(id: string, force = false): Promise<void> {
    await request<void>(`/api/sessions/${encodeURIComponent(id)}?removeWorktree=1${force ? '&force=1' : ''}`, json('DELETE'));
    this.byId.delete(id);
    this.lines.delete(id);
    this.publish();
  }

  skills(): Promise<Skill[]> {
    return request<{ skills: Skill[] }>('/api/skills').then((r) => r.skills);
  }

  private connect(): void {
    if (!this.wanted || this.source || typeof EventSource === 'undefined') return;
    const source = new EventSource(EVENTS_URL);
    this.source = source;
    source.addEventListener('open', () => {
      this.retryMs = RETRY_MIN_MS;
      this.setOnline(true);
      void this.refresh().catch(() => undefined);
    });
    source.addEventListener('session', (e) => {
      try {
        const s: unknown = JSON.parse((e as MessageEvent<string>).data);
        if (!isSession(s)) return;
        this.merge(s, true);
        this.publish();
      } catch { return; }
    });
    source.addEventListener('notice', (e) => {
      try {
        const n = JSON.parse((e as MessageEvent<string>).data) as SessionNotice;
        if (!n || typeof n.sessionId !== 'string') return;
        this.addLine(n.sessionId, 'notice', n.text);
        this.emit('notice', n);
      } catch { return; }
    });
    source.addEventListener('error', () => {
      if (this.source !== source) return;
      source.close();
      this.source = null;
      this.setOnline(false);
      if (!this.wanted) return;
      window.clearTimeout(this.retry);
      this.retry = window.setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
    });
  }

  private setOnline(on: boolean): void {
    if (this.online === on) return;
    this.online = on;
    this.emit('connection', on);
  }

  private merge(next: Session, announce: boolean): void {
    const prev = this.byId.get(next.id);
    this.byId.set(next.id, next);
    if (!prev) {
      if (next.lastMessage) this.addLine(next.id, 'message', next.lastMessage);
      return;
    }
    if (announce && prev.state !== next.state) this.addLine(next.id, 'state', next.state);
    if (next.lastMessage && next.lastMessage !== prev.lastMessage) this.addLine(next.id, 'message', next.lastMessage);
  }

  private addLine(sessionId: string, kind: TranscriptLine['kind'], text: string): void {
    const list = this.lines.get(sessionId) ?? [];
    if (kind === 'notice' && list[list.length - 1]?.text === text) return;
    const line: TranscriptLine = { seq: ++this.seq, sessionId, kind, text, at: Date.now() };
    list.push(line);
    if (list.length > TRANSCRIPT_MAX) list.shift();
    this.lines.set(sessionId, list);
    this.emit('line', line);
  }

  private publish(): void {
    this.sorted = Array.from(this.byId.values()).sort((a, b) => stamp(b.updated) - stamp(a.updated) || (a.id < b.id ? -1 : 1));
    this.emit('sessions', this.sorted);
  }
}

export const sessionsClient = new SessionsClient();
