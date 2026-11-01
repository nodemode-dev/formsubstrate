import type { SidebarSection, SidebarSectionOptions } from '../../extensions/registry';
import { el, q, setClass, setHidden, setStyleVar, setText, setTitle } from '../dom';
import { onLanguage, t } from '../i18n';
import { icon } from '../icons';
import { bindSash } from './sash';

export const RIGHT_MIN = 220;
export const RIGHT_MAX = 720;
export const RIGHT_DEFAULT = 320;
export const SPLIT_MIN = 20;
export const SPLIT_MAX = 80;
export const SPLIT_DEFAULT = 45;

const KEY = 'subform.stage';
export const RIGHT_PANEL_EVENT = 'subform:right-panel';

interface Saved { right: string; rightOpen: boolean; rightW: number; splitOpen: boolean; splitPct: number }

interface RightPanel {
  id: string;
  title: string;
  tab: HTMLButtonElement;
  host: HTMLElement;
  available: boolean;
}

const clampN = (n: unknown, lo: number, hi: number, d: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n))) : d);

function readSaved(): Saved {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      right: typeof r.right === 'string' ? r.right : '',
      rightOpen: r.rightOpen === true,
      rightW: clampN(r.rightW, RIGHT_MIN, RIGHT_MAX, RIGHT_DEFAULT),
      splitOpen: r.splitOpen === true,
      splitPct: clampN(r.splitPct, SPLIT_MIN, SPLIT_MAX, SPLIT_DEFAULT),
    };
  } catch {
    return { right: '', rightOpen: false, rightW: RIGHT_DEFAULT, splitOpen: false, splitPct: SPLIT_DEFAULT };
  }
}

export class StagePanels {
  readonly splitHost: HTMLElement;
  private readonly root: HTMLElement;
  private readonly editorArea: HTMLElement;
  private readonly right: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly title: HTMLElement;
  private readonly bodies: HTMLElement;
  private readonly rightGrip: HTMLElement;
  private readonly close: HTMLElement;
  private announced = false;
  private readonly split: HTMLElement;
  private readonly splitGrip: HTMLElement;
  private readonly panels = new Map<string, RightPanel>();
  private state: Saved;
  private activeId: string;

  constructor(root: HTMLElement, editorArea: HTMLElement) {
    this.root = root;
    this.editorArea = editorArea;
    this.state = readSaved();
    this.activeId = this.state.right;
    this.right = el(
      '<aside class="cv-wb-right" hidden>' +
      '<div class="cv-wb-right-head"><span class="cv-wb-right-title"></span><div class="cv-wb-right-tabs" role="tablist"></div>' +
      `<button class="cv-wb-tool cv-wb-right-x" type="button">${icon('close', 14)}</button></div>` +
      '<div class="cv-wb-right-panels"></div>' +
      '<div class="cv-wb-grip cv-wb-rgrip" role="separator" aria-orientation="vertical" tabindex="0"></div></aside>');
    this.tabs = q(this.right, '.cv-wb-right-tabs');
    this.title = q(this.right, '.cv-wb-right-title');
    this.bodies = q(this.right, '.cv-wb-right-panels');
    this.rightGrip = q(this.right, '.cv-wb-rgrip');
    this.close = q(this.right, '.cv-wb-right-x');
    this.split = el(
      '<div class="cv-wb-split" hidden><div class="cv-wb-grip cv-wb-sgrip" role="separator" aria-orientation="vertical" tabindex="0"></div>' +
      '<div class="cv-wb-split-host"></div></div>');
    this.splitGrip = q(this.split, '.cv-wb-sgrip');
    this.splitHost = q(this.split, '.cv-wb-split-host');
    root.append(this.right);
    editorArea.append(this.split);
    this.apply();
    this.bindRight();
    this.bindSplit();
    this.close.addEventListener('click', () => this.toggleRight(false));
    this.tabs.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.cv-wb-rtab') : null;
      if (b?.dataset.panel) this.showRight(b.dataset.panel);
    });
    this.tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const ids = [...this.panels.values()].filter((p) => p.available).map((p) => p.id);
      const at = ids.indexOf(this.shownId());
      if (at < 0 || ids.length < 2) return;
      e.preventDefault();
      const next = ids[(at + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      this.showRight(next);
      this.panels.get(next)?.tab.focus();
    });
    onLanguage(() => this.relabel());
  }

  get rightVisible(): boolean { return this.state.rightOpen && this.shownId() !== ''; }

  private shownId(): string {
    const want = this.panels.get(this.activeId);
    if (want?.available) return want.id;
    for (const p of this.panels.values()) if (p.available) return p.id;
    return '';
  }
  get splitVisible(): boolean { return this.state.splitOpen; }

  rightSection(opts: SidebarSectionOptions): SidebarSection {
    const tab = el<HTMLButtonElement>(`<button class="cv-wb-act cv-wb-rtab" type="button" role="tab" data-panel="${opts.id}">${icon(opts.icon, 16)}</button>`);
    const host = el(`<div class="cv-wb-panel" data-panel="${opts.id}" hidden></div>`);
    const panel: RightPanel = { id: opts.id, title: opts.title, tab, host, available: true };
    this.panels.set(opts.id, panel);
    this.tabs.append(tab);
    this.bodies.append(host);
    opts.render(host);
    if (!this.activeId) this.activeId = opts.id;
    this.apply();
    return {
      host,
      reveal: () => this.showRight(opts.id),
      setAvailable: (on) => {
        if (panel.available === on) return;
        panel.available = on;
        this.apply();
      },
    };
  }

  showRight(id: string): void {
    if (!this.panels.get(id)?.available) return;
    this.activeId = id;
    this.state.rightOpen = true;
    this.apply();
    this.keep();
  }

  toggleRight(show?: boolean): void {
    const next = show === undefined ? !this.state.rightOpen : show;
    if (next === this.state.rightOpen) return;
    this.state.rightOpen = next;
    this.apply();
    this.keep();
  }

  toggleSplit(show?: boolean): void {
    const next = show === undefined ? !this.state.splitOpen : show;
    if (next === this.state.splitOpen) return;
    this.state.splitOpen = next;
    this.apply();
    this.keep();
  }

  private apply(): void {
    const open = this.rightVisible;
    setHidden(this.right, !open);
    setStyleVar(this.root, '--wb-right-w', open ? `${this.state.rightW}px` : '0px');
    const shown = this.shownId();
    let count = 0;
    for (const p of this.panels.values()) {
      const on = p.id === shown;
      if (p.available) count++;
      setHidden(p.host, !on);
      setHidden(p.tab, !p.available);
      setClass(p.tab, 'is-active', on);
      const selected = String(on);
      if (p.tab.getAttribute('aria-selected') !== selected) p.tab.setAttribute('aria-selected', selected);
    }
    setHidden(this.tabs, count < 2);
    const now = String(this.state.rightW);
    if (this.rightGrip.getAttribute('aria-valuenow') !== now) {
      this.rightGrip.setAttribute('aria-valuenow', now);
      this.rightGrip.setAttribute('aria-valuemin', String(RIGHT_MIN));
      this.rightGrip.setAttribute('aria-valuemax', String(RIGHT_MAX));
    }
    setHidden(this.split, !this.state.splitOpen);
    setStyleVar(this.editorArea, '--wb-split-w', this.state.splitOpen ? `${this.state.splitPct}%` : '0%');
    const pct = String(this.state.splitPct);
    if (this.splitGrip.getAttribute('aria-valuenow') !== pct) {
      this.splitGrip.setAttribute('aria-valuenow', pct);
      this.splitGrip.setAttribute('aria-valuemin', String(SPLIT_MIN));
      this.splitGrip.setAttribute('aria-valuemax', String(SPLIT_MAX));
    }
    this.relabel();
    if (open !== this.announced) {
      this.announced = open;
      window.dispatchEvent(new Event(RIGHT_PANEL_EVENT));
    }
  }

  private relabel(): void {
    const active = this.panels.get(this.shownId());
    setText(this.title, active ? t(active.title) : '');
    for (const p of this.panels.values()) {
      setTitle(p.tab, t(p.title));
      if (p.tab.getAttribute('aria-label') !== t(p.title)) p.tab.setAttribute('aria-label', t(p.title));
    }
    setTitle(this.close, t('Hide Side Panel'));
    for (const [grip, label] of [[this.rightGrip, t('Resize side panel')], [this.splitGrip, t('Resize split')]] as const) {
      if (grip.getAttribute('aria-label') !== label) grip.setAttribute('aria-label', label);
    }
  }

  private keep(): void {
    try { localStorage.setItem(KEY, JSON.stringify({ right: this.activeId, rightOpen: this.state.rightOpen, rightW: this.state.rightW, splitOpen: this.state.splitOpen, splitPct: this.state.splitPct })); } catch { return; }
  }

  private bindRight(): void {
    bindSash(this.rightGrip, {
      min: RIGHT_MIN, max: RIGHT_MAX, def: RIGHT_DEFAULT, dir: -1,
      read: () => this.state.rightW,
      write: (v) => { this.state.rightW = v; this.apply(); },
      at: (e) => {
        const rect = this.right.getBoundingClientRect();
        const scale = this.right.offsetWidth > 0 ? rect.width / this.right.offsetWidth : 1;
        return (rect.right - e.clientX) / (scale || 1);
      },
      commit: () => this.keep(),
      dragging: (on) => setClass(this.root, 'is-resizing', on),
      toggle: () => this.toggleRight(false),
    });
  }

  private bindSplit(): void {
    bindSash(this.splitGrip, {
      min: SPLIT_MIN, max: SPLIT_MAX, def: SPLIT_DEFAULT, dir: -1, step: 2,
      read: () => this.state.splitPct,
      write: (v) => { this.state.splitPct = v; this.apply(); },
      at: (e) => {
        const rect = this.editorArea.getBoundingClientRect();
        return rect.width > 0 ? ((rect.right - e.clientX) / rect.width) * 100 : this.state.splitPct;
      },
      commit: () => this.keep(),
      dragging: (on) => setClass(this.root, 'is-resizing', on),
      toggle: () => this.toggleSplit(false),
    });
  }
}
