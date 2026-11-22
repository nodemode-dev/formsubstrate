import { EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { getIndentUnit, indentUnit } from '@codemirror/language';
import { LSPClient, LSPPlugin, languageServerExtensions, type Transport, type WorkspaceMapping } from '@codemirror/lsp-client';
import { CUSTOM_LSP_EVENT, customLsp, forgetTrustSync, lspServers, lspSocketUrl, syncTrust, trustSynced, type LspLang, type LspServers } from '../../io/lsp';
import { t, tn } from '../i18n';
import { toast } from '../toast';
import { isolateHistory } from '@codemirror/commands';
import { actionBulb, diagnosticBody } from './code-actions';
import { applyWorkspaceEdit, editsOf, textOf, type EditHost, type EditOutcome, type WorkspaceEdit } from './lsp-edits';
import { SfWorkspace, type SfFile, type WorkspaceHost } from './lsp-workspace';

export type LspState = 'starting' | 'ready' | 'unavailable' | 'stopped';

export interface LspHost {
  root(): string | null;
  open(path: string, line?: number, col?: number): Promise<boolean>;
  transact(path: string, spec: TransactionSpec): void;
  read(path: string): Promise<string | null>;
  text(path: string): string | null;
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
  label: string;
  reason: string;
}

interface LangPick { lang: LspLang; id: string; label: string }

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

interface RawCommand { command: string; arguments?: unknown[] }
interface RawAction { title: string; kind?: string; isPreferred?: boolean; disabled?: unknown; edit?: WorkspaceEdit; command?: RawCommand | string; arguments?: unknown[] }

export interface ActionChoice { title: string; kind: string; preferred: boolean; apply(): Promise<boolean> }
export interface ActionQuery { from: number; to: number; only?: string[]; auto: boolean; diagnostics?: unknown[]; signal?: AbortSignal }

type Topic = 'state' | 'diagnostics' | 'changed';

const ACTION_KINDS = ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports', 'source.fixAll'];
const ACTION_CAPABILITIES = {
  textDocument: {
    codeAction: {
      dynamicRegistration: false,
      codeActionLiteralSupport: { codeActionKind: { valueSet: ACTION_KINDS } },
      isPreferredSupport: true,
      dataSupport: true,
      resolveSupport: { properties: ['edit'] },
    },
  },
  workspace: {
    applyEdit: true,
    workspaceEdit: { documentChanges: true, resourceOperations: ['create', 'rename'], failureHandling: 'abort' },
    executeCommand: { dynamicRegistration: false },
  },
};
const UNUSED_IMPORTS = 'source.removeUnusedImports';
const FILES_WRITTEN = 'formsubstrate:files-written';
const PATHS_CHANGED = 'formsubstrate:paths-changed';
const GIT_CHANGED = 'formsubstrate:git-changed';

interface ServerRequest { id?: number | string; method?: string; params?: { edit?: WorkspaceEdit } }
const serverRequest = (data: string): ServerRequest | null => {
  try { return JSON.parse(data) as ServerRequest | null; } catch { return null; }
};
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String((e as { message?: unknown } | null)?.message ?? e));
const earlier = (a: RawPos, b: RawPos): boolean => a.line < b.line || (a.line === b.line && a.character < b.character);

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
const RETRY_MS = 5000;
const TAG = /"method":\s*"formsubstrate\//;

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
  reason = '';
  lostAt = 0;
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
      extensions: [...languageServerExtensions(), { editorExtension: mgr.watcher() }, { clientCapabilities: ACTION_CAPABILITIES }],
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

  private connect(): void {
    if (this.disposed || this.client.connected) return;
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
    if (data.includes('"workspace/applyEdit"')) {
      const msg = serverRequest(data);
      if (msg && msg.method === 'workspace/applyEdit' && msg.id !== undefined) {
        void this.onApplyEdit(msg.id, msg.params?.edit);
        return;
      }
    }
    for (const h of Array.from(this.listeners)) h(data);
  }

  private async onApplyEdit(id: number | string, edit: WorkspaceEdit | undefined): Promise<void> {
    const stamp = this.stamp();
    let outcome: EditOutcome;
    try { outcome = await applyWorkspaceEdit(edit, stamp, this.editHost()); } catch (e) { outcome = { applied: false, reason: errorText(e) }; }
    if (!outcome.applied) toast(outcome.reason, 'error');
    const result = outcome.applied ? { applied: true } : { applied: false, failureReason: outcome.reason };
    if (!this.disposed && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  private stamp(): Map<string, number> {
    return new Map(this.workspace.files.map((f) => [f.uri, f.version]));
  }

  private editHost(): EditHost {
    return {
      pathOf: (uri) => this.pathOf(uri),
      sync: () => { if (this.state === 'ready') this.client.sync(); },
      openDoc: (uri) => {
        const path = this.pathOf(uri);
        if (!path) return null;
        const file = this.workspace.getFile(uri);
        if (file?.view && LSPPlugin.get(file.view)) return { key: file.uri, doc: file.doc, version: file.version, stale: !file.doc.eq(file.view.state.doc) };
        const text = this.mgr.textOf(path);
        if (text === null) return null;
        const doc = textOf(text);
        return file ? { key: file.uri, doc: file.doc, version: file.version, stale: !doc.eq(file.doc) } : { key: uri, doc, version: null, stale: false };
      },
      commit: (uri, changes) => {
        const path = this.pathOf(uri);
        if (!path) return;
        const file = this.workspace.getFile(uri);
        const hidden = file && !file.view ? changes.apply(file.doc) : null;
        this.mgr.transact(path, { changes, userEvent: 'input.codeaction', annotations: isolateHistory.of('full') });
        if (file && hidden) this.workspace.pushHidden(file, hidden);
      },
      settled: (uris, written, renamed) => {
        for (const uri of uris) this.afterEdit(uri);
        if (written.length) window.dispatchEvent(new CustomEvent(FILES_WRITTEN, { detail: { paths: written } }));
        for (const r of renamed) window.dispatchEvent(new CustomEvent(PATHS_CHANGED, { detail: { kind: 'rename', from: r.from, to: r.to } }));
        if (written.length || renamed.length) window.dispatchEvent(new Event(GIT_CHANGED));
      },
    };
  }

  private diagnosticsIn(uri: string, range: RawRange): RawDiagnostic[] {
    const items = this.raw.get(this.pathOf(uri) ?? uri) ?? [];
    return items.filter((d) => !earlier(range.end, d.range.start) && !earlier(d.range.end, range.start));
  }

  async actions(view: EditorView, q: ActionQuery): Promise<ActionChoice[]> {
    const plugin = LSPPlugin.get(view);
    if (!plugin || plugin.client !== this.client || this.state !== 'ready' || !this.client.serverCapabilities?.codeActionProvider) return [];
    this.client.sync();
    const uri = plugin.uri;
    const range = { start: plugin.toPosition(q.from), end: plugin.toPosition(q.to) };
    const stamp = this.stamp();
    const context = { diagnostics: q.diagnostics ?? this.diagnosticsIn(uri, range), ...(q.only ? { only: q.only } : {}), triggerKind: q.auto ? 2 : 1 };
    const params = { textDocument: { uri }, range, context };
    const stop = (): void => this.client.cancelRequest(params);
    q.signal?.addEventListener('abort', stop, { once: true });
    let found: Array<RawAction | null> | null;
    try {
      found = await this.client.request<typeof params, Array<RawAction | null> | null>('textDocument/codeAction', params);
    } catch {
      return [];
    } finally {
      q.signal?.removeEventListener('abort', stop);
    }
    if (q.signal?.aborted) return [];
    const out: ActionChoice[] = [];
    for (const item of found ?? []) {
      if (!item || typeof item.title !== 'string' || item.disabled) continue;
      const literal = typeof item.command !== 'string';
      const action: RawAction = typeof item.command === 'string' ? { title: item.title, command: { command: item.command, arguments: item.arguments } } : item;
      const kind = typeof action.kind === 'string' ? action.kind : '';
      if (q.only && !q.only.some((o) => kind === o || kind.startsWith(`${o}.`))) continue;
      out.push({ title: action.title, kind, preferred: action.isPreferred === true, apply: () => this.runAction(uri, action, stamp, literal) });
    }
    const flagged = context.diagnostics as RawDiagnostic[];
    const wantsFix = !q.only || q.only.includes('quickfix');
    if (wantsFix && flagged.length && !out.some((c) => c.kind === 'quickfix' || c.kind.startsWith('quickfix.'))) out.push(...await this.unusedImportFixes(uri, flagged, stamp, q));
    return out.sort((a, b) => Number(b.preferred) - Number(a.preferred));
  }

  private async unusedImportFixes(uri: string, flagged: RawDiagnostic[], stamp: Map<string, number>, q: ActionQuery): Promise<ActionChoice[]> {
    const provider = this.client.serverCapabilities?.codeActionProvider;
    const kinds = typeof provider === 'object' && Array.isArray(provider.codeActionKinds) ? provider.codeActionKinds : [];
    const file = this.workspace.getFile(uri);
    if (!file || !kinds.some((k) => k === UNUSED_IMPORTS || k.startsWith(`${UNUSED_IMPORTS}.`))) return [];
    const params = { textDocument: { uri }, range: flagged[0].range, context: { diagnostics: [], only: [UNUSED_IMPORTS], triggerKind: q.auto ? 2 : 1 } };
    let found: Array<RawAction | null> | null;
    try {
      found = await this.client.request<typeof params, Array<RawAction | null> | null>('textDocument/codeAction', params);
    } catch {
      return [];
    }
    if (q.signal?.aborted || stamp.get(file.uri) !== file.version) return [];
    const doc = file.doc, flat = decoded(uri);
    const removes = (action: RawAction): boolean => {
      const edits = editsOf(action.edit, (other) => decoded(other) === flat);
      return flagged.some((d) => {
        const word = doc.sliceString(clampPos(doc, d.range.start), clampPos(doc, d.range.end));
        return edits.some((e) => !earlier(e.range.end, d.range.start) && !earlier(d.range.end, e.range.start) && (!word || !e.newText.includes(word)));
      });
    };
    const out: ActionChoice[] = [];
    for (const item of found ?? []) {
      if (!item || typeof item.title !== 'string' || typeof item.command === 'string' || !item.edit || !removes(item)) continue;
      out.push({ title: item.title, kind: typeof item.kind === 'string' ? item.kind : UNUSED_IMPORTS, preferred: false, apply: () => this.runAction(uri, item, stamp, true) });
    }
    return out;
  }

  private async runAction(uri: string, picked: RawAction, stamp: Map<string, number>, literal: boolean): Promise<boolean> {
    if (this.state !== 'ready') return false;
    this.client.sync();
    const file = this.workspace.getFile(uri);
    if (!file || stamp.get(file.uri) !== file.version) {
      toast(t('The file changed since this fix was offered, so it was not applied. Ask for the fixes again.'), 'error');
      return false;
    }
    let action = picked;
    const provider = this.client.serverCapabilities?.codeActionProvider;
    if (literal && !action.edit && typeof provider === 'object' && provider.resolveProvider) {
      try {
        action = (await this.client.request<RawAction, RawAction | null>('codeAction/resolve', action)) ?? action;
      } catch (e) {
        toast(`${t('The language server could not prepare this fix')}: ${errorText(e)}`, 'error');
        return false;
      }
    }
    if (action.edit) {
      const outcome = await applyWorkspaceEdit(action.edit, stamp, this.editHost());
      if (!outcome.applied) {
        toast(outcome.reason, 'error');
        return false;
      }
    }
    const command = typeof action.command === 'object' ? action.command : null;
    if (!command || typeof command.command !== 'string') return true;
    try {
      await this.client.request('workspace/executeCommand', { command: command.command, arguments: command.arguments ?? [] });
    } catch (e) {
      toast(`${t('The language server could not run this action')}: ${errorText(e)}`, 'error');
      return false;
    }
    return true;
  }

  private onControl(data: string): void {
    let msg: { method?: string; params?: Record<string, unknown> };
    try { msg = JSON.parse(data) as typeof msg; } catch { return; }
    const p = msg.params ?? {};
    if (msg.method === 'formsubstrate/serverStarted') {
      this.name = String(p.name ?? '');
      this.version = typeof p.version === 'string' ? p.version : null;
      this.mgr.emit('state');
      this.connect();
    } else if (msg.method === 'formsubstrate/serverUnavailable') {
      this.error = String(p.error ?? '');
      this.install = Array.isArray(p.install) ? p.install.map(String) : [];
      this.reason = String(p.reason ?? '');
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
    if (state === 'stopped') this.lostAt = Date.now();
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
    const fixes = !!this.client.serverCapabilities?.codeActionProvider;
    const list: Diagnostic[] = items.map((d) => {
      const from = Math.min(doc.length, at(d.range.start));
      const to = Math.min(doc.length, Math.max(from, at(d.range.end)));
      const item: Diagnostic = { from, to, severity: SEVERITY[d.severity ?? 1] ?? 'error', message: d.message, source: d.source };
      if (fixes) item.renderMessage = (shown) => diagnosticBody(shown, item, d);
      return item;
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
  private custom = new Map<string, LangPick>();
  private readonly opened = new Set<string>();
  private customSerial = 0;

  attach(host: LspHost): void {
    this.host = host;
    void this.loadCustom();
    window.addEventListener(CUSTOM_LSP_EVENT, () => { void this.loadCustom(); });
  }

  private langOf(path: string | null): LangPick | null {
    if (!path) return null;
    const ext = extOf(path);
    const builtin = LANG_OF_EXT[ext];
    return builtin ? { ...builtin, label: '' } : this.custom.get(ext) ?? null;
  }

  private async loadCustom(): Promise<void> {
    const mine = ++this.customSerial;
    let next = new Map<string, LangPick>();
    try {
      for (const s of (await customLsp.list()).servers) {
        for (const ext of s.exts) next.set(ext.replace(/^\./, ''), { lang: s.lang, id: s.languageId, label: s.label });
      }
    } catch {
      next = this.custom;
    }
    if (mine !== this.customSerial) return;
    const before = this.custom;
    this.custom = next;
    const stale = Array.from(this.sessions.keys()).filter((lang) => lang.startsWith('custom:'));
    for (const lang of stale) {
      const s = this.sessions.get(lang);
      this.sessions.delete(lang);
      s?.dispose();
    }
    const touched = Array.from(this.opened).filter((p) => before.has(extOf(p)) || next.has(extOf(p)));
    for (const p of touched) this.host?.refresh(p);
    if (touched.length || stale.length) { this.emit('state'); this.emit('diagnostics'); }
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
    if (have && have.rootUri === uri && (have.state !== 'stopped' || this.refreshing || Date.now() - have.lostAt < RETRY_MS)) return have;
    have?.dispose();
    const made = new Session(lang, uri, this);
    this.sessions.set(lang, made);
    this.emit('state');
    return made;
  }

  extensionsFor = (path: string): Extension[] => {
    this.opened.add(path);
    const info = this.langOf(path);
    const root = this.host?.root();
    if (!info || !root) return [];
    if (!trustSynced()) {
      void syncTrust().then(() => { if (this.opened.has(path)) this.host?.refresh(path); });
      return [lintGutter(), actionBulb];
    }
    const s = this.ensure(info.lang, root);
    if (s.state === 'unavailable' || s.state === 'stopped') return [lintGutter(), actionBulb];
    return [s.client.plugin(s.uriFor(path), info.id), lintGutter(), actionBulb, lspPhrases()];
  };

  textOf(path: string): string | null {
    return this.host?.text(path) ?? null;
  }

  transact(path: string, spec: TransactionSpec): void {
    this.host?.transact(path, spec);
  }

  private sessionFor(view: EditorView): Session | null {
    const plugin = LSPPlugin.get(view);
    return plugin ? this.sessionOf(plugin.client) : null;
  }

  codeActions(view: EditorView, q: ActionQuery): Promise<ActionChoice[]> {
    return this.sessionFor(view)?.actions(view, q) ?? Promise.resolve([]);
  }

  actionKinds(view: EditorView): string[] | null {
    const s = this.sessionFor(view);
    const provider = s && s.state === 'ready' ? s.client.serverCapabilities?.codeActionProvider : null;
    if (!provider) return null;
    return typeof provider === 'object' && Array.isArray(provider.codeActionKinds) ? provider.codeActionKinds : [];
  }

  release(path: string): void {
    this.opened.delete(path);
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
    forgetTrustSync();
    for (const p of paths) if (this.langOf(p)) this.host?.refresh(p);
  }

  statusFor(path: string | null): LspStatus | null {
    const info = this.langOf(path);
    if (!info) return null;
    const s = this.sessions.get(info.lang);
    if (!s) return { lang: info.lang, state: 'starting', name: '', version: null, error: '', install: [], label: info.label, reason: '' };
    return { lang: info.lang, state: s.state, name: s.name, version: s.version, error: s.error, install: s.install, label: info.label, reason: s.reason };
  }

  supports(path: string): boolean {
    return this.langOf(path) !== null;
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
    const info = this.langOf(path);
    const s = info ? this.sessions.get(info.lang) : undefined;
    if (!s) return null;
    try { return await s.symbols(path); } catch { return null; }
  }

  async formatForSave(view: EditorView, ms: number): Promise<boolean> {
    const plugin = LSPPlugin.get(view);
    const session = plugin ? this.sessionOf(plugin.client) : null;
    if (!plugin || !session || session.state !== 'ready' || !plugin.client.serverCapabilities?.documentFormattingProvider) return false;
    plugin.client.sync();
    let timer = 0;
    const late = new Promise<'late'>((resolve) => { timer = window.setTimeout(() => resolve('late'), ms); });
    try {
      return await plugin.client.withMapping(async (mapping: WorkspaceMapping) => {
        const options = { tabSize: getIndentUnit(view.state), insertSpaces: !view.state.facet(indentUnit).includes('\t') };
        const reply = await Promise.race([
          plugin.client.request<unknown, Array<{ range: RawRange; newText: string }> | null>('textDocument/formatting', { textDocument: { uri: plugin.uri }, options }),
          late,
        ]);
        if (reply === 'late' || LSPPlugin.get(view) !== plugin) return false;
        if (!reply?.length) return true;
        const touched = mapping.getMapping(plugin.uri);
        const changes: Array<{ from: number; to: number; insert: string }> = [];
        for (const edit of reply) {
          let from = mapping.mapPosition(plugin.uri, edit.range.start);
          let to = mapping.mapPosition(plugin.uri, edit.range.end);
          if (touched) {
            if (touched.touchesRange(from, to)) return false;
            from = touched.mapPos(from, 1);
            to = touched.mapPos(to, -1);
          }
          changes.push({ from, to, insert: edit.newText });
        }
        view.dispatch({ changes, userEvent: 'format' });
        return true;
      });
    } catch {
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  }

  run(command: (view: EditorView) => boolean): boolean {
    return this.host?.run(command) ?? false;
  }

  servers(): Promise<LspServers> {
    return lspServers();
  }
}

export const lsp = new LspManager();
