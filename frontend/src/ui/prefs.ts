import { THEMES, readChoice, setTheme } from './themes';
import { isLang, LANG_CODES, type Lang } from './i18n/langs';

export type UiFontSize = 'small' | 'default' | 'large' | 'larger';
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'plan';
export const PERMISSION_MODES: ReadonlyArray<readonly [AgentPermissionMode, string]> = [['acceptEdits', 'Accept edits'], ['default', 'Ask (default)'], ['plan', 'Plan only']];
export const PERMISSION_MODE_NOTES: Record<AgentPermissionMode, string> = {
  acceptEdits: 'File edits inside the worktree are accepted. Shell and other tools are denied, because a headless session cannot be asked.',
  default: 'Every edit and tool needs approval, which a headless session cannot give, so they are denied.',
  plan: 'The agent plans and reads only; nothing is changed.',
};
export type ToolOptionValue = string | number | boolean;
export type DialogValue = string | boolean;

export interface Prefs {
  language: Lang;
  uiFontSize: UiFontSize;
  animations: boolean;
  showTooltips: boolean;
  noticeSeconds: number;
  autoShowHome: boolean;
  homeOnLastClose: boolean;
  whatsNewAuto: boolean;
  whatsNewSeen: string;
  favouriteThemes: string[];
  themeAuto: boolean;
  themeLight: string;
  themeDark: string;
  shortcuts: Record<string, string[]>;
  shortcutSets: Record<string, Record<string, string[]>>;
  menuHidden: string[];
  menuColors: Record<string, string>;
  dialogValues: Record<string, Record<string, DialogValue>>;
  editorFontSize: number;
  editorTabSize: number;
  editorWordWrap: boolean;
  terminalFontSize: number;
  terminalDockHeight: number;
  agentDefaultModel: string;
  agentPermissionMode: AgentPermissionMode;
  formslotEnabled: boolean;
  formslotAutoStart: boolean;
  formslotPath: string;
  gitSignOnCommit: boolean;
  recoveryMinutes: number;
  largeTabs: boolean;
  reopenLastWorkspace: boolean;
  hiddenFolders: string[];
  allowTypedPaths: boolean;
  trustedWorkspaces: string[];
  trustAsked: string[];
  sidebarWidth: number;
  prefsRevision: number;
}

export const MENU_COLORS: readonly string[] = ['red', 'orange', 'yellow', 'green', 'blue', 'violet', 'gray'];
export const UI_FONT_SIZES: ReadonlyArray<readonly [UiFontSize, string]> = [['small', 'Small'], ['default', 'Default'], ['large', 'Large'], ['larger', 'Larger']];
export const UI_FONT_SCALE: Record<UiFontSize, number> = { small: 0.9, default: 1, large: 1.15, larger: 1.3 };
export const RECOVERY_CHOICES: ReadonlyArray<readonly [string, string]> = [['1', '1 minute'], ['2', '2 minutes'], ['5', '5 minutes'], ['10', '10 minutes'], ['30', '30 minutes']];

export const DEFAULT_PREFS: Prefs = {
  language: 'en', uiFontSize: 'default', animations: true, showTooltips: true, noticeSeconds: 0,
  autoShowHome: true, homeOnLastClose: false, whatsNewAuto: true, whatsNewSeen: '',
  favouriteThemes: [], themeAuto: false, themeLight: 'light', themeDark: 'substrata',
  shortcuts: {}, shortcutSets: {}, menuHidden: [], menuColors: {}, dialogValues: {},
  editorFontSize: 13, editorTabSize: 2, editorWordWrap: true, terminalFontSize: 13, terminalDockHeight: 260,
  agentDefaultModel: '', agentPermissionMode: 'acceptEdits', formslotEnabled: true, formslotAutoStart: true, formslotPath: '', gitSignOnCommit: true, recoveryMinutes: 1,
  largeTabs: false, reopenLastWorkspace: true, hiddenFolders: [], allowTypedPaths: false, trustedWorkspaces: [], trustAsked: [], sidebarWidth: 280, prefsRevision: 3,
};

export const HIDDEN_FOLDERS_EVENT = 'formsubstrate:hidden-folders';
export const FORMSLOT_PATH_EVENT = 'formsubstrate:formslot-path';

const KEY = 'formsubstrate.prefs';
const ZOOM_KEY = 'formsubstrate.uiZoom';
const UPDATE_KEY = 'formsubstrate.updateAtStart';

const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const flag = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown, max: number, len: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= len).slice(0, max) : []);

const LANG_ALIASES: Record<string, Lang> = {};

export function systemLang(): Lang {
  try {
    for (const raw of navigator.languages?.length ? navigator.languages : [navigator.language]) {
      const parts = raw.replace(/_/g, '-').toLowerCase().split('-');
      for (let n = parts.length; n > 0; n--) {
        const tag = parts.slice(0, n).join('-');
        const hit = LANG_ALIASES[tag] ?? LANG_CODES.find((c) => c.toLowerCase() === tag);
        if (hit) return hit;
      }
    }
  } catch {
    return 'en';
  }
  return 'en';
}

export function cleanBindings(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!plain(v)) return out;
  for (const [k, x] of Object.entries(v).slice(0, 3000)) if (Array.isArray(x)) out[k.slice(0, 120)] = strings(x, 8, 40);
  return out;
}

function cleanShortcutSets(v: unknown): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  if (!plain(v)) return out;
  for (const [name, set] of Object.entries(v).slice(0, 50)) if (name.trim() && name.length <= 60) out[name] = cleanBindings(set);
  return out;
}

function cleanMenuColors(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!plain(v)) return out;
  for (const [k, x] of Object.entries(v).slice(0, 2000)) if (typeof x === 'string' && MENU_COLORS.includes(x)) out[k.slice(0, 120)] = x;
  return out;
}

function cleanDialogValues(v: unknown): Record<string, Record<string, DialogValue>> {
  const out: Record<string, Record<string, DialogValue>> = {};
  if (!plain(v)) return out;
  for (const [d, vals] of Object.entries(v).slice(0, 200)) {
    if (!plain(vals)) continue;
    const row: Record<string, DialogValue> = {};
    for (const [k, x] of Object.entries(vals).slice(0, 80)) if ((typeof x === 'string' && x.length <= 2000) || typeof x === 'boolean') row[k.slice(0, 120)] = x;
    out[d.slice(0, 120)] = row;
  }
  return out;
}

const LEGACY_FORMSLOT_KEY = 'formsubstrate.formslot.checkout';
let legacyTaken: string | null = null;

function legacyFormslotPath(): string {
  if (legacyTaken === null) {
    let old = '';
    try {
      old = (localStorage.getItem(LEGACY_FORMSLOT_KEY) ?? '').trim().slice(0, 1024);
      localStorage.removeItem(LEGACY_FORMSLOT_KEY);
    } catch {
      old = '';
    }
    legacyTaken = old;
    if (old) queueMicrotask(() => { savePrefs({ ...loadPrefs(), formslotPath: old }); });
  }
  return legacyTaken;
}

export function loadPrefs(): Prefs {
  const d = DEFAULT_PREFS;
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof Prefs, unknown>>;
    return {
      language: isLang(r.language) ? r.language : systemLang(),
      uiFontSize: UI_FONT_SIZES.some(([k]) => k === r.uiFontSize) ? r.uiFontSize as UiFontSize : d.uiFontSize,
      animations: r.animations !== false,
      showTooltips: r.showTooltips !== false,
      noticeSeconds: Math.round(num(r.noticeSeconds, 0, 60, d.noticeSeconds)),
      autoShowHome: flag(r.autoShowHome, d.autoShowHome),
      homeOnLastClose: flag(r.homeOnLastClose, d.homeOnLastClose),
      whatsNewAuto: flag(r.whatsNewAuto, d.whatsNewAuto),
      whatsNewSeen: typeof r.whatsNewSeen === 'string' ? r.whatsNewSeen.slice(0, 32) : d.whatsNewSeen,
      favouriteThemes: Array.from(new Set(strings(r.favouriteThemes, 60, 80).filter((x) => !!THEMES[x]))).slice(0, 30),
      themeAuto: r.themeAuto === true,
      themeLight: typeof r.themeLight === 'string' && THEMES[r.themeLight]?.light ? r.themeLight : d.themeLight,
      themeDark: typeof r.themeDark === 'string' && THEMES[r.themeDark] && !THEMES[r.themeDark].light ? r.themeDark : d.themeDark,
      shortcuts: cleanBindings(r.shortcuts),
      shortcutSets: cleanShortcutSets(r.shortcutSets),
      menuHidden: strings(r.menuHidden, 2000, 120),
      menuColors: cleanMenuColors(r.menuColors),
      dialogValues: cleanDialogValues(r.dialogValues),
      editorFontSize: Math.round(num(r.editorFontSize, 8, 32, d.editorFontSize)),
      editorTabSize: Math.round(num(r.editorTabSize, 1, 8, d.editorTabSize)),
      editorWordWrap: num(r.prefsRevision, 0, 99, 0) >= 2 ? flag(r.editorWordWrap, d.editorWordWrap) : d.editorWordWrap,
      terminalFontSize: Math.round(num(r.terminalFontSize, 8, 32, d.terminalFontSize)),
      terminalDockHeight: Math.round(num(r.terminalDockHeight, 120, 800, d.terminalDockHeight)),
      agentDefaultModel: typeof r.agentDefaultModel === 'string' ? r.agentDefaultModel.slice(0, 120) : d.agentDefaultModel,
      agentPermissionMode: PERMISSION_MODES.some(([k]) => k === r.agentPermissionMode) ? r.agentPermissionMode as AgentPermissionMode : d.agentPermissionMode,
      formslotEnabled: flag(r.formslotEnabled, d.formslotEnabled),
      formslotAutoStart: flag(r.formslotAutoStart, d.formslotAutoStart),
      formslotPath: typeof r.formslotPath === 'string' ? r.formslotPath.trim().slice(0, 1024) : legacyFormslotPath(),
      gitSignOnCommit: flag(r.gitSignOnCommit, d.gitSignOnCommit),
      recoveryMinutes: Math.round(num(r.recoveryMinutes, 1, 60, d.recoveryMinutes)),
      largeTabs: flag(r.largeTabs, d.largeTabs),
      reopenLastWorkspace: flag(r.reopenLastWorkspace, d.reopenLastWorkspace),
      hiddenFolders: strings(r.hiddenFolders, 200, 200),
      allowTypedPaths: r.allowTypedPaths === true,
      trustedWorkspaces: Array.from(new Set(strings(r.trustedWorkspaces, 200, 1024))),
      trustAsked: Array.from(new Set(strings(r.trustAsked, 200, 1024))),
      sidebarWidth: Math.round(num(r.sidebarWidth, 180, 600, d.sidebarWidth)),
      prefsRevision: d.prefsRevision,
    };
  } catch {
    return { ...d, language: 'en' };
  }
}

export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { return; }
}

export function updatePrefs(patch: Partial<Prefs>): Prefs {
  const p = { ...loadPrefs(), ...patch };
  savePrefs(p);
  return p;
}

export const recalled = (dialog: string, name: string): DialogValue | undefined => loadPrefs().dialogValues[dialog]?.[name];

export function remembered(dialog: string, name: string, value: DialogValue): void {
  const cur = loadPrefs().dialogValues;
  if (cur[dialog]?.[name] === value) return;
  updatePrefs({ dialogValues: { ...cur, [dialog]: { ...cur[dialog], [name]: value } } });
}

let sizedK = 0;
let pxFontSheet: HTMLStyleElement | null = null;
let pxFontFactor = 1;

export function applyUiFontSize(p: Prefs): void {
  const k = UI_FONT_SCALE[p.uiFontSize], s = document.documentElement.style;
  for (const n of [9, 10, 11, 12, 13, 14, 16, 18]) { if (k === 1) s.removeProperty(`--fs-${n}`); else s.setProperty(`--fs-${n}`, `${Math.round(n * k * 10) / 10}px`); }
  scalePxFonts(k);
  if (k !== sizedK) {
    const first = sizedK === 0;
    sizedK = k;
    if (!first) document.dispatchEvent(new CustomEvent('nm:ui-settings-changed', { detail: { key: 'fontSize' } }));
  }
}

function scalePxFonts(k: number): void {
  if (k === pxFontFactor) return;
  pxFontFactor = k;
  if (!pxFontSheet) {
    if (k === 1) return;
    pxFontSheet = document.createElement('style');
    pxFontSheet.dataset.role = 'ui-font-scale';
    document.head.appendChild(pxFontSheet);
  }
  const walk = (rules: CSSRuleList): string => {
    let out = '';
    for (const r of Array.from(rules)) {
      if (r instanceof CSSStyleRule) {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(r.style.getPropertyValue('font-size'));
        if (m && r.selectorText) out += `${r.selectorText}{font-size:${Math.round(parseFloat(m[1]) * k * 10) / 10}px}`;
      } else if (r instanceof CSSMediaRule) {
        const inner = walk(r.cssRules);
        if (inner) out += `@media ${r.media.mediaText}{${inner}}`;
      } else if (r instanceof CSSSupportsRule) {
        const inner = walk(r.cssRules);
        if (inner) out += `@supports ${r.conditionText}{${inner}}`;
      }
    }
    return out;
  };
  let css = '';
  if (k !== 1) {
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.ownerNode === pxFontSheet) continue;
      try { css += walk(sheet.cssRules); } catch { continue; }
    }
  }
  pxFontSheet.textContent = css;
}

export const UI_SCALES: ReadonlyArray<readonly [string, string]> = [['auto', 'Auto (follow the display)'], ['0.8', '80%'], ['0.9', '90%'], ['1', '100%'], ['1.1', '110%'], ['1.25', '125%'], ['1.5', '150%'], ['1.75', '175%'], ['2', '200%']];

export function uiScaleChoice(): string {
  try { const v = localStorage.getItem(ZOOM_KEY) ?? '1'; return UI_SCALES.some(([k]) => k === v) ? v : '1'; } catch { return '1'; }
}

let shellZoom = 1;
export function setShellZoom(zoom: number): void { shellZoom = zoom > 0 ? zoom : 1; }

export function autoUiScale(): number {
  const ratio = (window.devicePixelRatio || 1) / shellZoom, wide = screen.width || 0;
  if (ratio > 1.01) return 1;
  return wide >= 3800 ? 2 : wide >= 3000 ? 1.5 : 1;
}

export function setUiScale(v: string): void {
  try { localStorage.setItem(ZOOM_KEY, v); } catch { return; }
  window.dispatchEvent(new Event('formsubstrate:ui-zoom'));
}

export function updateAtStart(): boolean {
  try { return localStorage.getItem(UPDATE_KEY) !== '0'; } catch { return true; }
}

export function setUpdateAtStart(on: boolean): void {
  try { localStorage.setItem(UPDATE_KEY, on ? '1' : '0'); } catch { return; }
}

let systemScheme: MediaQueryList | null = null;
let systemSchemeOn: (() => void) | null = null;

export function followSystemTheme(p: Prefs): void {
  if (typeof matchMedia !== 'function') return;
  if (!systemScheme) systemScheme = matchMedia('(prefers-color-scheme: dark)');
  if (systemSchemeOn) { systemScheme.removeEventListener('change', systemSchemeOn); systemSchemeOn = null; }
  if (!p.themeAuto) return;
  const pick = (): void => { const id = systemScheme?.matches ? p.themeDark : p.themeLight; if (readChoice().theme !== id) setTheme(id); };
  systemSchemeOn = pick;
  systemScheme.addEventListener('change', pick);
  pick();
}
