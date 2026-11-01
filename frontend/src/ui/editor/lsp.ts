import { EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { LSPClient, LSPPlugin, languageServerExtensions, type Transport, type WorkspaceMapping } from '@codemirror/lsp-client';
import { lspServers, lspSocketUrl, type LspLang, type LspServers } from '../../io/lsp';
import { t, tn } from '../i18n';
import { toast } from '../toast';
import { SfWorkspace, type SfFile, type WorkspaceHost } from './lsp-workspace';

export type LspState = 'starting' | 'ready' | 'unavailable' | 'stopped';

export interface LspHost {
  root(): string | null;
  open(path: string, line?: number, col?: number): Promise<boolean>;
  transact(path: string, spec: TransactionSpec): void;
  read(path: string): Promise<string | null>;
  refresh(path: string): void;
  status(text: string): void;
  run(command: (view: EditorView) => boolean): boolean;
}

export interface Problem {
  path: string;
  line: number;
  col: number;
  severity: 1 | 2 | 3 | 4;
  message: string;
  source: string;
}

export interface OutlineItem {
  name: string;
  detail: string;
  kind: number;
  depth: number;
  line: number;
  col: number;
}

export interface LspStatus {
  lang: LspLang;
  state: LspState;
  name: string;
  version: string | null;
  error: string;
  install: string[];
}

interface RawPos { line: number; character: number }
interface RawRange { start: RawPos; end: RawPos }
interface RawDiagnostic { range: RawRange; severity?: number; message: string; source?: string; code?: string | number }
interface PullResult { kind: string; items?: RawDiagnostic[]; relatedDocuments?: Record<string, { kind: string; items?: RawDiagnostic[] }> }
interface RawSymbol {
  name: string;
  detail?: string;
  kind: number;
  range?: RawRange;
  selectionRange?: RawRange;
  location?: { uri: string; range: RawRange };
  children?: RawSymbol[];
}

type Topic = 'state' | 'diagnostics' | 'changed';

const LANG_OF_EXT: Record<string, { lang: LspLang; id: string }> = {
  ts: { lang: 'typescript', id: 'typescript' },
  mts: { lang: 'typescript', id: 'typescript' },
  cts: { lang: 'typescript', id: 'typescript' },
  tsx: { lang: 'typescript', id: 'typescriptreact' },
  js: { lang: 'typescript', id: 'javascript' },
  mjs: { lang: 'typescript', id: 'javascript' },
  cjs: { lang: 'typescript', id: 'javascript' },
  jsx: { lang: 'typescript', id: 'javascriptreact' },
  py: { lang: 'python', id: 'python' },
  pyi: { lang: 'python', id: 'python' },
};

const SEVERITY: Record<number, Diagnostic['severity']> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };
const REQUEST_MS = 20000;
const SYNC_MS = 300;
const PULL_RETRY_MS = 1600;
const IDLE_MS = 4000;
const TAG = /"method":\s*"subform\//;

const extOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const at = base.lastIndexOf('.');
  return at > 0 ? base.slice(at + 1).toLowerCase() : '';
};

const decoded = (s: string): string => {
  try { return decodeURIComponent(s); } catch { return s; }
};

const fileUri = (abs: string): string => {
  const p = abs.replace(/\\/g, '/');
  const lead = p.startsWith('/') ? '' : '/';
  return `file://${lead}${p.split('/').map((s) => (/^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/')}`;
};

const joinUri = (rootUri: string, rel: string): string => `${rootUri}/${rel.split('/').map(encodeURIComponent).join('/')}`;

const KEEP_TAGS = new Set(['p', 'pre', 'code', 'em', 'strong', 'b', 'i', 'ul', 'ol', 'li', 'a', 'br', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const DROP_TAGS = new Set(['script', 'style', 'svg', 'math', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'template', 'noscript', 'noembed', 'textarea', 'select', 'button', 'input', 'title', 'head', 'img', 'picture', 'video', 'audio', 'source', 'track', 'canvas', 'link', 'meta', 'base', 'xmp', 'plaintext']);
const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_CLASS = /^language-[A-Za-z0-9_+#-]{1,40}$/;

const copySafe = (from: Node, into: Node, out: Document): void => {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      into.appendChild(out.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const src = child as Element;
    const tag = src.localName.toLowerCase();
    if (DROP_TAGS.has(tag) || src.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
    if (!KEEP_TAGS.has(tag)) {
      copySafe(src, into, out);
      continue;
    }
    const dest = out.createElement(tag);
    if (tag === 'a') {
      const href = (src.getAttribute('href') ?? '').replace(/[\u0000- ]/g, '');
      if (SAFE_LINK.test(href)) {
        dest.setAttribute('href', href);
        dest.setAttribute('target', '_blank');
        dest.setAttribute('rel', 'noopener noreferrer');
      }
    } else if (tag === 'code') {
      const cls = src.getAttribute('class');
      if (cls && SAFE_CLASS.test(cls)) dest.setAttribute('class', cls);
    }
    copySafe(src, dest, out);
    into.appendChild(dest);
  }
};

const cleanHtml = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.implementation.createHTMLDocument('');
  copySafe(doc.body, out.body, out);
  return out.body.innerHTML;
};

let linksGuarded = false;
const guardLinks = (): void => {
  if (linksGuarded) return;
  linksGuarded = true;
  const stop = (e: Event): void => {
    const target = e.target;
    if (target instanceof Element && target.closest('.cm-tooltip a')) e.preventDefault();
  };
  document.addEventListener('click', stop, true);
  document.addEventListener('auxclick', stop, true);
};

const changedUris = (res: unknown): string[] => {
  const changes = (res as { changes?: Record<string, unknown> } | null)?.changes;
  return changes && typeof changes === 'object' ? Object.keys(changes) : [];
};

const clampPos = (doc: EditorState['doc'], pos: RawPos): number => {
  const ln = doc.line(Math.max(1, Math.min(pos.line + 1, doc.lines)));
  return Math.min(ln.from + Math.max(0, pos.character), ln.to);
};

const lspPhrases = (): Extension => EditorState.phrases.of({
  'New name': t('New name'),
  rename: t('Rename'),
  'Reference list': t('Reference list'),
  close: t('close'),
});

class Session {
  state: LspState = 'starting';
  name = '';
  version: string | null = null;
  error = '';
  install: string[] = [];
  readonly client: LSPClient;
  readonly workspace: SfWorkspace;
  readonly raw = new Map<string, RawDiagnostic[]>();
  private readonly socket: WebSocket;
  private readonly listeners = new Set<(value: string) => void>();
  private readonly pulls = new Map<string, number>();
  private disposed = false;

  constructor(readonly lang: LspLang, readonly rootUri: string, private readonly mgr: LspManager) {
    const self = this;
    this.client = new LSPClient({
      rootUri,
      timeout: REQUEST_MS,
      sanitizeHTML: cleanHtml,
      workspace: (c) => new SfWorkspace(c, mgr.workspaceHost(self)),
      notificationHandlers: {
        'window/logMessage': (_c, params: { message?: string }) => { console.debug('[lsp]', params.message); return true; },
        'textDocument/publishDiagnostics': (_c, params: { uri: string; version?: number; diagnostics: RawDiagnostic[] }) => this.onPush(params),
      },
      extensions: [...languageServerExtensions(), { editorExtension: mgr.watcher() }],
    });
    this.workspace = this.client.workspace as SfWorkspace;
    guardLinks();
    const request = this.client.request.bind(this.client) as (method: string, params: unknown, ...rest: unknown[]) => Promise<unknown>;
    (this.client as unknown as { request: typeof request }).request = (method, params, ...rest) => {
      const pending = request(method, params, ...rest);
      if (method !== 'textDocument/rename') return pending;
      return pending.then((res) => {
        const skipped = changedUris(res).filter((u) => !this.workspace.getFile(u)).length;
        if (skipped > 0) toast(tn(skipped, '{n} file was not changed because it is not open', '{n} files were not changed because they are not open'), 'error');
        return res;
      });
    };
    this.socket = new WebSocket(lspSocketUrl(lang));
    this.socket.addEventListener('open', () => this.onOpen());
    this.socket.addEventListener('message', (e) => this.onMessage(String(e.data)));
    this.socket.addEventListener('close', () => this.onClose());
    this.socket.addEventListener('error', () => undefined);
  }

  private transport(): Transport {
    return {
      send: (message) => { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(message); },
      subscribe: (h) => { this.listeners.add(h); },
      unsubscribe: (h) => { this.listeners.delete(h); },
    };
  }

  private onOpen(): void {
    if (this.disposed) return;
    this.client.connect(this.transport());
    this.client.initializing.then(() => {
      if (this.disposed) return;
      this.set('ready');
      for (const f of this.workspace.files) this.schedulePull(f.uri, 200, true);
    }, () => {
      if (this.disposed) return;
      this.error = t('The language server did not finish starting');
      this.set('stopped');
    });
  }

  private onMessage(data: string): void {
    if (TAG.test(data.slice(0, 160))) {
      this.onControl(data);
      return;
    }
    for (const h of Array.from(this.listeners)) h(data);
  }

  private onControl(data: string): void {
    let msg: { method?: string; params?: Record<string, unknown> };
    try { msg = JSON.parse(data) as typeof msg; } catch { return; }
    const p = msg.params ?? {};
    if (msg.method === 'subform/serverStarted') {
      this.name = String(p.name ?? '');
      this.version = typeof p.version === 'string' ? p.version : null;
      this.mgr.emit('state');
    } else if (msg.method === 'subform/serverUnavailable') {
      this.error = String(p.error ?? '');
      this.install = Array.isArray(p.install) ? p.install.map(String) : [];
      this.set('unavailable');
    }
  }

  private onClose(): void {
    if (this.disposed) return;
    for (const id of this.pulls.values()) window.clearTimeout(id);
    this.pulls.clear();
    if (this.state === 'unavailable') return;
    if (!this.error) this.error = t('The language server stopped');
    this.set('stopped');
  }

  private clearPulls(): void {
    for (const id of this.pulls.values()) window.clearTimeout(id);
    this.pulls.clear();
  }

  private set(state: LspState): void {
    if (this.state === state) return;
    this.state = state;
    if (state === 'unavailable' || state === 'stopped') this.clearPulls();
    this.mgr.emit('state');
    if (state === 'unavailable' || state === 'stopped') this.mgr.onLost(this);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.pulls.values()) window.clearTimeout(id);
    this.pulls.clear();
    try { this.client.disconnect(); } catch { this.listeners.clear(); }
    try { this.socket.close(); } catch { this.listeners.clear(); }
  }

  uriFor(path: string): string {
    return joinUri(this.rootUri, path);
  }

  pathOf(uri: string): string | null {
    const flat = decoded(uri);
    const base = `${decoded(this.rootUri)}/`;
    const drive = /^file:\/\/\/[a-z]:/i.test(base);
    const hit = drive ? flat.toLowerCase().startsWith(base.toLowerCase()) : flat.startsWith(base);
    return hit ? flat.slice(base.length) : null;
  }

  private onPush(params: { uri: string; version?: number; diagnostics: RawDiagnostic[] }): boolean {
    const file = this.workspace.getFile(params.uri);
    if (!file) return false;
    if (params.version != null && params.version !== file.version) return true;
    const view = file.view;
    const plugin = view ? LSPPlugin.get(view) : null;
    const map = plugin ? (pos: RawPos): number => plugin.unsyncedChanges.mapPos(clampPos(plugin.syncedDoc, pos)) : null;
    this.accept(file, params.diagnostics, map);
    return true;
  }

  accept(file: SfFile, items: RawDiagnostic[], map: ((pos: RawPos) => number) | null): void {
    const path = this.pathOf(file.uri) ?? file.uri;
    this.raw.set(path, items);
    this.paint(file, items, map);
    this.mgr.emit('diagnostics');
  }

  paint(file: SfFile, items: RawDiagnostic[], map: ((pos: RawPos) => number) | null): void {
    const view = file.view;
    if (!view || !view.dom.isConnected) return;
    const doc = view.state.doc;
    const at = map ?? ((pos: RawPos) => clampPos(doc, pos));
    const list: Diagnostic[] = items.map((d) => {
      const from = Math.min(doc.length, at(d.range.start));
      const to = Math.min(doc.length, Math.max(from, at(d.range.end)));
      return { from, to, severity: SEVERITY[d.severity ?? 1] ?? 'error', message: d.message, source: d.source };
    });
    view.dispatch(setDiagnostics(view.state, list));
  }

  repaint(file: SfFile): void {
    const view = file.view;
    if (!view) return;
    const path = this.pathOf(file.uri) ?? file.uri;
    const items = this.raw.get(path);
    if (items && file.doc.eq(view.state.doc)) this.paint(file, items, null);
    else if (!file.doc.eq(view.state.doc)) this.afterEdit(file.uri);
  }

  afterEdit(uri: string): void {
    if (this.state !== 'ready') return;
    this.client.sync();
    this.schedulePull(uri, 120, false);
    const path = this.pathOf(uri);
    if (path !== null) this.mgr.emit('changed', path);
  }

  schedulePull(uri: string, delay: number, retry: boolean): void {
    if (!this.client.serverCapabilities?.diagnosticProvider && this.state === 'ready') return;
    const old = this.pulls.get(uri);
    if (old !== undefined) window.clearTimeout(old);
    this.pulls.set(uri, window.setTimeout(() => {
      this.pulls.delete(uri);
      void this.pull(uri, retry);
    }, delay));
  }

  private async pull(uri: string, retry: boolean): Promise<void> {
    const file = this.workspace.getFile(uri);
    if (!file || this.state !== 'ready' || !this.client.serverCapabilities?.diagnosticProvider) return;
    this.client.sync();
    let seen = 0;
    try {
      await this.client.withMapping(async (mapping: WorkspaceMapping) => {
        const res = await this.client.request<unknown, PullResult>('textDocument/diagnostic', { textDocument: { uri } });
        if (!res || res.kind !== 'full') return;
        const items = res.items ?? [];
        seen = items.length;
        this.accept(file, items, (pos) => mapping.mapPosition(uri, pos));
        for (const [other, doc] of Object.entries(res.relatedDocuments ?? {})) {
          const f = this.workspace.getFile(other);
          if (f && doc.kind === 'full') this.accept(f, doc.items ?? [], null);
        }
      });
    } catch {
      return;
    }
    if (retry && seen === 0 && this.workspace.getFile(uri)) this.schedulePull(uri, PULL_RETRY_MS, false);
  }

  async symbols(path: string): Promise<OutlineItem[] | null> {
    if (this.state !== 'ready' || !this.client.serverCapabilities?.documentSymbolProvider) return null;
    const uri = this.uriFor(path);
    if (!this.workspace.getFile(uri)) return null;
    this.client.sync();
    const res = await this.client.request<unknown, RawSymbol[] | null>('textDocument/documentSymbol', { textDocument: { uri } });
    const out: OutlineItem[] = [];
    const walk = (list: RawSymbol[], depth: number): void => {
      for (const s of list) {
        const at = (s.selectionRange ?? s.range ?? s.location?.range)?.start ?? { line: 0, character: 0 };
        out.push({ name: s.name, detail: s.detail ?? '', kind: s.kind, depth, line: at.line + 1, col: at.character + 1 });
        if (s.children?.length) walk(s.children, depth + 1);
      }
    };
    walk(res ?? [], 0);
    return out;
  }
}

export class LspManager {
  private host: LspHost | null = null;
  private readonly sessions = new Map<LspLang, Session>();
  private readonly listeners: Record<Topic, Set<(arg: string) => void>> = { state: new Set(), diagnostics: new Set(), changed: new Set() };
  private idle = new Map<LspLang, number>();
  private refreshing = false;

  attach(host: LspHost): void {
    this.host = host;
  }

  on(topic: Topic, fn: (arg: string) => void): () => void {
    this.listeners[topic].add(fn);
    return () => { this.listeners[topic].delete(fn); };
  }

  emit(topic: Topic, arg = ''): void {
    for (const fn of Array.from(this.listeners[topic])) fn(arg);
  }

  workspaceHost(session: Session): WorkspaceHost {
    return {
      pathOf: (uri) => session.pathOf(uri),
      open: (path) => this.host?.open(path) ?? Promise.resolve(false),
      transact: (path, spec) => this.host?.transact(path, spec),
      read: (path) => this.host?.read(path) ?? Promise.resolve(null),
      attached: (file) => {
        const timer = this.idle.get(session.lang);
        if (timer !== undefined) { window.clearTimeout(timer); this.idle.delete(session.lang); }
        queueMicrotask(() => session.repaint(file));
        this.emit('diagnostics');
        this.emit('state');
      },
      released: (file) => {
        session.raw.delete(session.pathOf(file.uri) ?? file.uri);
        this.emit('diagnostics');
        if (session.workspace.files.length === 0) this.parkIdle(session);
      },
    };
  }

  watcher(): Extension {
    const mgr = this;
    return ViewPlugin.fromClass(class {
      private timer = 0;
      update(u: ViewUpdate): void {
        if (!u.docChanged) return;
        window.clearTimeout(this.timer);
        const view = u.view;
        this.timer = window.setTimeout(() => {
          const plugin = LSPPlugin.get(view);
          if (plugin) mgr.sessionOf(plugin.client)?.afterEdit(plugin.uri);
        }, SYNC_MS);
      }

      destroy(): void {
        window.clearTimeout(this.timer);
      }
    });
  }

  sessionOf(client: LSPClient): Session | null {
    for (const s of this.sessions.values()) if (s.client === client) return s;
    return null;
  }

  private parkIdle(session: Session): void {
    const prev = this.idle.get(session.lang);
    if (prev !== undefined) window.clearTimeout(prev);
    this.idle.set(session.lang, window.setTimeout(() => {
      this.idle.delete(session.lang);
      if (this.sessions.get(session.lang) !== session || session.workspace.files.length > 0) return;
      this.sessions.delete(session.lang);
      session.dispose();
      this.emit('state');
    }, IDLE_MS));
  }

  onLost(session: Session): void {
    this.refreshing = true;
    try {
      for (const f of session.workspace.files) {
        const path = session.pathOf(f.uri);
        if (path !== null) this.host?.refresh(path);
      }
    } finally {
      this.refreshing = false;
    }
    if (session.state === 'stopped') this.host?.status(`${session.error}: ${session.lang}`);
  }

  private ensure(lang: LspLang, root: string): Session {
    const have = this.sessions.get(lang);
    const uri = fileUri(root);
    if (have && have.rootUri === uri && (have.state !== 'stopped' || this.refreshing)) return have;
    have?.dispose();
    const made = new Session(lang, uri, this);
    this.sessions.set(lang, made);
    this.emit('state');
    return made;
  }

  extensionsFor = (path: string): Extension[] => {
    const info = LANG_OF_EXT[extOf(path)];
    const root = this.host?.root();
    if (!info || !root) return [];
    const s = this.ensure(info.lang, root);
    if (s.state === 'unavailable' || s.state === 'stopped') return [];
    return [s.client.plugin(s.uriFor(path), info.id), lintGutter(), lspPhrases()];
  };

  release(path: string): void {
    for (const s of this.sessions.values()) s.workspace.release(s.uriFor(path));
  }

  reset(): void {
    for (const timer of this.idle.values()) window.clearTimeout(timer);
    this.idle.clear();
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
    this.emit('state');
    this.emit('diagnostics');
  }

  restart(paths: string[]): void {
    this.reset();
    for (const p of paths) if (LANG_OF_EXT[extOf(p)]) this.host?.refresh(p);
  }

  statusFor(path: string | null): LspStatus | null {
    const info = path ? LANG_OF_EXT[extOf(path)] : undefined;
    if (!info) return null;
    const s = this.sessions.get(info.lang);
    if (!s) return { lang: info.lang, state: 'starting', name: '', version: null, error: '', install: [] };
    return { lang: info.lang, state: s.state, name: s.name, version: s.version, error: s.error, install: s.install };
  }

  supports(path: string): boolean {
    return LANG_OF_EXT[extOf(path)] !== undefined;
  }

  problems(): Problem[] {
    const out: Problem[] = [];
    for (const s of this.sessions.values()) {
      for (const [path, items] of s.raw) {
        for (const d of items) {
          const sev = Math.min(4, Math.max(1, d.severity ?? 1)) as Problem['severity'];
          if (sev === 4) continue;
          out.push({ path, line: d.range.start.line + 1, col: d.range.start.character + 1, severity: sev, message: d.message, source: d.source ?? '' });
        }
      }
    }
    return out.sort((a, b) => a.severity - b.severity || a.path.localeCompare(b.path) || a.line - b.line || a.col - b.col);
  }

  async symbols(path: string): Promise<OutlineItem[] | null> {
    const info = LANG_OF_EXT[extOf(path)];
    const s = info ? this.sessions.get(info.lang) : undefined;
    if (!s) return null;
    try { return await s.symbols(path); } catch { return null; }
  }

  run(command: (view: EditorView) => boolean): boolean {
    return this.host?.run(command) ?? false;
  }

  servers(): Promise<LspServers> {
    return lspServers();
  }
}

export const lsp = new LspManager();
