import { request } from './api';
import { TRUST_EVENT, trustQuery } from './trust';

export type LspLang = 'typescript' | 'python';

export interface LspCandidate {
  name: string;
  kind: string;
  found: boolean;
  path: string | null;
  version: string | null;
  usable: boolean;
  note: string;
}

export interface LspServerInfo {
  lang: LspLang;
  label: string;
  exts: string[];
  install: string[];
  found: boolean;
  active: { name: string; path: string; kind: string; version: string | null } | null;
  candidates: LspCandidate[];
  notes: string[];
}

export interface LspServers {
  root: string | null;
  running: number;
  servers: LspServerInfo[];
}

export function lspServers(): Promise<LspServers> {
  return request<LspServers>('/api/lsp/servers');
}

export function lspSocketUrl(lang: LspLang): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/api/lsp/ws?lang=${lang}${trustQuery('&')}`;
}

export interface WorkspaceSymbolHit { name: string; kind: number; container: string; path: string; line: number; col: number }
export type SymbolState = 'ok' | 'warming' | 'unavailable' | 'busy' | 'failed';
export interface SymbolOutcome { lang: LspLang; state: SymbolState; hits: WorkspaceSymbolHit[] }
export interface WarmFile { path: string; text: string; languageId: string }
export interface SymbolSearch { root: string; signal: AbortSignal; warm: (lang: LspLang) => Promise<WarmFile | null> }

interface RawWorkspaceSymbol { name?: unknown; kind?: unknown; containerName?: unknown; location?: { uri?: unknown; range?: { start?: { line?: number; character?: number } } } }
interface Wait { resolve: (value: unknown) => void; reject: (error: Error) => void }

const LANG_LIST: LspLang[] = ['typescript', 'python'];
const INIT_MS = 15000;
const ASK_MS = 8000;
const PARK_MS = 60000;
const FAIL_MS = 4000;
const LIST_MS = 20000;
const YOUNG_MS = 8000;
const RAW_CAP = 400;
const BUSY_CLOSE = 4409;
const SKIP_PATH = /(^|\/)(node_modules|site-packages|__pycache__)\//;

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');
export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

const decoded = (s: string): string => {
  try { return decodeURIComponent(s); } catch { return s; }
};

const rootUriOf = (abs: string): string => {
  const p = abs.replace(/\\/g, '/');
  const lead = p.startsWith('/') ? '' : '/';
  return `file://${lead}${p.split('/').map((s) => (/^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/')}`;
};

const until = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => new Promise<T>((resolve, reject) => {
  if (signal.aborted) { reject(abortError()); return; }
  const stop = (): void => reject(abortError());
  signal.addEventListener('abort', stop, { once: true });
  promise.then((v) => { signal.removeEventListener('abort', stop); resolve(v); }, (e: unknown) => { signal.removeEventListener('abort', stop); reject(e instanceof Error ? e : new Error(String(e))); });
});

class SymbolSession {
  verdict: SymbolState = 'ok';
  readyAt = 0;
  private alive = true;
  private readonly socket: WebSocket;
  private readonly waits = new Map<number, Wait>();
  private readonly started: Promise<void>;
  private settle: { ok: () => void; bad: (e: Error) => void } = { ok: () => undefined, bad: () => undefined };
  private seq = 0;
  private park = 0;
  private warmed: Promise<void> | null = null;

  constructor(readonly lang: LspLang, readonly root: string, private readonly rootUri: string, private readonly gone: (s: SymbolSession) => void) {
    this.started = new Promise<void>((ok, bad) => { this.settle = { ok, bad }; });
    this.started.catch(() => undefined);
    this.socket = new WebSocket(lspSocketUrl(lang));
    this.socket.addEventListener('open', () => this.onOpen());
    this.socket.addEventListener('message', (e) => this.onMessage(String(e.data)));
    this.socket.addEventListener('close', (e) => { if (this.alive) { this.verdict = e.code === BUSY_CLOSE ? 'busy' : this.verdict === 'ok' ? 'failed' : this.verdict; this.die(new Error('closed')); } });
    this.socket.addEventListener('error', () => undefined);
    this.touch();
  }

  private send(msg: Record<string, unknown>): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ jsonrpc: '2.0', ...msg }));
  }

  private onOpen(): void {
    const caps = { workspace: { symbol: { dynamicRegistration: false } }, textDocument: { synchronization: { dynamicRegistration: false } } };
    this.ask('initialize', { processId: null, rootUri: this.rootUri, workspaceFolders: [{ uri: this.rootUri, name: 'workspace' }], capabilities: caps }, INIT_MS).then(() => {
      this.send({ method: 'initialized', params: {} });
      this.readyAt = Date.now();
      this.settle.ok();
    }, (e: unknown) => {
      if (this.verdict === 'ok') this.verdict = 'failed';
      this.die(e instanceof Error ? e : new Error(String(e)));
    });
  }

  private onMessage(data: string): void {
    let msg: { id?: unknown; method?: unknown; result?: unknown; error?: { message?: string } };
    try { msg = JSON.parse(data) as typeof msg; } catch { return; }
    if (typeof msg.method === 'string') {
      if (msg.method === 'formsubstrate/serverUnavailable') { this.verdict = 'unavailable'; this.die(new Error('unavailable')); }
      return;
    }
    const wait = typeof msg.id === 'number' ? this.waits.get(msg.id) : undefined;
    if (!wait) return;
    if (msg.error) wait.reject(new Error(msg.error.message ?? 'request failed'));
    else wait.resolve(msg.result);
  }

  private ask(method: string, params: unknown, ms: number, signal?: AbortSignal): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) { reject(abortError()); return; }
      const id = ++this.seq;
      let timer = 0;
      const onAbort = (): void => { finish(); this.send({ method: '$/cancelRequest', params: { id } }); reject(abortError()); };
      const finish = (): void => { window.clearTimeout(timer); signal?.removeEventListener('abort', onAbort); this.waits.delete(id); };
      timer = window.setTimeout(() => { finish(); this.send({ method: '$/cancelRequest', params: { id } }); reject(new Error('timeout')); }, ms);
      this.waits.set(id, { resolve: (v) => { finish(); resolve(v); }, reject: (e) => { finish(); reject(e); } });
      signal?.addEventListener('abort', onAbort, { once: true });
      this.send({ id, method, params });
    });
  }

  private touch(): void {
    window.clearTimeout(this.park);
    this.park = window.setTimeout(() => this.die(new Error('parked')), PARK_MS);
  }

  private die(error: Error): void {
    if (!this.alive) return;
    this.alive = false;
    window.clearTimeout(this.park);
    this.settle.bad(error);
    for (const wait of Array.from(this.waits.values())) wait.reject(error);
    this.waits.clear();
    try { this.socket.close(); } catch { this.waits.clear(); }
    this.gone(this);
  }

  close(): void {
    this.die(new Error('closed'));
  }

  pathOf(uri: string): string | null {
    const flat = decoded(uri);
    const base = `${decoded(this.rootUri)}/`;
    const drive = /^file:\/\/\/[a-z]:/i.test(base);
    const hit = drive ? flat.toLowerCase().startsWith(base.toLowerCase()) : flat.startsWith(base);
    return hit ? flat.slice(base.length) : null;
  }

  private warm(load: () => Promise<WarmFile | null>): Promise<void> {
    this.warmed ??= load().then((file) => {
      if (!file || !this.alive) return;
      const uri = `${this.rootUri}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
      this.send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: file.languageId, version: 1, text: file.text } } });
    }).catch(() => undefined);
    return this.warmed;
  }

  async search(text: string, signal: AbortSignal, load: () => Promise<WarmFile | null>): Promise<WorkspaceSymbolHit[]> {
    this.touch();
    await until(this.started, signal);
    if (this.lang === 'typescript') await until(this.warm(load), signal);
    const raw = await this.ask('workspace/symbol', { query: text }, ASK_MS, signal);
    this.touch();
    const out: WorkspaceSymbolHit[] = [];
    if (!Array.isArray(raw)) return out;
    for (const item of (raw as RawWorkspaceSymbol[]).slice(0, RAW_CAP)) {
      const uri = item?.location?.uri;
      if (typeof item?.name !== 'string' || typeof uri !== 'string') continue;
      const path = this.pathOf(uri);
      if (path === null || SKIP_PATH.test(path)) continue;
      const at = item.location?.range?.start;
      out.push({ name: item.name, kind: typeof item.kind === 'number' ? item.kind : 0, container: typeof item.containerName === 'string' ? item.containerName : '', path, line: (at?.line ?? 0) + 1, col: (at?.character ?? 0) + 1 });
    }
    return out;
  }
}

class SymbolHub {
  private readonly sessions = new Map<LspLang, SymbolSession>();
  private readonly lost = new Map<LspLang, { state: SymbolState; at: number }>();
  private listed: { root: string; at: number; value: Promise<LspServers> } | null = null;
  private root = '';

  constructor() {
    window.addEventListener(TRUST_EVENT, () => this.reset());
  }

  reset(): void {
    for (const s of Array.from(this.sessions.values())) s.close();
    this.sessions.clear();
    this.lost.clear();
    this.listed = null;
  }

  private servers(root: string): Promise<LspServers> {
    const now = Date.now();
    if (this.listed && this.listed.root === root && now - this.listed.at < LIST_MS) return this.listed.value;
    const value = lspServers();
    this.listed = { root, at: now, value };
    value.catch(() => { if (this.listed?.value === value) this.listed = null; });
    return value;
  }

  private drop(s: SymbolSession): void {
    if (this.sessions.get(s.lang) === s) this.sessions.delete(s.lang);
    if (s.verdict !== 'ok') this.lost.set(s.lang, { state: s.verdict, at: Date.now() });
  }

  private async one(lang: LspLang, text: string, ctx: SymbolSearch, usable: boolean): Promise<SymbolOutcome> {
    if (!usable) return { lang, state: 'unavailable', hits: [] };
    const lost = this.lost.get(lang);
    if (lost && Date.now() - lost.at < FAIL_MS) return { lang, state: lost.state, hits: [] };
    let s = this.sessions.get(lang);
    if (!s) {
      s = new SymbolSession(lang, ctx.root, rootUriOf(ctx.root), (x) => this.drop(x));
      this.sessions.set(lang, s);
    }
    try {
      const hits = await s.search(text, ctx.signal, () => ctx.warm(lang));
      return { lang, state: hits.length === 0 && Date.now() - s.readyAt < YOUNG_MS ? 'warming' : 'ok', hits };
    } catch (e) {
      if (isAbort(e)) throw e;
      return { lang, state: s.verdict === 'ok' ? 'failed' : s.verdict, hits: [] };
    }
  }

  async search(text: string, ctx: SymbolSearch): Promise<SymbolOutcome[]> {
    if (this.root !== ctx.root) { this.reset(); this.root = ctx.root; }
    let found: LspServers | null = null;
    try { found = await until(this.servers(ctx.root), ctx.signal); } catch (e) { if (isAbort(e)) throw e; }
    return Promise.all(LANG_LIST.map((lang) => this.one(lang, text, ctx, !found || found.servers.some((s) => s.lang === lang && s.found))));
  }
}

export const symbolHub = new SymbolHub();
