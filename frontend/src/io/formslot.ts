import { request } from './api';
import { owner as ownerCall } from './window-token';

export interface FormslotCorpus { name: string; path: string; head: string }

export interface FormslotStatus {
  installed: boolean;
  binary: string | null;
  running: boolean;
  port: number | null;
  version: string | null;
  pid: number | null;
  corpora: FormslotCorpus[];
  workspaceCorpus: string | null;
  pluginInstalled: boolean | null;
  note: string;
}

export interface FormslotOnboard {
  binary: string | null;
  version: string | null;
  running: boolean;
  dataFolder: string;
  dataFolderExists: boolean;
  corpora: string[];
  workspace: string | null;
  indexed: boolean | null;
  connected: boolean | null;
}

export interface GateSlot { id: string; path: string; line: number }
export type GateChoice = 'use' | 'adapt' | 'write';

export interface Gate {
  id: string;
  session: string;
  tool: string;
  path: string;
  message: string;
  slots: GateSlot[];
  tokens: number;
  created: number | string;
  choice: string | null;
}

export interface DriftFile { path: string; slot: string; state: string }
export interface DriftReport { ok: boolean; output: string; files: DriftFile[] }
export interface ActionResult { ok: boolean; output: string }
export type InstallMode = 'warn' | 'deny';

export interface SlotHit {
  kind: string;
  id: string;
  corpus?: string;
  path?: string;
  lines?: number[] | string | null;
  title?: string;
  status?: string;
  summary?: string;
  unit_kind?: string;
  qualified?: string;
}

export interface SlotFile { path: string; sha256?: string; role?: string }
export interface SlotCopy { repo?: string; path: string; qualified?: string; lines?: number[]; relation?: string; score?: number }
export interface SlotEvent { at?: string; kind?: string; actor?: string; note?: string }

export interface SlotDetail {
  id: string;
  status?: string;
  updatedAt?: string;
  title?: string;
  summary?: string;
  version?: string | number;
  contentHash?: string;
  files?: SlotFile[];
  events?: SlotEvent[];
  copies?: SlotCopy[];
}

export type FormslotPhase = 'unknown' | 'unreachable' | 'missing' | 'off' | 'starting' | 'running';

export class FormslotError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'FormslotError';
  }
}

const PREFIX = /^(\d{3}) ([\s\S]*)$/;

const asError = (err: unknown): FormslotError => {
  if (err instanceof FormslotError) return err;
  const text = err instanceof Error ? err.message : String(err);
  const m = PREFIX.exec(text);
  return m ? new FormslotError(m[2], Number(m[1])) : new FormslotError(text, 0);
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (err) {
    throw asError(err);
  }
}

async function owner<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await ownerCall<T>(path, init);
  } catch (err) {
    throw asError(err);
  }
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });

interface McpContent { type?: string; text?: string }
interface McpReply {
  result?: { content?: McpContent[]; structuredContent?: unknown; isError?: boolean };
  error?: { code?: number; message?: string };
}

let rpcId = 0;

async function tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const reply = await owner<McpReply>('/api/formslot/mcp', post({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }));
  if (reply.error) throw new FormslotError(reply.error.message ?? 'formslot error', 0);
  const r = reply.result;
  if (!r) throw new FormslotError('formslot answered without a result', 0);
  const text = (r.content ?? []).map((c) => c.text ?? '').join('\n').trim();
  if (r.isError) throw new FormslotError(text || 'formslot error', 0);
  if (r.structuredContent !== undefined && r.structuredContent !== null) return r.structuredContent as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FormslotError(text || 'formslot answered without data', 0);
  }
}

export const formslot = {
  status: (): Promise<FormslotStatus> => call<FormslotStatus>('/api/formslot/status'),
  onboard: (): Promise<FormslotOnboard> => owner<FormslotOnboard>('/api/formslot/onboard'),
  start: (): Promise<FormslotStatus> => owner<FormslotStatus>('/api/formslot/start', post()),
  index: (path?: string): Promise<ActionResult> => owner<ActionResult>('/api/formslot/index', post(path ? { path } : {})),
  install: (mode: InstallMode): Promise<ActionResult> => owner<ActionResult>('/api/formslot/install', post({ mode })),
  confirm: (id: string): Promise<ActionResult> => owner<ActionResult>('/api/formslot/confirm', post({ id })),
  drift: (): Promise<DriftReport> => owner<DriftReport>('/api/formslot/drift'),
  find: (query: string, limit = 12): Promise<{ hits: SlotHit[] }> => tool<{ hits: SlotHit[] }>('slot_find', { query, limit, response_format: 'concise' }),
  get: (id: string): Promise<SlotDetail> => tool<SlotDetail>('slot_get', { id }),
  similar: (target: string, limit = 10): Promise<{ similar: SlotCopy[] }> => tool<{ similar: SlotCopy[] }>('slot_similar', { target, limit }),
  usages: (target: string, limit = 25): Promise<{ usages: Array<Record<string, unknown>>; mode?: string }> => tool('slot_usages', { target, limit }),
  slotStatus: (): Promise<Record<string, unknown>> => tool<Record<string, unknown>>('slot_status', {}),
};

export const gates = {
  list: (): Promise<Gate[]> => call<{ gates: Gate[] }>('/api/gates').then((r) => r.gates),
  answer: (id: string, choice: GateChoice): Promise<unknown> => owner<unknown>(`/api/gates/${encodeURIComponent(id)}/answer`, post({ choice })),
};

export const isGate = (v: unknown): v is Gate => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.session === 'string';
};

export const asGate = (raw: unknown): Gate | null => {
  const inner = raw && typeof raw === 'object' && 'gate' in raw ? (raw as { gate: unknown }).gate : raw;
  if (!isGate(inner)) return null;
  const o = inner as Gate;
  return {
    id: o.id,
    session: o.session,
    tool: typeof o.tool === 'string' ? o.tool : '',
    path: typeof o.path === 'string' ? o.path : '',
    message: typeof o.message === 'string' ? o.message : '',
    slots: Array.isArray(o.slots)
      ? o.slots.filter((s) => s && typeof s.id === 'string' && typeof s.path === 'string').map((s) => ({ id: s.id, path: s.path, line: typeof s.line === 'number' && s.line >= 0 ? s.line : 0 }))
      : [],
    tokens: typeof o.tokens === 'number' ? o.tokens : 0,
    created: o.created ?? 0,
    choice: typeof o.choice === 'string' ? o.choice : null,
  };
};

const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const compact = (n: number): string => (n < 1000 ? String(Math.max(0, Math.round(n))) : compactFormat.format(n));

type StateEvent = 'status' | 'drift' | 'active';

const POLL_MS = 5000;
const DRIFT_MAX_AGE_MS = 20000;
export const FORMSLOT_OPEN = 'formsubstrate:formslot-open';
export const SESSION_SELECTED = 'formsubstrate:session-selected';

class FormslotState {
  private current: FormslotStatus | null = null;
  private failure = '';
  private starting = false;
  private startInflight: Promise<void> | null = null;
  private driftGen = 0;
  private inflight: Promise<FormslotStatus | null> | null = null;
  private timer = 0;
  private enabled = true;
  private driftMap = new Map<string, DriftFile>();
  private driftAt = 0;
  private driftInflight: Promise<void> | null = null;
  private selected: string | null = null;
  private indexed = 0;
  private readonly listeners: Record<StateEvent, Set<() => void>> = { status: new Set(), drift: new Set(), active: new Set() };

  on(event: StateEvent, fn: () => void): () => void {
    this.listeners[event].add(fn);
    return () => { this.listeners[event].delete(fn); };
  }

  private emit(event: StateEvent): void {
    for (const fn of Array.from(this.listeners[event])) fn();
  }

  get status(): FormslotStatus | null { return this.current; }
  get problem(): string { return this.failure; }
  get isEnabled(): boolean { return this.enabled; }
  get activeSession(): string | null { return this.selected; }
  get indexGen(): number { return this.indexed; }

  noteIndexed(): void {
    this.indexed++;
    this.emit('status');
  }

  get phase(): FormslotPhase {
    if (this.failure) return 'unreachable';
    const s = this.current;
    if (!s) return 'unknown';
    if (!s.installed) return 'missing';
    if (s.running) return 'running';
    return this.starting ? 'starting' : 'off';
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.emit('status');
    if (on) void this.refresh();
  }

  setActiveSession(id: string | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.emit('active');
  }

  begin(): void {
    if (this.timer) return;
    this.timer = window.setInterval(() => { if (!document.hidden && this.enabled) void this.refresh(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.enabled) void this.refresh(); });
    void this.refresh();
  }

  refresh(fresh = false): Promise<FormslotStatus | null> {
    if (this.inflight) return fresh ? this.inflight.then(() => this.refresh()) : this.inflight;
    this.inflight = formslot.status().then((s) => {
      this.current = s;
      this.failure = '';
      if (s.running) this.starting = false;
      return s;
    }).catch((err: unknown) => {
      this.failure = asError(err).message;
      return null;
    }).then((s) => {
      this.inflight = null;
      this.emit('status');
      return s;
    });
    return this.inflight;
  }

  start(): Promise<void> {
    if (this.startInflight) return this.startInflight;
    this.starting = true;
    this.emit('status');
    const run = (async () => {
      try {
        this.current = await formslot.start();
        this.failure = '';
      } catch (err) {
        throw asError(err);
      } finally {
        this.starting = false;
        this.startInflight = null;
        this.emit('status');
      }
    })();
    this.startInflight = run;
    return run;
  }

  driftFor(path: string): DriftFile | undefined { return this.driftMap.get(path); }
  get driftCount(): number { return this.driftMap.size; }
  get driftFiles(): DriftFile[] { return Array.from(this.driftMap.values()); }

  ensureDrift(force = false): Promise<void> {
    if (!this.enabled || !this.current?.installed) return Promise.resolve();
    if (this.driftInflight) return force ? this.driftInflight.then(() => this.ensureDrift(true)) : this.driftInflight;
    if (!force && Date.now() - this.driftAt < DRIFT_MAX_AGE_MS) return Promise.resolve();
    const gen = this.driftGen;
    const run: Promise<void> = formslot.drift().then((r) => {
      if (gen !== this.driftGen) return;
      const next = new Map<string, DriftFile>();
      for (const f of r.files ?? []) if (f && typeof f.path === 'string') next.set(f.path, f);
      this.driftMap = next;
    }).catch(() => {
      if (gen === this.driftGen) this.driftMap = new Map();
    }).then(() => {
      if (gen !== this.driftGen) return;
      this.driftAt = Date.now();
      this.driftInflight = null;
      this.emit('drift');
    });
    this.driftInflight = run;
    return run;
  }

  forgetDrift(): void {
    this.driftGen++;
    this.driftInflight = null;
    this.driftAt = 0;
    this.driftMap = new Map();
    this.emit('drift');
  }
}

export const formslotState = new FormslotState();
