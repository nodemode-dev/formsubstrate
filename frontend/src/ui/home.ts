import type { Commands } from './commands';
import { el, isMac, patchList, q, setClass, setHidden, setHtml, setText, setTitle } from './dom';
import { HomeFiles, type HomeFilesDeps, type RecentEntry } from './home-files';
import { t } from './i18n';
import { icon } from './icons';
import { toast } from './toast';
import type { WorkspaceStore } from './workspace-store';

export type { RecentEntry } from './home-files';

export interface HomeDeps {
  recent(): Promise<RecentEntry[]>;
  openPath(path: string): Promise<void>;
  forget(path: string): Promise<void>;
}

export type SessionState = 'needs-input' | 'working' | 'done';

export interface HomeSession {
  id: string;
  title: string;
  repo: string;
  branch: string;
  state: SessionState;
  elapsed: string;
}

type Page = 'start' | 'recent' | 'workspaces' | 'sessions';

const GROUPS: ReadonlyArray<{ state: SessionState; label: string }> = [
  { state: 'needs-input', label: 'Needs input' },
  { state: 'working', label: 'Working' },
  { state: 'done', label: 'Done' },
];

const CHIPS = ['Form repo', 'Git', 'Rust', 'TypeScript', 'Python', 'Markdown'];
const START_LIMIT = 5;

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function caps(combo: string | undefined): string {
  if (!combo) return '';
  return combo.split('+').map((p) => `<kbd class="cv-key">${p === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : p === 'Shift' ? (isMac ? '⇧' : 'Shift') : p === 'Alt' ? (isMac ? '⌥' : 'Alt') : p}</kbd>`).join('');
}

class HomeSessions {
  readonly root = el(`<div class="cv-hs">
    ${GROUPS.map((g) => `<section class="cv-hs-group" data-state="${g.state}" hidden><h3 class="cv-hs-title"><span class="cv-hs-dot"></span><span>${t(g.label)}</span><span class="cv-home-count">0</span></h3><div class="cv-hs-grid"></div></section>`).join('')}
    <div class="cv-hs-empty"><p class="cv-hf-empty">${t('No agent sessions yet')}</p><button class="cv-btn" type="button" data-cmd="agent-new">${icon('agent', 14)}<span>${t('New agent session')}</span></button></div>
  </div>`);
  private readonly empty = q(this.root, '.cv-hs-empty');

  set(list: readonly HomeSession[]): void {
    for (const g of GROUPS) {
      const section = q(this.root, `.cv-hs-group[data-state="${g.state}"]`);
      const items = list.filter((s) => s.state === g.state);
      patchList(q(section, '.cv-hs-grid'), items, {
        key: (s) => s.id,
        create: (s) => {
          const n = el(`<button class="cv-hs-card" type="button"><span class="cv-hs-card-title"></span><span class="cv-hs-card-meta"></span></button>`);
          this.fill(n, s);
          return n;
        },
        update: (n, s) => this.fill(n, s),
      });
      setText(q(section, '.cv-home-count'), String(items.length));
      setHidden(section, items.length === 0);
    }
    setHidden(this.empty, list.length > 0);
  }

  private fill(n: HTMLElement, s: HomeSession): void {
    setText(q(n, '.cv-hs-card-title'), s.title);
    setText(q(n, '.cv-hs-card-meta'), `${s.repo} · ${s.branch} · ${s.elapsed}`);
  }
}

export class Home {
  readonly el = el(`<section class="cv-home" aria-label="${t('Home')}">
    <nav class="cv-home-nav" aria-label="${t('Home')}">
      <div class="cv-home-brand">subform <span>${t('Form family workbench')}</span></div>
      ${this.nav('start', 'home', 'Start')}${this.nav('recent', 'history', 'Recent')}${this.nav('workspaces', 'pfWorkspace', 'Workspaces')}${this.nav('sessions', 'agentChat', 'Sessions')}
      <div class="cv-home-nav-sep"></div>
      <div class="cv-home-nav-title">${t('Create')}</div>
      ${this.cmd('new-form-app', 'newFile', 'New Form app')}${this.cmd('open-folder', 'folderOpen', 'Open folder')}${this.cmd('clone-repo', 'clone', 'Clone repo')}${this.cmd('agent-new', 'agent', 'New agent session')}
      <div class="cv-home-nav-foot"><button class="cv-home-nav-item cv-home-back" type="button" data-cmd="home-back" hidden>${icon('chevronLeft', 16)}<span>${t('Back')}</span></button>${this.cmd('settings', 'settings', 'Preferences')}${this.cmd('help', 'info', 'Help')}</div>
    </nav>
    <div class="cv-home-main">
      <div class="cv-home-narrow">${this.nav('start', 'home', 'Start')}${this.nav('recent', 'history', 'Recent')}${this.nav('workspaces', 'pfWorkspace', 'Workspaces')}${this.nav('sessions', 'agentChat', 'Sessions')}</div>
      <div class="cv-home-page" data-page="start">
        <div class="cv-home-head"><div><h1 class="cv-home-title"></h1><p class="cv-home-sub">${t('Open a repository or a folder, or start a new Form app.')}</p></div></div>
        <div class="cv-home-hero">
          <span class="cv-home-hero-icon">${icon('folderOpen', 26)}</span>
          <div class="cv-home-hero-text"><div class="cv-home-hero-title">${t('Open a repo or a folder')}</div>
            <div class="cv-home-hero-sub">${t('Drop a folder anywhere in the window to open it as a workspace. Form repositories open with their slots, tasks and agent sessions.')}</div>
            <div class="cv-home-formats">${CHIPS.map((c) => `<span class="cv-home-format">${t(c)}</span>`).join('')}</div></div>
          <div class="cv-home-hero-actions">
            <button class="cv-home-action is-primary" type="button" data-cmd="open-folder">${icon('folderOpen', 16)}<span class="cv-home-label">${t('Open folder...')}</span><span class="cv-home-keys" data-keys="open-folder"></span></button>
            <button class="cv-home-action" type="button" data-cmd="clone-repo">${icon('clone', 16)}<span class="cv-home-label">${t('Clone repo...')}</span></button>
            <button class="cv-home-action is-ghost" type="button" data-cmd="new-form-app">${icon('newFile', 16)}<span class="cv-home-label">${t('New Form app')}</span></button>
          </div>
        </div>
        <section class="cv-home-section"><div class="cv-home-section-head"><h2 class="cv-home-section-title">${t('Recent')}</h2><button class="cv-btn cv-btn-ghost" type="button" data-v="recent">${t('See all')}</button></div><div class="cv-home-slot" data-slot="start-recent"></div></section>
        <section class="cv-home-section"><div class="cv-home-section-head"><h2 class="cv-home-section-title">${t('Sessions')}</h2><button class="cv-btn cv-btn-ghost" type="button" data-v="sessions">${t('See all')}</button></div><div class="cv-home-slot" data-slot="start-sessions"></div></section>
      </div>
      <div class="cv-home-page" data-page="recent" hidden><div class="cv-home-head"><div><h1 class="cv-home-title">${t('Recent')}</h1><p class="cv-home-sub">${t('Folders you opened, newest first.')}</p></div></div><div class="cv-home-slot" data-slot="recent"></div></div>
      <div class="cv-home-page" data-page="workspaces" hidden><div class="cv-home-head"><div><h1 class="cv-home-title">${t('Workspaces')}</h1><p class="cv-home-sub">${t('Form repositories you opened, and the workspace open now.')}</p></div></div><div class="cv-home-slot" data-slot="workspaces"></div></div>
      <div class="cv-home-page" data-page="sessions" hidden><div class="cv-home-head"><div><h1 class="cv-home-title">${t('Sessions')}</h1><p class="cv-home-sub">${t('Agent sessions grouped by state: needs input, working, done.')}</p></div></div><div class="cv-home-slot" data-slot="sessions"></div></div>
    </div>
    <div class="cv-drop" hidden></div>
  </section>`);
  private readonly back = q(this.el, '.cv-home-back');
  private readonly drop = q(this.el, '.cv-drop');
  private readonly title = q(this.el, '[data-page="start"] .cv-home-title');
  private readonly recentLists: HomeFiles[] = [];
  private readonly workspaceList: HomeFiles;
  private readonly startSessions = new HomeSessions();
  private readonly allSessions = new HomeSessions();
  private page: Page = 'start';
  private forced = false;
  private open = false;
  private run = 0;
  private entries: readonly RecentEntry[] = [];
  private depth = 0;

  constructor(host: HTMLElement, private readonly store: WorkspaceStore, private readonly commands: Commands, private readonly d: HomeDeps) {
    const files: HomeFilesDeps = {
      open: (path) => { void this.openPath(path); },
      forget: (path) => { void this.d.forget(path).catch((e: unknown) => toast(this.message(e), 'error')).then(() => this.refresh()); },
    };
    const count = (v: Page) => (n: number): void => {
      for (const c of Array.from(this.el.querySelectorAll(`.cv-home-nav-item[data-v="${v}"] .cv-home-count`))) setText(c, String(n));
    };
    const mount = (slot: string, node: HTMLElement): void => { q(this.el, `[data-slot="${slot}"]`).append(node); };
    const startRecent = new HomeFiles(files, { kind: 'recent', limit: START_LIMIT, compact: true });
    const recent = new HomeFiles(files, { kind: 'recent', onCount: count('recent') });
    this.workspaceList = new HomeFiles(files, { kind: 'workspaces', onCount: count('workspaces') });
    this.recentLists.push(startRecent, recent);
    mount('start-recent', startRecent.root);
    mount('recent', recent.root);
    mount('workspaces', this.workspaceList.root);
    mount('start-sessions', this.startSessions.root);
    mount('sessions', this.allSessions.root);
    this.startSessions.set([]);
    this.allSessions.set([]);

    this.el.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const btn = target?.closest<HTMLButtonElement>('button[data-cmd]');
      if (btn && this.el.contains(btn)) {
        e.stopPropagation();
        if (!btn.disabled) this.commands.run(btn.dataset.cmd ?? '');
        return;
      }
      const v = target?.closest<HTMLElement>('[data-v]')?.dataset.v as Page | undefined;
      if (v) this.go(v);
    });
    this.wireDrop();
    store.on('workspace', (ws) => {
      if (ws) { this.forced = false; this.sync(); } else this.sync();
      void this.refresh();
    });
    store.on('sessions', () => this.syncCounts());
    host.append(this.el);
    this.sync();
    this.paint();
    void this.refresh();
  }

  private nav(v: Page, ic: string, label: string): string {
    return `<button class="cv-home-nav-item" type="button" data-v="${v}">${icon(ic, 16)}<span>${t(label)}</span>${v === 'start' ? '' : '<span class="cv-home-count">0</span>'}</button>`;
  }

  private cmd(id: string, ic: string, label: string): string {
    return `<button class="cv-home-nav-item" type="button" data-cmd="${id}">${icon(ic, 16)}<span>${t(label)}</span></button>`;
  }

  private message(e: unknown): string {
    return e instanceof Error && e.message ? e.message : t('Could not open the folder.');
  }

  private async openPath(path: string): Promise<void> {
    try {
      await this.d.openPath(path);
    } catch (e) {
      toast(this.message(e), 'error');
    }
  }

  get isOpen(): boolean { return this.open; }

  show(page?: Page): void {
    if (page) this.go(page);
    this.forced = true;
    this.sync();
  }

  hide(): void {
    this.forced = false;
    if (this.store.workspace) this.sync();
    else this.apply(false);
  }

  toggle(): void {
    if (this.open) this.hide(); else this.show();
  }

  setSessions(list: readonly HomeSession[]): void {
    this.startSessions.set(list);
    this.allSessions.set(list);
    this.syncCounts();
  }

  async refresh(): Promise<void> {
    const run = ++this.run;
    let entries: RecentEntry[] | null = null;
    try { entries = await this.d.recent(); } catch { entries = null; }
    if (run !== this.run) return;
    if (entries) this.entries = entries;
    const current = this.store.workspace?.path ?? '';
    for (const l of this.recentLists) l.setEntries(this.entries, current);
    this.workspaceList.setEntries(this.entries, current);
  }

  private go(page: Page): void {
    if (page === this.page) return;
    this.page = page;
    this.paint();
  }

  private sync(): void {
    const on = this.forced || !this.store.workspace;
    this.apply(on);
  }

  private apply(on: boolean): void {
    setHidden(this.back, !this.store.workspace);
    if (on === this.open) return;
    this.open = on;
    if (on) { this.paint(); void this.refresh(); }
    setHidden(this.el, !on);
  }

  private paint(): void {
    for (const n of Array.from(this.el.querySelectorAll<HTMLElement>('.cv-home-page'))) setHidden(n, n.dataset.page !== this.page);
    for (const n of Array.from(this.el.querySelectorAll<HTMLElement>('.cv-home-nav-item[data-v]'))) setClass(n, 'is-active', n.dataset.v === this.page);
    setText(this.title, t(greeting()));
    for (const k of Array.from(this.el.querySelectorAll<HTMLElement>('[data-keys]'))) {
      const cmd = this.commands.get(k.dataset.keys ?? '');
      const combo = cmd?.keys?.[0];
      setHtml(k, caps(combo), combo ?? '');
    }
    for (const b of Array.from(this.el.querySelectorAll<HTMLButtonElement>('button[data-cmd]'))) {
      const cmd = this.commands.get(b.dataset.cmd ?? '');
      if (cmd) setTitle(b, this.commands.label(cmd).replace(/\.\.\.$/, ''));
    }
  }

  private syncCounts(): void {
    const s = this.store.sessions;
    for (const c of Array.from(this.el.querySelectorAll('.cv-home-nav-item[data-v="sessions"] .cv-home-count'))) setText(c, String(s.working + s.needsInput));
  }

  private wireDrop(): void {
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const showDrop = (on: boolean): void => { setHidden(this.drop, !on); };
    this.el.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); this.depth++; showDrop(true); });
    this.el.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    this.el.addEventListener('dragleave', () => { this.depth = Math.max(0, this.depth - 1); if (!this.depth) showDrop(false); });
    this.el.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      this.depth = 0;
      showDrop(false);
      toast(t('Browsers do not reveal folder paths. Use Open folder and enter the path.'), 'info');
    });
    if (!('__TAURI_INTERNALS__' in window)) return;
    void import('@tauri-apps/api/event').then(async (m) => {
      await m.listen('tauri://drag-enter', () => { if (this.open) showDrop(true); });
      await m.listen('tauri://drag-leave', () => { showDrop(false); });
      await m.listen<{ paths: string[] }>('tauri://drag-drop', (ev) => {
        showDrop(false);
        const path = ev.payload.paths[0];
        if (this.open && path) void this.openPath(path);
      });
    }).catch(() => undefined);
  }
}
