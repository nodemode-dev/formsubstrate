import { systemStatus } from './io/api';
import { CaptionButtons, wantsCustomTitleBar } from './ui/caption-buttons';
import { CommandPalette } from './ui/command-palette';
import { comboOf, Commands, type Command } from './ui/commands';
import { brandMark } from './ui/brand';
import { anyDialogOpen, confirmAction, Dialog } from './ui/dialogs';
import { el, mountOnce, q, revealApp, setClass, setDisabled, setHidden, setText, setTitle } from './ui/dom';
import { onLanguage, t } from './ui/i18n';
import { icon } from './ui/icons';
import { MenuBar, setMenuStyle, type MenuDef } from './ui/menu';
import { menusInWindow, MENUS_IN_WINDOW_KEY, NativeMenus, textFieldFocused, wantsNativeMenus } from './ui/native-menu';
import { applyUiFontSize, autoUiScale, loadPrefs, setUiScale, uiScaleChoice, type Prefs } from './ui/prefs';
import { StatusBar } from './ui/status';
import { Tabs } from './ui/tabs';
import { THEMES, applyTheme, readChoice, setTheme } from './ui/themes';
import { TitleTools } from './ui/titlebar-tools';
import { toast } from './ui/toast';
import { workspace as store } from './ui/workspace-store';

const APP = 'subform';
const FONT_WAIT_MS = 2500;
const ENGINE_POLL_MS = 15000;
const UI_ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const CUSTOM_TITLE_KEY = 'subform.customTitleBar';
const TEXT_EDITS = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'select-all']);
const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;

function stored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function keep(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { return; }
}

const SHELL = `<div class="cv-app">
<header class="cv-titlebar">
<nav class="cv-menubar" aria-label="Main menu"></nav>
<div class="cv-tb-doc"></div>
<div class="cv-tb-app">${APP} 2026</div>
<div class="cv-zoom">
<button class="cv-tt-btn" type="button" data-cmd="settings">${icon('settings', 16)}</button>
</div>
</header>
<div class="cv-main">
<div class="cv-doc-tabs"><div class="cv-brand">${brandMark(18)}</div><div class="cv-tabs"><div class="cv-tab-strip" role="tablist"></div></div></div>
<main class="cv-stage"></main>
</div>
<footer class="cv-status"></footer>
</div>`;

function fontsReady(): Promise<unknown> {
  const wait = new Promise<void>((resolve) => { window.setTimeout(resolve, FONT_WAIT_MS); });
  return Promise.race([document.fonts.ready, wait]);
}

async function useWindow(run: (w: import('@tauri-apps/api/window').Window) => Promise<unknown>): Promise<void> {
  if (!isTauri()) return;
  try {
    const m = await import('@tauri-apps/api/window');
    await run(m.getCurrentWindow());
  } catch {
    return;
  }
}

export function applyUiPrefs(pr: Prefs): void {
  applyUiFontSize(pr);
  setClass(document.body, 'animations-disabled', !pr.animations);
  setMenuStyle(pr.menuHidden, pr.menuColors);
}

const uiZoom = (): number => {
  const raw = uiScaleChoice();
  if (raw === 'auto') return autoUiScale();
  const n = parseFloat(raw);
  return UI_ZOOMS.includes(n) ? n : 1;
};

function applyUiZoom(): void {
  const zoom = uiZoom(), z = zoom === 1 ? '' : String(zoom);
  if (document.documentElement.style.zoom === z) return;
  document.documentElement.style.zoom = z;
  window.dispatchEvent(new Event('resize'));
}

function stepUiZoom(by: number): void {
  const at = UI_ZOOMS.indexOf(uiZoom());
  setUiScale(String(UI_ZOOMS[Math.max(0, Math.min(UI_ZOOMS.length - 1, at + by))]));
  applyUiZoom();
}

class AboutDialog extends Dialog {
  private readonly version = el('<p class="cv-note"></p>');
  private readonly engine = el('<p class="cv-note"></p>');
  private readonly dataDir = el('<p class="cv-note"></p>');

  constructor() {
    super('About subform', 380);
    const head = el(`<div class="cv-about-head">${brandMark(40)}<span class="cv-about-name">${APP}</span></div>`);
    this.body.append(head, this.version, this.engine, this.dataDir);
    this.foot.append(this.button('Close', 'primary', () => this.close()));
  }

  show(): void {
    if (this.isOpen) return;
    this.open();
    void systemStatus().then((s) => {
      setText(this.version, `${t('Version')} ${s.version}`);
      setText(this.engine, `${t('Engine')}: ${s.engine}`);
      setText(this.dataDir, `${t('Data folder')}: ${s.data_dir}`);
    }).catch(() => {
      setText(this.version, t('Engine offline'));
      setText(this.engine, '');
      setText(this.dataDir, '');
    });
  }
}

export async function startApp(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('missing element: #app');
  applyTheme(readChoice());
  applyUiPrefs(loadPrefs());
  applyUiZoom();
  mountOnce(host, SHELL);
  const root = q(host, '.cv-app');
  const stage = q(root, '.cv-stage');
  const empty = el<HTMLElement>(`<p class="cv-stage-empty cv-note">${t('Open a folder or a Form repository to begin')}</p>`);
  stage.append(empty);

  const commands = new Commands();
  const later = new Set<string>();
  const soon = (cmd: Command): Command => { later.add(cmd.id); return { ...cmd, enabled: () => false }; };
  commands.blocked = (cmd) => (later.has(cmd.id) ? t('Not available yet') : '');

  let lastField: HTMLElement | null = null;
  document.addEventListener('focusin', (e) => { if (textFieldFocused() && e.target instanceof HTMLElement) lastField = e.target; }, true);
  const usable = (): boolean => !!lastField?.isConnected && lastField.getClientRects().length > 0;
  const editable = (): boolean => textFieldFocused() || usable();
  const editAction = (id: string): void => {
    if (!textFieldFocused() && usable()) lastField?.focus();
    if (!textFieldFocused()) return;
    const fallback = (): void => { document.execCommand(id === 'select-all' ? 'selectAll' : id); };
    if (isTauri()) void import('@tauri-apps/api/core').then((m) => m.invoke('text_edit', { action: id })).catch(fallback);
    else fallback();
  };
  const edit = (id: string, label: string, keys: string[]): Command => ({ id, label, keys, enabled: editable, run: () => editAction(id) });

  const requestClose = async (id: string): Promise<void> => {
    const doc = store.docs.find((d) => d.id === id);
    if (!doc) return;
    if (doc.modified && !(await confirmAction('Close without saving', `${doc.name} ${t('has unsaved changes.')}`, 'Close', true))) return;
    store.closeDoc(id);
  };
  const stepTab = (by: number): void => {
    const docs = store.docs, at = docs.findIndex((d) => d.id === store.active?.id);
    if (docs.length > 1 && at >= 0) store.setActive(docs[(at + by + docs.length) % docs.length].id);
  };
  const toggleTheme = (): void => { setTheme(THEMES[readChoice().theme]?.light ? 'studio' : 'light'); };

  const about = new AboutDialog();
  const palette = new CommandPalette(commands, () => menus);
  let captionButtons: CaptionButtons;

  commands.add(
    soon({ id: 'open-folder', label: 'Open Folder...', keys: ['Mod+O'], run: () => undefined }),
    soon({ id: 'open-recent', label: 'Open Recent', run: () => undefined }),
    soon({ id: 'save', label: 'Save', keys: ['Mod+S'], run: () => undefined }),
    soon({ id: 'save-all', label: 'Save All', keys: ['Alt+Mod+S'], run: () => undefined }),
    { id: 'close-tab', label: 'Close Tab', keys: ['Mod+W'], enabled: () => !!store.active, run: () => { if (store.active) void requestClose(store.active.id); } },
    soon({ id: 'settings', label: 'Preferences...', keys: ['Mod+,'], run: () => undefined }),
    { id: 'quit', label: 'Quit', run: () => { if (isTauri()) void useWindow((w) => w.close()); else window.close(); } },
    edit('undo', 'Undo', ['Mod+Z']),
    edit('redo', 'Redo', ['Shift+Mod+Z']),
    edit('cut', 'Cut', ['Mod+X']),
    edit('copy', 'Copy', ['Mod+C']),
    edit('paste', 'Paste', ['Mod+V']),
    edit('select-all', 'Select All', ['Mod+A']),
    soon({ id: 'find', label: 'Find...', keys: ['Mod+F'], run: () => undefined }),
    soon({ id: 'select-next', label: 'Add Next Occurrence', keys: ['Mod+D'], run: () => undefined }),
    soon({ id: 'select-all-occurrences', label: 'Select All Occurrences', keys: ['Shift+Mod+L'], run: () => undefined }),
    { id: 'command-palette', label: 'Command Palette...', keys: ['Shift+Mod+P', 'Mod+K'], run: () => palette.show() },
    { id: 'toggle-theme', label: 'Toggle Light or Dark', run: toggleTheme },
    { id: 'menus-in-window', label: 'Menus in Window', enabled: () => isTauri() && /Mac/.test(navigator.platform), checked: menusInWindow, run: () => {
      keep(MENUS_IN_WINDOW_KEY, menusInWindow() ? '0' : '1');
      toast(menusInWindow() ? 'The menus stay in the window from the next start.' : 'The menus go to the menu bar from the next start.', 'info');
    } },
    { id: 'custom-title-bar', label: 'Custom Title Bar', enabled: wantsCustomTitleBar, checked: () => captionButtons.active, run: () => { keep(CUSTOM_TITLE_KEY, captionButtons.active ? '0' : '1'); captionButtons.sync(); } },
    { id: 'zoom-in', label: 'Zoom In', keys: ['Mod+='], run: () => stepUiZoom(1) },
    { id: 'zoom-out', label: 'Zoom Out', keys: ['Mod+-'], run: () => stepUiZoom(-1) },
    { id: 'zoom-reset', label: 'Reset Zoom', keys: ['Mod+0'], enabled: () => uiZoom() !== 1, run: () => { setUiScale('1'); applyUiZoom(); } },
    soon({ id: 'go-to-file', label: 'Go to File...', keys: ['Mod+P'], run: () => undefined }),
    { id: 'next-tab', label: 'Next Tab', keys: ['Alt+Mod+Right'], enabled: () => store.docs.length > 1, run: () => stepTab(1) },
    { id: 'previous-tab', label: 'Previous Tab', keys: ['Alt+Mod+Left'], enabled: () => store.docs.length > 1, run: () => stepTab(-1) },
    soon({ id: 'run-task', label: 'Run Task...', keys: ['Shift+Mod+B'], run: () => undefined }),
    soon({ id: 'run-stop', label: 'Stop Task', run: () => undefined }),
    soon({ id: 'terminal-toggle', label: 'Toggle Terminal', keys: ['Mod+J'], run: () => undefined }),
    soon({ id: 'terminal-new', label: 'New Terminal', run: () => undefined }),
    soon({ id: 'agent-new', label: 'New Claude Code Session', keys: ['Shift+Mod+A'], run: () => undefined }),
    soon({ id: 'agent-sessions', label: 'Agent Sessions', run: () => undefined }),
    soon({ id: 'git-status', label: 'Git Status', run: () => undefined }),
    soon({ id: 'git-commit', label: 'Commit...', run: () => undefined }),
    { id: 'minimize', label: 'Minimize', keys: ['Mod+M'], enabled: isTauri, run: () => { void useWindow((w) => w.minimize()); } },
    { id: 'zoom', label: 'Zoom', enabled: isTauri, run: () => { void useWindow((w) => w.toggleMaximize()); } },
    soon({ id: 'help', label: 'Help', keys: ['F1'], run: () => undefined }),
    { id: 'about', label: 'About subform', run: () => about.show() },
    soon({ id: 'report-issue', label: 'Report an Issue...', run: () => undefined }),
  );

  const menus: MenuDef[] = [
    { label: 'File', items: ['open-folder', 'open-recent', '-', 'save', 'save-all', '-', 'close-tab', '-', 'settings', '-', 'quit'] },
    { label: 'Edit', items: ['undo', 'redo', '-', 'cut', 'copy', 'paste', '-', 'select-all', '-', 'find'] },
    { label: 'Selection', items: ['select-all', '-', 'select-next', 'select-all-occurrences'] },
    { label: 'View', items: ['command-palette', '-', 'toggle-theme', 'menus-in-window', 'custom-title-bar', '-', 'zoom-in', 'zoom-out', 'zoom-reset'] },
    { label: 'Go', items: ['go-to-file', '-', 'next-tab', 'previous-tab'] },
    { label: 'Run', items: ['run-task', 'run-stop'] },
    { label: 'Terminal', items: ['terminal-toggle', 'terminal-new'] },
    { label: 'Agents', items: ['agent-new', 'agent-sessions'] },
    { label: 'Git', items: ['git-status', 'git-commit'] },
    { label: 'Window', items: ['minimize', 'zoom'] },
    { label: 'Help', items: ['help', 'about', '-', 'report-issue'] },
  ];

  new MenuBar(q(root, '.cv-menubar'), commands, menus);
  const titleTools = new TitleTools(q(root, '.cv-titlebar'), commands);
  captionButtons = new CaptionButtons(q(root, '.cv-titlebar'), () => stored(CUSTOM_TITLE_KEY) === '1');
  new Tabs(q(root, '.cv-tab-strip'), store, (id) => { void requestClose(id); }, q(root, '.cv-tb-doc'));
  const status = new StatusBar(q(root, '.cv-status'), store);

  let native: NativeMenus | null = null;
  if (wantsNativeMenus()) {
    native = new NativeMenus(commands, () => menus);
    void native.build().catch(() => undefined);
    onLanguage(() => { void native?.build().catch(() => undefined); });
  }

  let chromeFrame = 0;
  const syncChrome = (): void => {
    if (chromeFrame) return;
    chromeFrame = requestAnimationFrame(() => {
      chromeFrame = 0;
      for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-cmd]'))) {
        const cmd = commands.get(b.dataset.cmd ?? '');
        if (!cmd) continue;
        setDisabled(b, !commands.enabled(cmd));
        const label = commands.label(cmd).replace(/\.\.\.$/, '');
        const keys = commands.keyLabel(cmd);
        const why = t(commands.why(cmd));
        setTitle(b, why || (keys ? `${t(label)} (${keys})` : t(label)));
        if (b.getAttribute('aria-label') !== t(label)) b.setAttribute('aria-label', t(label));
      }
      setHidden(empty, !!store.workspace || store.docs.length > 0);
      titleTools.sync();
      native?.refresh();
    });
  };
  for (const ev of ['workspace', 'docs', 'active', 'sessions'] as const) store.on(ev, syncChrome);
  commands.onRun = syncChrome;
  onLanguage(() => { setText(empty, t('Open a folder or a Form repository to begin')); syncChrome(); });
  syncChrome();

  root.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button[data-cmd]') : null;
    if (b && root.contains(b) && !b.disabled) commands.run(b.dataset.cmd ?? '');
  });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || anyDialogOpen()) return;
    const cmd = commands.forEvent(e);
    if (!cmd) return;
    if (TEXT_EDITS.has(cmd.id) && (textFieldFocused() || wantsNativeMenus())) return;
    if (!commands.enabled(cmd)) return;
    e.preventDefault();
    if (!e.repeat) commands.run(cmd.id);
  });

  document.addEventListener('nm:ui-settings-changed', () => {
    applyTheme(readChoice());
    applyUiPrefs(loadPrefs());
    applyUiZoom();
    syncChrome();
  });
  window.addEventListener('subform:ui-zoom', () => { applyUiZoom(); syncChrome(); });

  const refreshEngine = async (): Promise<void> => {
    try {
      const s = await systemStatus();
      status.setEngine(`Engine ${s.version}${isTauri() ? ' · desktop' : ''}`);
    } catch {
      status.setEngine('Engine offline');
    }
  };
  void refreshEngine();
  window.setInterval(() => { void refreshEngine(); }, ENGINE_POLL_MS);

  await fontsReady();
  revealApp();
}
