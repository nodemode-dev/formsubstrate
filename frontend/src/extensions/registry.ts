import type { Commands } from '../ui/commands';
import type { WorkspaceStore } from '../ui/workspace-store';

export interface ExtensionContext {
  store: WorkspaceStore;
  commands: Commands;
}

export interface SidebarSectionOptions {
  id: string;
  title: string;
  icon: string;
  render(host: HTMLElement): void;
}

export interface SidebarSection {
  host: HTMLElement;
  reveal(): void;
  setAvailable?(on: boolean): void;
}

export interface SearchItem {
  label: string;
  hint?: string;
  icon?: string;
  run(): void;
}

export interface SearchProvider {
  id: string;
  prefix?: string;
  label: string;
  query(q: string): Promise<SearchItem[]>;
}

export interface Shell {
  sidebarSection(opts: SidebarSectionOptions): SidebarSection;
  openEditorTab(path: string, line?: number, col?: number): void;
  revealLine(path: string, line: number, col?: number): void;
  setStatus(text: string, kind?: 'info' | 'error'): void;
  toggleBottom(show?: boolean): void;
  rightSection?(opts: SidebarSectionOptions): SidebarSection;
  toggleRight?(show?: boolean): void;
  readonly splitHost?: HTMLElement;
  toggleSplit?(show?: boolean): void;
  registerSearchProvider(provider: SearchProvider): void;
}

export interface Extension {
  id: string;
  name?: string;
  description?: string;
  required?: boolean;
  setup(ctx: ExtensionContext, shell: Shell): void;
  dispose?(): void;
}

const registry = new Map<string, Extension>();
const activated = new Set<string>();
const providers = new Map<string, SearchProvider>();
let live: { ctx: ExtensionContext; shell: Shell } | null = null;

const DISABLED_KEY = 'subform.ext.disabled';

function disabledSet(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DISABLED_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDisabled(s: Set<string>): void {
  try { localStorage.setItem(DISABLED_KEY, JSON.stringify([...s])); } catch { return; }
}

function activate(id: string): boolean {
  const ext = registry.get(id);
  if (!ext || activated.has(id) || !live) return false;
  try {
    ext.setup(live.ctx, live.shell);
    activated.add(id);
    return true;
  } catch (err) {
    console.error(`extension ${id} failed to activate`, err);
    return false;
  }
}

export function register(ext: Extension): void {
  if (registry.has(ext.id)) throw new Error(`duplicate extension: ${ext.id}`);
  registry.set(ext.id, ext);
  if (live && (ext.required || !disabledSet().has(ext.id))) activate(ext.id);
}

export function activateAll(ctx: ExtensionContext, shell: Shell): void {
  live = { ctx, shell };
  const off = disabledSet();
  for (const ext of registry.values()) if (ext.required || !off.has(ext.id)) activate(ext.id);
}

export function listExtensions(): Array<Extension & { enabled: boolean; active: boolean }> {
  const off = disabledSet();
  return [...registry.values()].map((e) => ({ ...e, enabled: e.required === true || !off.has(e.id), active: activated.has(e.id) }));
}

export function setEnabled(id: string, on: boolean): 'active' | 'reload' | 'noop' {
  const ext = registry.get(id);
  if (!ext || ext.required) return 'noop';
  const off = disabledSet();
  if (on) {
    off.delete(id);
    saveDisabled(off);
    return activate(id) ? 'active' : 'noop';
  }
  off.add(id);
  saveDisabled(off);
  if (!activated.has(id)) return 'noop';
  try { ext.dispose?.(); } catch (err) { console.error(`extension ${id} failed to dispose`, err); }
  return 'reload';
}

export function registerSearchProvider(p: SearchProvider): void {
  providers.set(p.id, p);
}

export function searchProviders(): SearchProvider[] {
  return [...providers.values()];
}

interface LazyPanel {
  host: HTMLElement;
  fetch: () => Promise<unknown>;
  mount: () => Promise<void>;
  started: Promise<void> | null;
}

const lazies: LazyPanel[] = [];
const idleQueue: Array<() => Promise<unknown>> = [];
let idleOn = false;
let idleBusy = false;
let markBooted: () => void = () => undefined;

export const booted: Promise<void> = new Promise<void>((resolve) => { markBooted = resolve; });

function whenIdle(run: () => void): void {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric.call(window, run, { timeout: 4000 });
  else window.setTimeout(run, 400);
}

function drainIdle(): void {
  if (!idleOn || idleBusy) return;
  const next = idleQueue.shift();
  if (!next) return;
  idleBusy = true;
  whenIdle(() => {
    next().catch(() => undefined).finally(() => {
      idleBusy = false;
      drainIdle();
    });
  });
}

export function idleLoad(chunk: () => Promise<unknown>): void {
  idleQueue.push(chunk);
  drainIdle();
}

export function startIdle(): void {
  idleOn = true;
  markBooted();
  drainIdle();
}

export function lazyPanel<T>(host: HTMLElement, chunk: () => Promise<T>, mount: (mod: T) => void, mountWhenIdle = false): () => Promise<void> {
  const item: LazyPanel = {
    host,
    fetch: chunk,
    mount: () => chunk().then((mod) => { mount(mod); }),
    started: null,
  };
  const start = (): Promise<void> => {
    item.started ??= item.mount().catch((err: unknown) => { console.error('panel failed to load', err); });
    return item.started;
  };
  lazies.push(item);
  idleLoad(mountWhenIdle ? start : chunk);
  new MutationObserver(() => { if (!host.hidden) void start(); }).observe(host, { attributes: true, attributeFilter: ['hidden'] });
  return start;
}

export function settleVisible(): Promise<void> {
  const open = lazies.filter((l) => !l.host.hidden && !l.started);
  return Promise.all(open.map((l) => {
    l.started ??= l.mount().catch((err: unknown) => { console.error('panel failed to load', err); });
    return l.started;
  })).then(() => undefined);
}
