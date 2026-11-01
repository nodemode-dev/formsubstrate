import type { Shell, SearchProvider, SidebarSection, SidebarSectionOptions } from '../extensions/registry';
import { registerSearchProvider } from '../extensions/registry';
import { el, q, setClass, setHidden, setStyleVar, setText, setTitle } from './dom';
import { onLanguage, t } from './i18n';
import { icon } from './icons';
import { loadPrefs, updatePrefs } from './prefs';
import type { WorkspaceStore } from './workspace-store';

export interface EditorLike {
  open(path: string, line?: number, col?: number): unknown;
  revealLine(path: string, line: number, col?: number): unknown;
}

export interface WorkbenchDeps {
  store: WorkspaceStore;
  editor: () => EditorLike | null;
  setHint(text: string): void;
  flashError(text: string): void;
}

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 600;
export const SIDEBAR_DEFAULT = 280;
export const FOCUS_EVENT = 'wb-focus';

const STATE_KEY = 'subform.workbench';
const KEY_STEP = 16;

interface Panel {
  id: string;
  title: string;
  button: HTMLButtonElement;
  host: HTMLElement;
}

interface Saved { panel: string; collapsed: boolean }

function readSaved(): Saved {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}');
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return { panel: typeof r.panel === 'string' ? r.panel : 'files', collapsed: r.collapsed === true };
  } catch {
    return { panel: 'files', collapsed: false };
  }
}

const clampWidth = (n: number): number => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n)));

export class Workbench implements Shell {
  readonly root: HTMLElement;
  readonly editorArea: HTMLElement;
  readonly editorHost: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly side: HTMLElement;
  private readonly sideTitle: HTMLElement;
  private readonly panelsHost: HTMLElement;
  private readonly grip: HTMLElement;
  private readonly panels = new Map<string, Panel>();
  private width: number;
  private collapsed: boolean;
  private activeId: string;
  private dragFrame = 0;
  private dragWidth = 0;

  constructor(stage: HTMLElement, private readonly deps: WorkbenchDeps) {
    const saved = readSaved();
    this.width = clampWidth(loadPrefs().sidebarWidth);
    this.collapsed = saved.collapsed;
    this.activeId = saved.panel;
    this.root = el(
      '<div class="cv-wb">' +
      '<nav class="cv-wb-rail" role="tablist" aria-orientation="vertical"></nav>' +
      '<aside class="cv-wb-side"><div class="cv-wb-side-head"><span class="cv-wb-side-title"></span></div><div class="cv-wb-panels"></div>' +
      '<div class="cv-wb-grip" role="separator" aria-orientation="vertical" tabindex="0"></div></aside>' +
      '<section class="cv-wb-editor"><div class="cv-editor-host"></div></section>' +
      '</div>');
    this.rail = q(this.root, '.cv-wb-rail');
    this.side = q(this.root, '.cv-wb-side');
    this.sideTitle = q(this.root, '.cv-wb-side-title');
    this.panelsHost = q(this.root, '.cv-wb-panels');
    this.grip = q(this.root, '.cv-wb-grip');
    this.editorArea = q(this.root, '.cv-wb-editor');
    this.editorHost = q(this.root, '.cv-editor-host');
    this.applyWidth();
    setClass(this.root, 'is-collapsed', this.collapsed);
    stage.append(this.root);
    this.bindRail();
    this.bindGrip();
    onLanguage(() => this.relabel());
  }

  get sidebarVisible(): boolean { return !this.collapsed; }
  get activePanel(): string { return this.activeId; }

  sidebarSection(opts: SidebarSectionOptions): SidebarSection {
    const button = el<HTMLButtonElement>(`<button class="cv-wb-act" type="button" role="tab" data-panel="${opts.id}">${icon(opts.icon, 22)}</button>`);
    const host = el(`<div class="cv-wb-panel" data-panel="${opts.id}" hidden></div>`);
    const panel: Panel = { id: opts.id, title: opts.title, button, host };
    this.panels.set(opts.id, panel);
    this.rail.append(button);
    this.panelsHost.append(host);
    opts.render(host);
    this.relabel();
    this.sync();
    return { host, reveal: () => this.showPanel(opts.id, true) };
  }

  showPanel(id: string, focus = false): void {
    if (!this.panels.has(id)) return;
    this.activeId = id;
    this.collapsed = false;
    this.sync();
    this.keep();
    if (focus) this.panels.get(id)?.host.dispatchEvent(new Event(FOCUS_EVENT));
  }

  toggleSidebar(show?: boolean): void {
    const next = show === undefined ? !this.collapsed : !show;
    if (next === this.collapsed) return;
    this.collapsed = next;
    this.sync();
    this.keep();
  }

  openEditorTab(path: string, line?: number, col?: number): void {
    this.deps.editor()?.open(path, line, col);
  }

  revealLine(path: string, line: number, col?: number): void {
    const editor = this.deps.editor();
    if (!editor) return;
    if (this.deps.store.docs.some((d) => d.path === path)) editor.revealLine(path, line, col);
    else editor.open(path, line, col);
  }

  setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
    if (kind === 'error') this.deps.flashError(text);
    else this.deps.setHint(text);
  }

  toggleBottom(show?: boolean): void {
    void show;
  }

  registerSearchProvider(provider: SearchProvider): void {
    registerSearchProvider(provider);
  }

  private relabel(): void {
    for (const p of this.panels.values()) {
      setTitle(p.button, t(p.title));
      if (p.button.getAttribute('aria-label') !== t(p.title)) p.button.setAttribute('aria-label', t(p.title));
    }
    const active = this.panels.get(this.activeId);
    setText(this.sideTitle, active ? t(active.title) : '');
    if (this.grip.getAttribute('aria-label') !== t('Resize side panel')) this.grip.setAttribute('aria-label', t('Resize side panel'));
  }

  private sync(): void {
    if (!this.panels.has(this.activeId)) {
      const first = this.panels.keys().next();
      if (!first.done) this.activeId = first.value;
    }
    for (const p of this.panels.values()) {
      const on = p.id === this.activeId;
      setHidden(p.host, !on);
      setClass(p.button, 'is-active', on && !this.collapsed);
      const selected = String(on);
      if (p.button.getAttribute('aria-selected') !== selected) p.button.setAttribute('aria-selected', selected);
    }
    setClass(this.root, 'is-collapsed', this.collapsed);
    this.applyWidth();
    this.relabel();
  }

  private applyWidth(): void {
    setStyleVar(this.root, '--wb-side-w', this.collapsed ? '0px' : `${this.width}px`);
    const now = String(this.width);
    if (this.grip.getAttribute('aria-valuenow') !== now) {
      this.grip.setAttribute('aria-valuenow', now);
      this.grip.setAttribute('aria-valuemin', String(SIDEBAR_MIN));
      this.grip.setAttribute('aria-valuemax', String(SIDEBAR_MAX));
    }
  }

  private keep(): void {
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ panel: this.activeId, collapsed: this.collapsed })); } catch { return; }
  }

  private bindRail(): void {
    this.rail.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.cv-wb-act') : null;
      const id = b?.dataset.panel;
      if (!id) return;
      if (id === this.activeId && !this.collapsed) this.toggleSidebar(false);
      else this.showPanel(id, true);
    });
  }

  private bindGrip(): void {
    const widthAt = (clientX: number): number => {
      const rect = this.side.getBoundingClientRect();
      const scale = this.side.offsetWidth > 0 ? rect.width / this.side.offsetWidth : 1;
      return clampWidth((clientX - rect.left) / (scale || 1));
    };
    const paint = (): void => {
      this.dragFrame = 0;
      this.width = this.dragWidth;
      this.applyWidth();
    };
    this.grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.grip.setPointerCapture(e.pointerId);
      setClass(this.root, 'is-resizing', true);
    });
    this.grip.addEventListener('pointermove', (e) => {
      if (!this.grip.hasPointerCapture(e.pointerId)) return;
      this.dragWidth = widthAt(e.clientX);
      if (!this.dragFrame) this.dragFrame = requestAnimationFrame(paint);
    });
    const end = (e: PointerEvent): void => {
      if (!this.grip.hasPointerCapture(e.pointerId)) return;
      this.grip.releasePointerCapture(e.pointerId);
      if (this.dragFrame) { cancelAnimationFrame(this.dragFrame); this.dragFrame = 0; this.width = this.dragWidth; this.applyWidth(); }
      setClass(this.root, 'is-resizing', false);
      updatePrefs({ sidebarWidth: this.width });
    };
    this.grip.addEventListener('pointerup', end);
    this.grip.addEventListener('pointercancel', end);
    this.grip.addEventListener('dblclick', () => {
      this.width = SIDEBAR_DEFAULT;
      this.applyWidth();
      updatePrefs({ sidebarWidth: this.width });
    });
    this.grip.addEventListener('keydown', (e) => {
      const by = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0;
      if (!by) return;
      e.preventDefault();
      this.width = clampWidth(this.width + by);
      this.applyWidth();
      updatePrefs({ sidebarWidth: this.width });
    });
  }
}
