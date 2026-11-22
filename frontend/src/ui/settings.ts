import { formslot } from '../io/formslot';
import { git, type Identity } from '../io/git';
import { removeSecret, saveSecret, secretStatus, secretStatusText, type SecretStatus } from '../io/secrets';
import { addMcpClient, listMcpClients, removeMcpClient, type McpClient } from '../io/mcp-clients';
import { systemStatus } from '../io/api';
import { setTrusted } from '../io/trust';
import { formatKeys, type Commands } from './commands';
import { confirmAction, Dialog } from './dialogs';
import { el, patchList, q, setChecked, setClass, setHidden, setText, setTitle, setValue } from './dom';
import { icon } from './icons';
import { languages, onLanguage, setLanguage, t } from './i18n';
import { colorRow, numberRow, selectRow, sliderRow, toggleRow, type Row } from './panels/controls';
import { pickPath } from './path-picker';
import { FORMSLOT_PATH_EVENT, HIDDEN_FOLDERS_EVENT, PERMISSION_MODES, loadPrefs, savePrefs, setUiScale, UI_FONT_SIZES, UI_SCALES, uiScaleChoice, type AgentPermissionMode, type Prefs, type UiFontSize } from './prefs';
import { readChoice, setAccent, setIntensity, setTheme, THEMES, themeSwatchesHtml } from './themes';
import { toast } from './toast';

export interface SettingsContext { commands: Commands; onPrefs: (p: Prefs) => void }

const RAIL_KEY = 'formsubstrate.prefsRailCollapsed';
const API_KEY_SECRET = 'anthropic-api-key';
const OWN_KEY_PREFIX = 'formsubstrate.';
const SHARED_THEME_KEY = 'nodemode_ui_settings';
const SPY_MUTE_MS = 700;
const SCROLL_PAD = 12;
const SPY_EDGE = 24;
const WIRE_RADIUS = 10;
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

const RAIL_ICONS: Record<string, string> = {
  General: 'pfGeneral', Interface: 'pfInterface', Workspace: 'pfWorkspace', Editor: 'code', Terminal: 'terminal', Agents: 'agent',
  'Git and Identity': 'branch', formslot: 'slot', 'Language Servers': 'pfPlugins', Keys: 'pfTools', Updates: 'refresh',
};

const SECTIONS = ['General', 'Interface', 'Workspace', 'Editor', 'Terminal', 'Agents', 'Git and Identity', 'formslot', 'Language Servers', 'Keys', 'Updates'] as const;

interface KeyItem { id: string; label: string; keys: string }

const grp = (label: string, ...content: HTMLElement[]): HTMLElement => {
  const g = el('<section class="cv-prefs-group"><h3 class="cv-prefs-label"></h3></section>');
  const h = q(g, '.cv-prefs-label');
  setText(h, t(label));
  onLanguage(() => setText(h, t(label)));
  g.append(...content);
  return g;
};

const nt = (text: string): HTMLElement => {
  const p = el('<p class="cv-note"></p>');
  setText(p, t(text));
  onLanguage(() => setText(p, t(text)));
  return p;
};

const valueRow = (label: string, text: string): { el: HTMLElement; value: HTMLElement } => {
  const row = el('<div class="cv-field"><span></span><span class="cv-prefs-value"></span></div>');
  setText(q(row, 'span'), label);
  const value = q(row, '.cv-prefs-value');
  setText(value, text);
  return { el: row, value };
};

export class SettingsDialog {
  private readonly dlg: Dialog;
  private readonly ctx: SettingsContext;
  private prefs: Prefs = loadPrefs();
  private readonly sections = new Map<string, HTMLElement>();
  private readonly nav = el('<div class="cv-prefs-nav" role="tablist"></div>');
  private readonly pages = el('<div class="cv-prefs-pages"></div>');
  private readonly frame: HTMLElement;
  private readonly rail = el('<div class="cv-prefs-rail"></div>');
  private readonly port = el('<span class="cv-prefs-port" aria-hidden="true"></span>');
  private readonly shade: SVGPathElement;
  private readonly line: SVGPathElement;
  private current = '';
  private spyMuted = 0;
  private spyRaf = 0;
  private wireRaf = 0;
  private wireD = '';
  private portY = -1;

  private readonly grid = el('<div class="nm-theme-grid" role="group"></div>');
  private readonly accent: Row<string>;
  private readonly intensity: Row<number>;

  private readonly language: Row<string>;
  private readonly notice: ReturnType<typeof numberRow>;
  private readonly scale: Row<string>;
  private readonly fontSize: Row<string>;
  private readonly animations: Row<boolean>;
  private readonly largeTabs: Row<boolean>;
  private readonly themeAuto: Row<boolean>;
  private readonly themeLight: Row<string>;
  private readonly themeDark: Row<string>;
  private readonly titleBar: Row<boolean>;
  private readonly menusRow: Row<boolean>;
  private readonly windowGroup: HTMLElement;
  private readonly reopen: Row<boolean>;
  private readonly typedPaths: Row<boolean>;
  private readonly trustList = el('<div class="cv-prefs-keys"></div>');
  private readonly trustNone = el('<p class="cv-note"></p>');
  private readonly recovery: ReturnType<typeof numberRow>;
  private readonly hidden = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" aria-label="Hidden folders">');
  private readonly editorFont: ReturnType<typeof numberRow>;
  private readonly editorTab: ReturnType<typeof numberRow>;
  private readonly editorWrap: Row<boolean>;
  private readonly terminalFont: ReturnType<typeof numberRow>;
  private readonly model: Row<string>;
  private readonly permission: Row<string>;
  private readonly keyInput = el<HTMLInputElement>('<input class="cv-input" type="password" autocomplete="new-password" spellcheck="false" aria-label="Anthropic API key">');
  private readonly keyStatus = el('<p class="cv-note cv-prefs-status" role="status"></p>');
  private readonly keySave: HTMLButtonElement;
  private readonly keyRemove: HTMLButtonElement;
  private keyState: SecretStatus | null = null;
  private keyBusy = false;
  private readonly sign: Row<boolean>;
  private readonly gitName = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" maxlength="200" aria-label="Author name">');
  private readonly gitEmail = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" maxlength="200" aria-label="Author email">');
  private readonly gitKey = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" aria-label="Signing key path">');
  private readonly gitStatus = el('<p class="cv-note cv-prefs-status" role="status"></p>');
  private readonly gitSave: HTMLButtonElement;
  private gitSaved = '';
  private gitSign = false;
  private gitSource: Identity['source'] | null = null;
  private gitNote = '';
  private gitBad = false;
  private gitBusy = false;
  private gitTouched = false;
  private readonly slotEnabled: Row<boolean>;
  private readonly slotAuto: Row<boolean>;
  private readonly slotPath = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" maxlength="1024" aria-label="Checkout or binary">');
  private readonly slotBrowse = el<HTMLButtonElement>('<button class="cv-btn" type="button"></button>');
  private readonly slotFound: { el: HTMLElement; value: HTMLElement };
  private readonly keyList = el('<div class="cv-prefs-keys"></div>');
  private readonly mcpList = el('<div class="cv-prefs-keys"></div>');
  private readonly mcpNone = el('<div class="cv-prefs-keys"><div class="cv-prefs-keyrow"><span class="cv-prefs-keyname"></span><button class="cv-btn is-spacer" type="button" disabled tabindex="-1" aria-hidden="true">&nbsp;</button></div></div>');
  private readonly mcpName = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" maxlength="80">');
  private readonly mcpAdd = el<HTMLButtonElement>('<button class="cv-btn cv-btn-primary" type="button"></button>');
  private readonly mcpStatus = el('<p class="cv-note cv-prefs-status" role="status"></p>');
  private readonly mcpToken = el<HTMLInputElement>('<input class="cv-input" type="text" readonly spellcheck="false" autocomplete="off">');
  private readonly mcpFormatPick = el<HTMLSelectElement>('<select class="cv-input"><option value="json"></option><option value="toml"></option></select>');
  private readonly mcpSnippet = el<HTMLTextAreaElement>('<textarea class="cv-input cv-st-ta" wrap="off" readonly spellcheck="false"></textarea>');
  private readonly mcpCopy = el<HTMLButtonElement>('<button class="cv-btn" type="button"></button>');
  private readonly mcpCopyConfig = el<HTMLButtonElement>('<button class="cv-btn" type="button"></button>');
  private mcpClients: McpClient[] = [];
  private mcpShown = '';
  private mcpShownId = '';
  private mcpNote = '';
  private mcpBad = false;
  private mcpBusy = false;
  private readonly version: HTMLElement;

  constructor(ctx: SettingsContext) {
    this.ctx = ctx;
    this.dlg = new Dialog('Preferences', 620);
    this.frame = q(this.dlg.scrim, '.cv-dialog');

    const pick = (p: Partial<Prefs>): void => this.change(p);
    this.language = selectRow('Language', languages().map(([c, n]) => [c, n]), (v) => { pick({ language: v as Prefs['language'] }); void setLanguage(v as Prefs['language']); });
    this.notice = numberRow('Notice seconds (0 for the default)', 0, 60, 1, (v) => pick({ noticeSeconds: v }));
    this.scale = selectRow('Interface scale', UI_SCALES.map(([k, l]) => [k, l]), (v) => { setUiScale(v); });
    this.fontSize = selectRow('Interface text size', UI_FONT_SIZES.map(([k, l]) => [k, l]), (v) => pick({ uiFontSize: v as UiFontSize }));
    this.animations = toggleRow('Animations', (v) => pick({ animations: v }));
    this.largeTabs = toggleRow('Large tabs', (v) => pick({ largeTabs: v }));
    this.themeAuto = toggleRow('Follow system appearance', (v) => pick({ themeAuto: v }));
    const pair = (light: boolean): Array<[string, string]> => Object.entries(THEMES).filter(([, th]) => !!th.light === light).map(([id, th]) => [id, th.label]);
    this.themeLight = selectRow('Light theme', pair(true), (v) => pick({ themeLight: v }));
    this.themeDark = selectRow('Dark theme', pair(false), (v) => pick({ themeDark: v }));
    this.titleBar = toggleRow('Custom title bar', () => { ctx.commands.run('custom-title-bar'); this.sync(); });
    this.menusRow = toggleRow('Menus in window', () => { ctx.commands.run('menus-in-window'); this.sync(); });
    this.reopen = toggleRow('Reopen the last workspace at start', (v) => pick({ reopenLastWorkspace: v }));
    this.typedPaths = toggleRow('Allow typing absolute paths', (v) => pick({ allowTypedPaths: v }));
    setText(this.trustNone, t('No workspace is trusted.'));
    this.trustList.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-revoke]') : null;
      if (!b?.dataset.revoke) return;
      setTrusted(b.dataset.revoke, false);
      this.prefs = loadPrefs();
      this.sync();
    });
    this.recovery = numberRow('Recovery save every (minutes)', 1, 60, 1, (v) => pick({ recoveryMinutes: v }));
    this.editorFont = numberRow('Font size', 8, 32, 1, (v) => pick({ editorFontSize: v }));
    this.editorTab = numberRow('Tab size', 1, 8, 1, (v) => pick({ editorTabSize: v }));
    this.editorWrap = toggleRow('Word wrap', (v) => pick({ editorWordWrap: v }));
    this.terminalFont = numberRow('Font size', 8, 32, 1, (v) => pick({ terminalFontSize: v }));
    this.model = selectRow('Default model', [['', 'Choose when starting'], ...MODELS.map((m): [string, string] => [m, m])], (v) => pick({ agentDefaultModel: v }));
    this.permission = selectRow('Headless permission mode', PERMISSION_MODES.map(([k, l]): [string, string] => [k, l]), (v) => pick({ agentPermissionMode: v as AgentPermissionMode }));
    this.sign = toggleRow('Sign commits', (v) => { this.gitSign = v; this.touchGit(); });
    this.slotEnabled = toggleRow('Enabled', (v) => pick({ formslotEnabled: v }));
    this.slotAuto = toggleRow('Start automatically', (v) => pick({ formslotAutoStart: v }));
    this.slotFound = valueRow(t('Found at'), t('Not found'));
    this.slotPath.addEventListener('change', () => pick({ formslotPath: this.slotPath.value.trim().slice(0, 1024) }));
    this.slotPath.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.slotPath.blur(); } });
    this.slotBrowse.addEventListener('click', () => {
      void pickPath('folder').then((path) => {
        if (!path) return;
        setValue(this.slotPath, path);
        pick({ formslotPath: path.slice(0, 1024) });
      });
    });
    this.accent = colorRow('Accent colour', (hex) => { setAccent(hex); this.sync(); });
    this.intensity = sliderRow('Accent intensity', 0, 1.5, 0.05, (v) => setIntensity(v), { def: 1 });
    this.windowGroup = grp('Window', this.titleBar.el, this.menusRow.el, nt('The custom title bar and the menus in the window change from the next start where they apply.'));

    this.hidden.addEventListener('change', () => pick({ hiddenFolders: this.hidden.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) }));

    const swatches = document.createElement('template');
    swatches.innerHTML = themeSwatchesHtml();
    this.grid.append(swatches.content);
    this.grid.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-theme-id]') : null;
      if (!b?.dataset.themeId) return;
      setTheme(b.dataset.themeId);
      this.sync();
    });
    this.grid.addEventListener('contextmenu', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-theme-id]') : null;
      if (!b?.dataset.themeId) return;
      e.preventDefault();
      const id = b.dataset.themeId, cur = this.prefs.favouriteThemes;
      pick({ favouriteThemes: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
      this.sync();
    });

    this.keySave = el<HTMLButtonElement>('<button class="cv-btn cv-btn-primary" type="button"></button>');
    this.keyRemove = el<HTMLButtonElement>('<button class="cv-btn cv-btn-danger" type="button"></button>');
    setText(this.keySave, t('Save'));
    setText(this.keyRemove, t('Remove'));
    this.keySave.addEventListener('click', () => { void this.storeKey(); });
    this.keyRemove.addEventListener('click', () => { void this.dropKey(); });
    this.gitSave = el<HTMLButtonElement>('<button class="cv-btn cv-btn-primary" type="button"></button>');
    setText(this.gitSave, t('Save'));
    this.gitSave.addEventListener('click', () => { void this.saveIdentity(); });
    for (const input of [this.gitName, this.gitEmail, this.gitKey]) {
      input.addEventListener('input', () => this.touchGit());
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.gitSave.click(); } });
    }
    this.keyInput.addEventListener('input', () => this.paintKey());
    this.keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.keySave.click(); } });
    const versionRow = valueRow('Current version', '');
    this.version = versionRow.value;

    const content: Record<(typeof SECTIONS)[number], HTMLElement[]> = {
      General: [
        grp('Language', this.language.el),
        grp('Notices', this.notice.el),
      ],
      Interface: [
        grp('Theme', this.grid, this.accent.el, this.intensity.el),
        grp('Appearance', this.themeAuto.el, this.themeLight.el, this.themeDark.el),
        grp('Text and Scale', this.scale.el, this.fontSize.el),
        grp('Motion and Tabs', this.animations.el, this.largeTabs.el),
        this.windowGroup,
      ],
      Workspace: [
        grp('Startup', this.reopen.el, this.recovery.el),
        grp('Folders and files', this.typedPaths.el, nt('Off by default. Open Folder and Open File use the pickers; turning this on also shows a field for typing an absolute path.')),
        grp('Trusted workspaces', this.trustList, this.trustNone, nt('A trusted workspace may run its own language servers and its Python environment. Revoke to stop.')),
        grp('Hidden folders', this.hiddenRow(), nt('Folder names separated by commas stay out of the file tree.')),
      ],
      Editor: [grp('Text', this.editorFont.el, this.editorTab.el, this.editorWrap.el)],
      Terminal: [grp('Text', this.terminalFont.el)],
      Agents: [
        grp('Claude Code', this.model.el, this.permission.el, nt('Headless sessions run without a person to approve tools. Accept edits lets them change files inside their own worktree only; Bash and other tools are denied. Interactive terminal sessions are not affected.')),
        grp('Anthropic API key', this.keyRow(), this.keyStatus, nt('The key goes to the engine and is kept in the system keychain, or in a file only you can read when this computer has no keychain. This page never reads it back, and opening it does not touch the keychain.')),
        this.mcpCard(),
      ],
      'Git and Identity': [
        grp('Commits', this.fieldRow('Author name', this.gitName), this.fieldRow('Author email', this.gitEmail), this.sign.el, this.fieldRow('Signing key path', this.gitKey), this.gitActions(), this.gitStatus, nt('Every commit made from Substrate, by you or by an agent session, uses this name and email. Signing uses the SSH public key at the path; the private key is never read or stored here.')),
      ],
      formslot: [
        grp('Service', this.slotEnabled.el, this.slotAuto.el, valueRow('Service status', t('Not running')).el),
        grp('Location', this.pathRow(), this.slotFound.el, nt('The folder you unpacked formslot into, or the formslot program itself. Home uses it to install formslot when none is found.')),
      ],
      'Language Servers': [grp('Servers', nt('Language servers are found on this system and used when they are installed.'))],
      Keys: [grp('Shortcuts', this.keyList, nt('Shortcuts can be changed in a later version.'))],
      Updates: [grp('Version', versionRow.el, nt('Updates come through FormPortal.'))],
    };
    for (const name of SECTIONS) this.add(name, ...content[name]);

    const wrap = el('<div class="cv-prefs"></div>');
    wrap.append(this.pages);
    this.dlg.body.appendChild(wrap);
    this.frame.classList.add('cv-prefs-dlg');
    q(this.dlg.scrim, '.cv-dialog-head').prepend(el(`<span class="cv-prefs-headicon">${icon('settings', 16)}</span>`));

    let collapsed = false;
    try { collapsed = localStorage.getItem(RAIL_KEY) === '1'; } catch { collapsed = false; }
    const fold = el<HTMLButtonElement>(`<button class="cv-prefs-fold" type="button">${icon('pfFold', 16)}</button>`);
    const paintRail = (): void => {
      setClass(this.frame, 'is-rail-collapsed', collapsed);
      const label = t(collapsed ? 'Expand tabs' : 'Collapse tabs');
      setTitle(fold, label);
      fold.setAttribute('aria-label', label);
      fold.setAttribute('aria-expanded', String(!collapsed));
    };
    fold.addEventListener('click', () => {
      collapsed = !collapsed;
      try { localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0'); } catch { paintRail(); }
      paintRail();
      this.queueWire();
    });
    paintRail();
    onLanguage(paintRail);
    this.rail.append(this.nav, fold);
    const wire = el('<svg class="cv-prefs-wire" aria-hidden="true"><path class="cv-prefs-wire-shade"></path><path class="cv-prefs-wire-line"></path></svg>');
    this.shade = q<SVGPathElement>(wire, '.cv-prefs-wire-shade');
    this.line = q<SVGPathElement>(wire, '.cv-prefs-wire-line');
    this.frame.append(this.rail, wire, this.port);

    this.pages.addEventListener('scroll', () => this.queueSpy(), { passive: true });
    new ResizeObserver(() => this.queueWire()).observe(this.frame);
    window.addEventListener('resize', () => this.queueWire());
    document.addEventListener('nm:ui-settings-changed', () => { if (this.dlg.isOpen) this.sync(); });
    document.addEventListener('formsubstrate:open-settings', (e) => { this.open(e instanceof CustomEvent && typeof e.detail?.section === 'string' ? e.detail.section : undefined); });

    const reset = this.dlg.button('Reset', 'danger', () => { void this.reset(); });
    reset.classList.add('cv-btn-apart');
    this.dlg.button('Done', 'primary', () => this.dlg.close());
    this.markSection('General');
  }

  open(section?: string): void {
    this.prefs = loadPrefs();
    this.sync();
    const name = section && this.sections.has(section) ? section : this.current || 'General';
    this.markSection(name);
    const tab = this.nav.querySelector<HTMLElement>(`[data-section="${name}"]`);
    this.dlg.open(tab);
    this.scrollToSection(name, 'auto');
    this.queueWire();
    void this.refreshRemote();
  }

  close(): void { this.dlg.close(); }

  get isOpen(): boolean { return this.dlg.isOpen; }

  private hiddenRow(): HTMLElement {
    const row = el('<label class="cv-field"><span></span></label>');
    setText(q(row, 'span'), t('Folders to hide'));
    row.appendChild(this.hidden);
    return row;
  }

  private fieldRow(label: string, input: HTMLInputElement): HTMLElement {
    const row = el('<label class="cv-field"><span></span></label>');
    setText(q(row, 'span'), t(label));
    onLanguage(() => setText(q(row, 'span'), t(label)));
    row.appendChild(input);
    return row;
  }

  private gitActions(): HTMLElement {
    const actions = el('<div class="cv-prefs-actions"></div>');
    actions.append(this.gitSave);
    return actions;
  }

  private keyRow(): HTMLElement {
    const wrap = el('<div class="cv-prefs-secret"></div>');
    const row = el('<label class="cv-field"><span></span></label>');
    setText(q(row, 'span'), t('Key'));
    row.appendChild(this.keyInput);
    const actions = el('<div class="cv-prefs-actions"></div>');
    actions.append(this.keySave, this.keyRemove);
    wrap.append(row, actions);
    return wrap;
  }

  private add(name: string, ...content: HTMLElement[]): void {
    const iconName = RAIL_ICONS[name] ?? 'pfGeneral';
    const tab = el<HTMLButtonElement>(`<button class="cv-prefs-railtab" type="button" role="tab" aria-selected="false"><span class="cv-prefs-tabicon">${icon(iconName, 18)}</span><span class="cv-prefs-tablabel"></span></button>`);
    tab.dataset.section = name;
    const label = q(tab, '.cv-prefs-tablabel');
    const paint = (): void => { setText(label, t(name)); setTitle(tab, t(name)); };
    paint();
    onLanguage(paint);
    tab.addEventListener('click', () => this.showSection(name, 'smooth'));
    this.nav.appendChild(tab);

    const page = el(`<section class="cv-prefs-page cv-prefs-sec" role="tabpanel"><button class="cv-prefs-sechead" type="button" aria-expanded="true"><span class="cv-prefs-secicon">${icon(iconName, 16)}</span><span class="cv-prefs-seclabel"></span><span class="cv-prefs-chev">${icon('chevronDown', 14)}</span></button><div class="cv-prefs-secbody"></div></section>`);
    page.dataset.section = name;
    const headLabel = q(page, '.cv-prefs-seclabel');
    const paintHead = (): void => setText(headLabel, t(name));
    paintHead();
    onLanguage(paintHead);
    q(page, '.cv-prefs-sechead').addEventListener('click', () => this.foldSection(name));
    q(page, '.cv-prefs-secbody').append(...content);
    this.pages.appendChild(page);
    this.sections.set(name, page);
  }

  private change(patch: Partial<Prefs>): void {
    savePrefs({ ...loadPrefs(), ...patch });
    this.prefs = loadPrefs();
    this.ctx.onPrefs(this.prefs);
    if (patch.hiddenFolders) document.dispatchEvent(new CustomEvent(HIDDEN_FOLDERS_EVENT));
    if (patch.formslotPath !== undefined) document.dispatchEvent(new CustomEvent(FORMSLOT_PATH_EVENT));
  }

  private pathRow(): HTMLElement {
    const wrap = el('<div class="cv-prefs-secret"></div>');
    const actions = el('<div class="cv-prefs-actions"></div>');
    setText(this.slotBrowse, t('Browse'));
    onLanguage(() => setText(this.slotBrowse, t('Browse')));
    actions.append(this.slotBrowse);
    wrap.append(this.fieldRow('Checkout or binary', this.slotPath), actions);
    return wrap;
  }

  private async paintFound(): Promise<void> {
    let found = '';
    try { found = (await formslot.onboard()).binary ?? ''; } catch { found = ''; }
    setText(this.slotFound.value, found || t('Not found'));
    setTitle(this.slotFound.value, found);
  }

  private showSection(name: string, scroll: ScrollBehavior | null): void {
    if (!this.sections.has(name)) return;
    this.markSection(name);
    if (scroll) this.scrollToSection(name, scroll);
  }

  private markSection(name: string): void {
    if (this.current === name) return;
    this.current = name;
    for (const [n, page] of this.sections) setClass(page, 'is-current', n === name);
    for (const tab of Array.from(this.nav.children) as HTMLElement[]) {
      const on = tab.dataset.section === name;
      setClass(tab, 'is-active', on);
      const sel = String(on);
      if (tab.getAttribute('aria-selected') !== sel) tab.setAttribute('aria-selected', sel);
    }
    this.queueWire();
  }

  private scrollToSection(name: string, behavior: ScrollBehavior): void {
    const sec = this.sections.get(name);
    if (!sec) return;
    if (sec.classList.contains('is-folded')) this.foldSection(name);
    const top = sec.getBoundingClientRect().top - this.pages.getBoundingClientRect().top + this.pages.scrollTop - SCROLL_PAD;
    this.spyMuted = performance.now() + SPY_MUTE_MS;
    this.pages.scrollTo({ top, behavior });
  }

  private foldSection(name: string): void {
    const sec = this.sections.get(name);
    if (!sec) return;
    const folded = !sec.classList.contains('is-folded');
    setClass(sec, 'is-folded', folded);
    setHidden(q(sec, '.cv-prefs-secbody'), folded);
    q(sec, '.cv-prefs-sechead').setAttribute('aria-expanded', String(!folded));
    this.queueWire();
    this.queueSpy();
  }

  private queueSpy(): void {
    if (this.spyRaf) return;
    this.spyRaf = requestAnimationFrame(() => {
      this.spyRaf = 0;
      const pages = this.pages;
      if (!pages.clientHeight || performance.now() < this.spyMuted) return;
      const edge = pages.getBoundingClientRect().top + SPY_EDGE;
      const names = Array.from(this.sections.keys());
      let best = '', bestD = Infinity;
      if (pages.scrollHeight > pages.clientHeight + 4 && pages.scrollTop + pages.clientHeight >= pages.scrollHeight - 2) best = names[names.length - 1] ?? '';
      else {
        for (const [n, sec] of this.sections) {
          const top = sec.getBoundingClientRect().top, d = top <= edge ? edge - top : top - edge + 100000;
          if (d < bestD) { bestD = d; best = n; }
        }
      }
      if (best) this.markSection(best);
    });
  }

  private queueWire(): void {
    if (this.wireRaf) return;
    this.wireRaf = requestAnimationFrame(() => { this.wireRaf = 0; this.drawWire(); });
  }

  private drawWire(): void {
    if (this.dlg.scrim.hidden) return;
    const F = this.frame.getBoundingClientRect();
    const tab = this.nav.querySelector<HTMLElement>('.cv-prefs-railtab.is-active');
    const head = this.frame.querySelector<HTMLElement>('.cv-dialog-head');
    if (!F.width || !tab || !head) return;
    const N = this.nav.getBoundingClientRect();
    let T = tab.getBoundingClientRect();
    if (T.top < N.top || T.bottom > N.bottom) {
      this.nav.scrollTop += T.top < N.top ? T.top - N.top - 6 : T.bottom - N.bottom + 6;
      T = tab.getBoundingClientRect();
    }
    const R = this.rail.getBoundingClientRect(), H = head.getBoundingClientRect();
    const portY = Math.round(H.bottom - F.top), sx = Math.round(T.right - F.left), ty = Math.round(T.top - F.top + T.height / 2);
    const rr = R.right - F.left, trunk = Math.round(rr - rr * 0.45), dy = portY - ty, r = WIRE_RADIUS, dir = dy > 0 ? 1 : -1;
    const d = Math.abs(dy) < 2 * r
      ? `M ${sx} ${ty} H ${trunk} V ${portY} H -7`
      : `M ${sx} ${ty} H ${trunk - r} a ${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${r} ${dir * r} V ${portY - dir * r} a ${r} ${r} 0 0 ${dir > 0 ? 0 : 1} ${r} ${dir * r} H -7`;
    if (d !== this.wireD) { this.wireD = d; this.shade.setAttribute('d', d); this.line.setAttribute('d', d); }
    if (portY !== this.portY) { this.portY = portY; this.port.style.transform = `translateY(${portY}px)`; }
  }

  private sync(): void {
    const p = this.prefs;
    this.language.set(p.language);
    this.notice.set(p.noticeSeconds);
    this.scale.set(uiScaleChoice());
    this.fontSize.set(p.uiFontSize);
    this.animations.set(p.animations);
    this.largeTabs.set(p.largeTabs);
    this.themeAuto.set(p.themeAuto);
    this.themeLight.set(p.themeLight);
    this.themeDark.set(p.themeDark);
    this.reopen.set(p.reopenLastWorkspace);
    this.typedPaths.set(p.allowTypedPaths);
    const paintTrust = (node: HTMLElement, path: string): void => { setText(q(node, '.cv-prefs-keyname'), path); setTitle(q(node, '[data-revoke]'), t('Revoke')); q(node, '[data-revoke]').dataset.revoke = path; };
    patchList(this.trustList, p.trustedWorkspaces, {
      key: (path) => path,
      create: (path) => { const node = el(`<div class="cv-prefs-keyrow"><span class="cv-prefs-keyname"></span><button class="cv-btn cv-btn-danger" type="button" data-revoke="">${t('Revoke')}</button></div>`); paintTrust(node, path); return node; },
      update: paintTrust,
    });
    setHidden(this.trustNone, p.trustedWorkspaces.length > 0);
    this.recovery.set(p.recoveryMinutes);
    setValue(this.hidden, p.hiddenFolders.join(', '));
    this.editorFont.set(p.editorFontSize);
    this.editorTab.set(p.editorTabSize);
    this.editorWrap.set(p.editorWordWrap);
    this.terminalFont.set(p.terminalFontSize);
    this.model.set(p.agentDefaultModel);
    this.permission.set(p.agentPermissionMode);
    this.slotEnabled.set(p.formslotEnabled);
    this.slotAuto.set(p.formslotAutoStart);
    if (document.activeElement !== this.slotPath) setValue(this.slotPath, p.formslotPath);

    const c = readChoice();
    this.accent.set(c.accentColor);
    this.intensity.set(c.intensity ?? 1);
    for (const b of Array.from(this.grid.querySelectorAll<HTMLElement>('[data-theme-id]'))) {
      const id = b.dataset.themeId ?? '';
      const active = id === c.theme, fav = p.favouriteThemes.includes(id);
      setClass(b, 'is-active', active);
      setClass(b, 'is-fav', fav);
      const order = fav ? '-1' : '0';
      if (b.style.order !== order) b.style.order = order;
      const label = THEMES[id]?.label ?? id;
      setTitle(b, fav ? `${label} (${t('favourite, right-click to remove')})` : `${label} (${t('right-click to add to favourites')})`);
      const border = active ? c.accentColor : THEMES[id]?.vars['--border-color'] ?? '';
      if (b.dataset.border !== border) { b.dataset.border = border; b.style.borderColor = border; }
    }

    const tb = this.ctx.commands.get('custom-title-bar'), mw = this.ctx.commands.get('menus-in-window');
    const tbOn = !!tb && this.ctx.commands.enabled(tb), mwOn = !!mw && this.ctx.commands.enabled(mw);
    setHidden(this.titleBar.el, !tbOn);
    setHidden(this.menusRow.el, !mwOn);
    setHidden(this.windowGroup, !tbOn && !mwOn);
    this.titleBar.set(!!tb?.checked?.());
    this.menusRow.set(!!mw?.checked?.());

    const items: KeyItem[] = this.ctx.commands.all().filter((cmd) => cmd.keys && cmd.keys.length > 0).map((cmd) => ({
      id: cmd.id, label: this.ctx.commands.label(cmd).replace(/\.\.\.$/, ''), keys: (cmd.keys ?? []).map(formatKeys).join('  ·  '),
    }));
    const paintKeyRow = (node: HTMLElement, i: KeyItem): void => { setText(q(node, '.cv-prefs-keyname'), t(i.label)); setText(q(node, '.cv-prefs-keycombo'), i.keys); };
    patchList(this.keyList, items, {
      key: (i) => i.id,
      create: (i) => { const node = el('<div class="cv-prefs-keyrow"><span class="cv-prefs-keyname"></span><span class="cv-prefs-keycombo"></span></div>'); paintKeyRow(node, i); return node; },
      update: paintKeyRow,
    });
    this.paintKey();
  }

  private gitValues(): Omit<Identity, 'source'> {
    return { name: this.gitName.value.trim(), email: this.gitEmail.value.trim(), sign: this.gitSign, signingKey: this.gitKey.value.trim() };
  }

  private touchGit(): void {
    this.gitTouched = true;
    this.gitNote = '';
    this.gitBad = false;
    this.paintGit();
  }

  private paintGit(): void {
    const v = this.gitValues();
    let problem = '';
    if (!v.name) problem = 'Enter the name commits are made with.';
    else if (!v.email.includes('@')) problem = 'The email needs an @.';
    else if (v.sign && !v.signingKey) problem = 'Signing needs the path to a .pub key file.';
    const clean = JSON.stringify(v) === this.gitSaved && this.gitSource === 'formsubstrate';
    let note = this.gitNote;
    if (!note && this.gitSource === 'git' && !this.gitTouched) note = 'Read from your global git config. Save keeps it in Substrate.';
    if (!note && this.gitSource === 'none' && !this.gitTouched) note = 'No identity is set yet. Commits are refused until you save one.';
    if (!note && this.gitTouched && problem) note = problem;
    setText(this.gitStatus, note ? t(note) : '');
    setClass(this.gitStatus, 'is-error', this.gitBad || (!this.gitNote && this.gitTouched && !!problem));
    const off = this.gitBusy || clean || !!problem;
    if (this.gitSave.disabled !== off) this.gitSave.disabled = off;
  }

  private applyGit(id: Identity): void {
    setValue(this.gitName, id.name);
    setValue(this.gitEmail, id.email);
    setValue(this.gitKey, id.signingKey);
    this.sign.set(id.sign);
    this.gitSign = id.sign;
    this.gitSource = id.source;
    this.gitSaved = JSON.stringify({ name: id.name, email: id.email, sign: id.sign, signingKey: id.signingKey });
    this.gitTouched = false;
  }

  private async loadGit(): Promise<void> {
    try {
      const id = await git.identity();
      if (!this.gitTouched) { this.gitNote = ''; this.gitBad = false; this.applyGit(id); }
    } catch (e) {
      this.gitNote = e instanceof Error ? e.message : 'The engine is not answering.';
      this.gitBad = true;
    }
    this.paintGit();
  }

  private async saveIdentity(): Promise<void> {
    if (this.gitBusy) return;
    this.gitBusy = true;
    this.paintGit();
    try {
      const id = await git.setIdentity(this.gitValues());
      this.applyGit(id);
      this.gitNote = 'Saved.';
      this.gitBad = false;
      document.dispatchEvent(new CustomEvent('formsubstrate:identity-changed'));
    } catch (e) {
      this.gitNote = e instanceof Error ? e.message : 'The identity was not saved.';
      this.gitBad = true;
    } finally {
      this.gitBusy = false;
      this.paintGit();
    }
  }

  private async refreshRemote(): Promise<void> {
    this.forgetMcpToken();
    void this.loadMcp();
    this.gitTouched = false;
    void this.loadGit();
    void this.paintFound();
    try {
      const s = await systemStatus();
      setText(this.version, s.version);
    } catch {
      setText(this.version, t('Engine offline'));
    }
    try {
      this.keyState = await secretStatus(API_KEY_SECRET);
      this.keyNote = '';
    } catch (e) {
      this.keyState = null;
      this.keyNote = /^503/.test(e instanceof Error ? e.message : '') ? 'The system keychain is not available.' : 'The engine is not answering.';
    }
    this.paintKey();
  }

  private keyNote = '';

  private paintKey(): void {
    const typed = this.keyInput.value.length > 0;
    const s = this.keyState;
    const unknownNote = s?.state === 'unknown' ? `. ${t('Save the key again or remove it to settle this.')}` : '';
    setText(this.keyStatus, this.keyNote ? t(this.keyNote) : s === null ? '' : `${t(secretStatusText(s))}${unknownNote}`);
    const save = this.keySave, remove = this.keyRemove;
    const off = (b: HTMLButtonElement, v: boolean): void => { if (b.disabled !== v) b.disabled = v; };
    off(save, !typed || this.keyBusy || s === null && !!this.keyNote);
    off(remove, s === null || s.state === 'absent' || this.keyBusy);
  }

  private async storeKey(): Promise<void> {
    const value = this.keyInput.value.trim();
    if (!value || this.keyBusy) return;
    this.keyBusy = true;
    this.paintKey();
    try {
      this.keyState = await saveSecret(API_KEY_SECRET, value);
      this.keyInput.value = '';
      this.keyNote = '';
    } catch (e) {
      toast(`${t('The key was not saved')}: ${e instanceof Error ? e.message : ''}`, 'error');
    } finally {
      this.keyBusy = false;
      this.paintKey();
    }
  }

  private async dropKey(): Promise<void> {
    if (this.keyBusy) return;
    this.keyBusy = true;
    this.paintKey();
    try {
      await removeSecret(API_KEY_SECRET);
      this.keyState = { present: false, state: 'absent', store: null };
      this.keyNote = '';
    } catch (e) {
      toast(`${t('The key was not removed')}: ${e instanceof Error ? e.message : ''}`, 'error');
    } finally {
      this.keyBusy = false;
      this.paintKey();
    }
  }

  private mcpCard(): HTMLElement {
    const labelled = (label: string, control: HTMLElement): HTMLElement => {
      const row = el('<label class="cv-field"><span></span></label>');
      setText(q(row, 'span'), t(label));
      onLanguage(() => setText(q(row, 'span'), t(label)));
      row.appendChild(control);
      return row;
    };
    const labels = (): void => {
      setText(q(this.mcpNone, '.cv-prefs-keyname'), t('No client is approved yet.'));
      this.mcpName.setAttribute('aria-label', t('Client name'));
      this.mcpName.placeholder = t('For example Claude Code in my terminal');
      setText(this.mcpAdd, t('Add client'));
      this.mcpToken.setAttribute('aria-label', t('Token'));
      this.mcpToken.placeholder = t('The token appears here once, after Add client.');
      setText(this.mcpFormatPick.options[0], t('Claude Code and Cursor (JSON)'));
      setText(this.mcpFormatPick.options[1], t('Codex (TOML)'));
      this.mcpSnippet.setAttribute('aria-label', t('Config snippet'));
      setText(this.mcpCopy, t('Copy token'));
      setText(this.mcpCopyConfig, t('Copy config'));
      this.paintMcp();
    };
    this.mcpAdd.addEventListener('click', () => { void this.addMcp(); });
    this.mcpName.addEventListener('input', () => this.paintMcp());
    this.mcpName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.mcpAdd.click(); } });
    this.mcpFormatPick.addEventListener('change', () => this.paintMcp());
    this.mcpCopy.addEventListener('click', () => this.copyMcp(this.mcpShown));
    this.mcpCopyConfig.addEventListener('click', () => this.copyMcp(this.mcpSnippet.value));
    this.mcpList.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-remove]') : null;
      if (b?.dataset.remove) void this.removeMcp(b.dataset.remove);
    });
    const addActions = el('<div class="cv-prefs-actions"></div>');
    addActions.append(this.mcpAdd);
    const copyActions = el('<div class="cv-prefs-actions"></div>');
    copyActions.append(this.mcpCopy, this.mcpCopyConfig);
    const card = grp('MCP clients', this.mcpList, this.mcpNone, this.fieldRow('Client name', this.mcpName), addActions, this.mcpStatus, this.fieldRow('Token', this.mcpToken), labelled('Config for', this.mcpFormatPick), labelled('Config snippet', this.mcpSnippet), copyActions,
      nt('Programs outside Substrate, such as Claude Code, Codex or Cursor, reach its MCP server with a token you approve here. A client may read the open workspace, the session list and the status of a session; it cannot write, comment, answer gates or read terminals. The token is shown once and leaves this page when you move away from this card. From a source checkout the command is ./formsubstrate with the argument mcp; in the built app it is the formsubstrate-engine program, by its full path, with --mcp.'));
    labels();
    onLanguage(labels);
    new IntersectionObserver((entries) => { if (entries.some((x) => !x.isIntersecting)) this.forgetMcpToken(); }, { root: this.pages }).observe(card);
    return card;
  }

  private mcpConfig(): string {
    const token = this.mcpShown || '<token>';
    const desktop = !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const [command, arg] = desktop ? ['formsubstrate-engine', '--mcp'] : ['./formsubstrate', 'mcp'];
    if (this.mcpFormatPick.value === 'toml') return `[mcp_servers.formsubstrate]\ncommand = "${command}"\nargs = ["${arg}"]\nenv = { FORMSUBSTRATE_MCP_TOKEN = "${token}" }`;
    return `{"mcpServers": {"formsubstrate": {\n  "command": "${command}",\n  "args": ["${arg}"],\n  "env": {"FORMSUBSTRATE_MCP_TOKEN": "${token}"}\n}}}`;
  }

  private paintMcp(): void {
    const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
    const paintRow = (node: HTMLElement, c: McpClient): void => {
      setText(q(node, '.cv-prefs-keyname'), c.name);
      setText(q(node, '.cv-prefs-keycombo'), `${t('Added')} ${when(c.created)}  ·  ${c.lastUsed ? `${t('Last used')} ${when(c.lastUsed)}` : t('Not used yet')}`);
      const b = q(node, '[data-remove]');
      setText(b, t('Remove'));
      if (b.dataset.remove !== c.id) b.dataset.remove = c.id;
    };
    patchList(this.mcpList, this.mcpClients, {
      key: (c) => c.id,
      create: (c) => { const node = el('<div class="cv-prefs-keyrow"><span class="cv-prefs-keyname"></span><span class="cv-prefs-keycombo"></span><button class="cv-btn cv-btn-danger" type="button" data-remove=""></button></div>'); paintRow(node, c); return node; },
      update: paintRow,
    });
    setHidden(this.mcpNone, this.mcpClients.length > 0);
    setHidden(this.mcpList, this.mcpClients.length === 0);
    setText(this.mcpStatus, this.mcpNote || ' ');
    setClass(this.mcpStatus, 'is-error', this.mcpBad);
    if (this.mcpToken.value !== this.mcpShown) this.mcpToken.value = this.mcpShown;
    const config = this.mcpConfig();
    if (this.mcpSnippet.value !== config) this.mcpSnippet.value = config;
    const off = (b: HTMLButtonElement, v: boolean): void => { if (b.disabled !== v) b.disabled = v; };
    off(this.mcpAdd, this.mcpBusy || !this.mcpName.value.trim());
    off(this.mcpCopy, !this.mcpShown);
  }

  private forgetMcpToken(): void {
    if (!this.mcpShown) return;
    this.mcpShown = '';
    this.mcpShownId = '';
    if (!this.mcpBad) this.mcpNote = '';
    this.paintMcp();
  }

  private copyMcp(text: string): void {
    void navigator.clipboard.writeText(text).then(() => toast(t('Copied')), () => toast(t('Copy failed'), 'error'));
  }

  private async loadMcp(): Promise<void> {
    try {
      this.mcpClients = await listMcpClients();
      if (this.mcpBad) { this.mcpNote = ''; this.mcpBad = false; }
    } catch (e) {
      this.mcpNote = `${t('The client list was not read')}: ${e instanceof Error ? e.message : ''}`;
      this.mcpBad = true;
    }
    this.paintMcp();
  }

  private async addMcp(): Promise<void> {
    const name = this.mcpName.value.trim();
    if (!name || this.mcpBusy) return;
    this.forgetMcpToken();
    this.mcpBusy = true;
    this.paintMcp();
    try {
      const made = await addMcpClient(name);
      this.mcpClients = [...this.mcpClients.filter((c) => c.id !== made.client.id), made.client];
      this.mcpShown = made.token;
      this.mcpShownId = made.client.id;
      this.mcpName.value = '';
      this.mcpNote = t('Copy the token now: Substrate shows it only this once.');
      this.mcpBad = false;
    } catch (e) {
      this.mcpNote = `${t('The client was not added')}: ${e instanceof Error ? e.message : ''}`;
      this.mcpBad = true;
    } finally {
      this.mcpBusy = false;
      this.paintMcp();
    }
  }

  private async removeMcp(id: string): Promise<void> {
    const item = this.mcpClients.find((c) => c.id === id);
    if (!item || this.mcpBusy) return;
    const ok = await confirmAction(t('Remove this MCP client?'), `${item.name}: ${t('its token stops working at once. Add the client again to give it a new token.')}`, t('Remove'), true);
    if (!ok) return;
    this.mcpBusy = true;
    this.paintMcp();
    try {
      await removeMcpClient(id);
      this.mcpClients = this.mcpClients.filter((c) => c.id !== id);
      if (this.mcpShownId === id) { this.mcpShown = ''; this.mcpShownId = ''; }
      this.mcpNote = t('Removed. Its token no longer works.');
      this.mcpBad = false;
    } catch (e) {
      this.mcpNote = `${t('The client was not removed')}: ${e instanceof Error ? e.message : ''}`;
      this.mcpBad = true;
    } finally {
      this.mcpBusy = false;
      this.paintMcp();
    }
  }

  private async reset(): Promise<void> {
    const ok = await confirmAction('Reset all preferences?', t('Every preference and the theme go back to how Substrate comes. Your files are kept. Substrate reloads.'), 'Reset', true);
    if (!ok) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k.startsWith(OWN_KEY_PREFIX) || k === SHARED_THEME_KEY)) keys.push(k); }
      for (const k of keys) localStorage.removeItem(k);
    } catch {
      toast(t('The preferences could not be reset.'), 'error');
      return;
    }
    location.reload();
  }
}
