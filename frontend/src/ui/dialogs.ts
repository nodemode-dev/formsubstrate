import { el, q, setText } from './dom';
import { icon } from './icons';
import { t } from './i18n';
import { loadPrefs, updatePrefs, type DialogValue } from './prefs';
import { DialogHistory, REMEMBERED } from './dialog-history';

export interface RememberedExtra { read(): Record<string, DialogValue>; write(values: Record<string, DialogValue>): void; onChange(notify: () => void): void }

const SPOTS_KEY = 'subform.dialogSpots';

let openCount = 0;
let titleSeq = 0;
export const anyDialogOpen = (): boolean => openCount > 0;

const openStack: DialogHistory[] = [];
const altKeys = (e: KeyboardEvent): void => { if (e.key === 'Alt') openStack[openStack.length - 1]?.alt(e.type === 'keydown'); };
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
const trapTab = (e: KeyboardEvent, frame: HTMLElement): void => {
  const items = Array.from(frame.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => !n.hasAttribute('disabled') && n.getClientRects().length > 0);
  if (!items.length) { e.preventDefault(); return; }
  const at = document.activeElement, first = items[0], last = items[items.length - 1];
  const outside = !(at instanceof HTMLElement) || at === frame || !frame.contains(at);
  if (e.shiftKey && (outside || at === first)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (outside || at === last)) { e.preventDefault(); first.focus(); }
};
window.addEventListener('keydown', altKeys, true);
window.addEventListener('keyup', altKeys, true);
window.addEventListener('blur', () => { for (const d of openStack) d.alt(false); });

export class Dialog {
  readonly scrim: HTMLElement;
  readonly body: HTMLElement;
  readonly foot: HTMLElement;
  private readonly title: HTMLElement;
  private english = '';
  private lastFocus: HTMLElement | null = null;
  onClose: (() => void) | null = null;
  private readonly fieldHistory: DialogHistory;

  constructor(title: string, width = 440) {
    this.scrim = el<HTMLElement>(
      `<div class="cv-scrim" hidden><div class="cv-dialog" role="dialog" aria-modal="true" tabindex="-1">` +
      `<div class="cv-dialog-head"><span class="cv-dialog-title"></span>` +
      `<button class="cv-icon-btn" type="button" data-close title="Close" aria-label="Close">${icon('close', 16)}</button></div>` +
      `<div class="cv-dialog-body"></div><div class="cv-dialog-foot"></div></div></div>`);
    const frame = q<HTMLElement>(this.scrim, '.cv-dialog');
    frame.style.setProperty('--cv-dialog-w', `${width}px`);
    this.title = q<HTMLElement>(this.scrim, '.cv-dialog-title');
    this.title.id = `cv-dlg-title-${++titleSeq}`;
    frame.setAttribute('aria-labelledby', this.title.id);
    this.body = q<HTMLElement>(this.scrim, '.cv-dialog-body');
    this.foot = q<HTMLElement>(this.scrim, '.cv-dialog-foot');
    this.english = title;
    setText(this.title, t(title));
    q(this.scrim, '[data-close]').title = t('Close');
    q(this.scrim, '[data-close]').addEventListener('click', () => this.close());
    this.scrim.addEventListener('pointerdown', (e) => { if (e.target === this.scrim) this.close(); });
    this.fieldHistory = new DialogHistory(this.scrim, this.body, this.foot, () => this.isOpen);
    this.bindMove(frame);
    this.scrim.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) this.fieldHistory.tab(e);
      if (e.key === 'Tab' && !e.defaultPrevented) trapTab(e, frame);
      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.altKey) this.fieldHistory.undo(e);
      const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
      if (!step || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !(document.activeElement instanceof HTMLButtonElement) || document.activeElement.parentElement !== this.foot) return;
      const row = Array.from(this.foot.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')), at = row.indexOf(document.activeElement);
      const next = row[(at + step + row.length) % row.length];
      if (at >= 0 && next) { e.preventDefault(); next.focus(); }
    });
    document.getElementById('overlay-root')?.appendChild(this.scrim);
  }

  private static spots: Record<string, { x: number; y: number }> = (() => {
    try {
      const s = JSON.parse(localStorage.getItem(SPOTS_KEY) ?? '{}') as Record<string, { x?: unknown; y?: unknown }>;
      const out: Record<string, { x: number; y: number }> = {};
      for (const [k, v] of Object.entries(s)) if (typeof v?.x === 'number' && typeof v.y === 'number') out[k] = { x: v.x, y: v.y };
      return out;
    } catch { return {}; }
  })();

  private frameOffset = { x: 0, y: 0 };

  private moveFrame(frame: HTMLElement, x: number, y: number): void {
    const was = this.frameOffset, r = frame.getBoundingClientRect();
    if (!r.width) return;
    const left = r.left - was.x, top = r.top - was.y;
    const nx = Math.min(Math.max(x, 48 - r.width - left), window.innerWidth - 48 - left), ny = Math.min(Math.max(y, -top), window.innerHeight - 44 - top);
    this.frameOffset = { x: nx, y: ny };
    Dialog.spots[this.english] = { x: nx, y: ny };
    frame.style.translate = nx || ny ? `${nx}px ${ny}px` : '';
  }

  private bindMove(frame: HTMLElement): void {
    const head = q<HTMLElement>(this.scrim, '.cv-dialog-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      const at = { ...(Dialog.spots[this.english] ?? { x: 0, y: 0 }) }, sx = e.clientX, sy = e.clientY;
      head.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent): void => this.moveFrame(frame, at.x + ev.clientX - sx, at.y + ev.clientY - sy);
      const up = (): void => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        head.removeEventListener('pointercancel', up);
        try { localStorage.setItem(SPOTS_KEY, JSON.stringify(Dialog.spots)); } catch { return; }
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
    });
  }

  get isOpen(): boolean { return !this.scrim.hidden; }
  setTitle(title: string): void { this.english = title; setText(this.title, t(title)); }

  private relabel(): void {
    setText(this.title, t(this.english));
    q(this.scrim, '[data-close]').title = t('Close');
    for (const b of Array.from(this.foot.querySelectorAll<HTMLButtonElement>('button[data-en]'))) {
      if (b.textContent !== b.dataset.shown) continue;
      setText(b, t(b.dataset.en ?? ''));
      b.dataset.shown = b.textContent ?? '';
    }
    for (const s of Array.from(this.body.querySelectorAll<HTMLElement>('.cv-field > span:first-child, .cv-dialog-row > span:first-child'))) {
      const now = s.textContent ?? '';
      if (!now) continue;
      if (s.dataset.en === undefined || now !== s.dataset.shown) s.dataset.en = now;
      const shown = t(s.dataset.en);
      if (shown !== now) setText(s, shown);
      s.dataset.shown = shown;
    }
  }

  private memory: { skip: ReadonlySet<Element>; busy: boolean; queued: boolean; extra: RememberedExtra | null } | null = null;

  remember(skip: readonly Element[] = [], extra: RememberedExtra | null = null): void {
    if (this.memory) return;
    const m = { skip: new Set<Element>(skip), busy: false, queued: false, extra };
    this.memory = m;
    const later = (): void => {
      if (m.busy || m.queued) return;
      m.queued = true;
      queueMicrotask(() => { m.queued = false; this.saveRemembered(); });
    };
    const queue = (e: Event): void => { if (e.target instanceof Element && e.target.matches(REMEMBERED) && !m.skip.has(e.target)) later(); };
    this.scrim.addEventListener('input', queue);
    this.scrim.addEventListener('change', queue);
    if (extra) extra.onChange(later);
    queueMicrotask(() => this.restoreRemembered());
  }

  private rememberedControls(): Array<[string, HTMLInputElement | HTMLSelectElement]> {
    const seen = new Map<string, number>(), out: Array<[string, HTMLInputElement | HTMLSelectElement]> = [];
    const skip = this.memory?.skip;
    Array.from(this.body.querySelectorAll<HTMLInputElement | HTMLSelectElement>(REMEMBERED)).forEach((c, i) => {
      if (skip?.has(c) || c.closest('[data-forget]')) return;
      const host = c.closest('label, .cv-field, .cv-dialog-row'), span = host?.querySelector<HTMLElement>('span'), text = (c.getAttribute('aria-label') || span?.dataset.en || span?.textContent || host?.textContent || '').trim().slice(0, 60);
      const base = `${c instanceof HTMLSelectElement ? 'select' : c.hasAttribute('data-numtext') ? 'number' : c.type}:${text || `#${i}`}`, n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      out.push([n === 1 ? base : `${base}#${n}`, c]);
    });
    return out;
  }

  private saveRemembered(): void {
    const values: Record<string, DialogValue> = {};
    for (const [name, c] of this.rememberedControls()) values[name] = c instanceof HTMLInputElement && c.type === 'checkbox' ? c.checked : c.value;
    for (const [k, v] of Object.entries(this.memory?.extra?.read() ?? {})) values[`~${k}`] = v;
    const key = this.english, cur = loadPrefs().dialogValues;
    updatePrefs({ dialogValues: { ...cur, [key]: values } });
  }

  private restoreRemembered(): void {
    const m = this.memory, saved = loadPrefs().dialogValues[this.english];
    if (!m || !saved) return;
    m.busy = true;
    try {
      for (const [name, c] of this.rememberedControls()) {
        const v = saved[name];
        if (v === undefined) continue;
        if (c instanceof HTMLInputElement && c.type === 'checkbox') {
          if (typeof v !== 'boolean' || c.checked === v) continue;
          c.checked = v;
        } else {
          if (typeof v !== 'string' || c.value === v) continue;
          if (c instanceof HTMLSelectElement && !Array.from(c.options).some((o) => o.value === v && !o.disabled)) continue;
          c.value = v;
          if (c.value !== v) continue;
        }
        c.dispatchEvent(new Event('input', { bubbles: true }));
        c.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (m.extra) {
        const mine: Record<string, DialogValue> = {};
        for (const [k, v] of Object.entries(saved)) if (k.startsWith('~')) mine[k.slice(1)] = v;
        if (Object.keys(mine).length) m.extra.write(mine);
      }
    } finally { m.busy = false; }
  }

  open(focus?: HTMLElement | null): void {
    if (this.isOpen) return;
    this.relabel();
    this.restoreRemembered();
    this.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.getElementById('overlay-root')?.appendChild(this.scrim);
    this.scrim.hidden = false;
    const spot = Dialog.spots[this.english];
    if (spot) this.moveFrame(q<HTMLElement>(this.scrim, '.cv-dialog'), spot.x, spot.y);
    openCount++;
    openStack.push(this.fieldHistory);
    this.fieldHistory.start();
    const target = focus ?? this.scrim.querySelector<HTMLElement>('input, select, .cv-btn-primary:not(:disabled)');
    target?.focus();
    if (!this.scrim.contains(document.activeElement)) q<HTMLElement>(this.scrim, '.cv-dialog').focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.scrim.hidden = true;
    openCount--;
    this.fieldHistory.alt(false);
    const at = openStack.indexOf(this.fieldHistory);
    if (at >= 0) openStack.splice(at, 1);
    this.onClose?.();
    if (this.scrim.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    if (this.lastFocus && typeof this.lastFocus.focus === 'function') this.lastFocus.focus();
  }

  button(label: string, kind: '' | 'primary' | 'ghost' | 'danger', run: () => void): HTMLButtonElement {
    const b = el<HTMLButtonElement>(`<button class="cv-btn${kind ? ` cv-btn-${kind}` : ''}" type="button"></button>`);
    setText(b, t(label));
    b.dataset.en = label;
    b.dataset.shown = b.textContent ?? '';
    b.addEventListener('click', run);
    this.foot.appendChild(b);
    return b;
  }

  field(label: string, control: HTMLElement): HTMLElement {
    const row = el<HTMLElement>('<label class="cv-field"><span></span></label>');
    setText(q(row, 'span'), label);
    row.appendChild(control);
    this.body.appendChild(row);
    return row;
  }
}

export type SaveChoice = { choice: 'save' | 'discard' | 'cancel'; all: boolean };

class SaveChanges extends Dialog {
  private readonly question = el('<p class="cv-save-q">Save changes to <strong></strong>?</p>');
  private readonly all = el('<label class="cv-field cv-check" hidden><span>Apply to All</span><input type="checkbox"></label>');
  private readonly saveBtn: HTMLButtonElement;
  private resolve: ((v: SaveChoice) => void) | null = null;
  constructor() {
    super('Unsaved Changes', 460);
    q<HTMLElement>(this.scrim, '.cv-dialog').classList.add('cv-savechanges');
    this.body.append(this.question, el('<p class="cv-note">Your changes will be lost if you don’t save them.</p>'), this.all);
    this.button('Don’t Save', 'ghost', () => this.finish('discard')).classList.add('cv-btn-apart');
    this.button('Cancel', 'ghost', () => this.finish('cancel'));
    this.saveBtn = this.button('Save', 'primary', () => this.finish('save'));
    this.onClose = () => this.finish('cancel');
  }
  ask(name: string, many: boolean): Promise<SaveChoice> {
    const previous = this.resolve;
    this.resolve = null;
    previous?.({ choice: 'cancel', all: false });
    setText(this.question.querySelector('strong') as HTMLElement, name);
    this.all.hidden = !many;
    q<HTMLInputElement>(this.all, 'input').checked = false;
    this.open(this.saveBtn);
    return new Promise((r) => { this.resolve = r; });
  }
  private finish(v: 'save' | 'discard' | 'cancel'): void {
    const r = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    r?.({ choice: v, all: !this.all.hidden && q<HTMLInputElement>(this.all, 'input').checked });
  }
}

let saveChangesDialog: SaveChanges | null = null;

export function askSaveChanges(name: string): Promise<'save' | 'discard' | 'cancel'> {
  return askSaveChangesAll(name, false).then((a) => a.choice);
}

export function askSaveChangesAll(name: string, many = true): Promise<SaveChoice> {
  try {
    if (!windowDialogs()) throw new Error('no overlay root');
    saveChangesDialog ??= new SaveChanges();
    return saveChangesDialog.ask(name, many);
  } catch {
    const save = window.confirm(`Save changes to ${name}?`);
    const choice = save ? 'save' : window.confirm(`Discard the changes to ${name}? Cancel keeps the file open.`) ? 'discard' : 'cancel';
    return Promise.resolve({ choice, all: false });
  }
}

class Confirm extends Dialog {
  private readonly note = el<HTMLElement>('<p class="cv-note"></p>');
  private readonly ok: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private resolve: ((v: boolean) => void) | null = null;

  constructor() {
    super('Confirm', 400);
    this.body.appendChild(this.note);
    this.cancel = this.button('Cancel', 'ghost', () => this.finish(false));
    this.ok = this.button('OK', 'primary', () => this.finish(true));
    this.onClose = () => this.finish(false);
  }

  ask(title: string, text: string, okLabel: string, danger: boolean, cancelLabel = 'Cancel'): Promise<boolean> {
    const previous = this.resolve;
    this.resolve = null;
    previous?.(false);
    this.setTitle(title);
    setText(this.note, text);
    setText(this.ok, okLabel);
    setText(this.cancel, cancelLabel);
    this.ok.className = danger ? 'cv-btn cv-btn-danger' : 'cv-btn cv-btn-primary';
    this.open(danger ? this.cancel : this.ok);
    return new Promise<boolean>((resolve) => { this.resolve = resolve; });
  }

  private finish(v: boolean): void {
    const done = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    done?.(v);
  }
}

class Prompt extends Dialog {
  private readonly input = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false">');
  private readonly ok: HTMLButtonElement;
  private resolve: ((v: string | null) => void) | null = null;

  constructor() {
    super('Name', 400);
    this.field('Name', this.input);
    this.button('Cancel', 'ghost', () => this.finish(null));
    this.ok = this.button('OK', 'primary', () => this.finish(this.input.value.trim() || null));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.ok.click(); }
    });
    this.onClose = () => this.finish(null);
  }

  ask(title: string, value: string, okLabel: string): Promise<string | null> {
    const previous = this.resolve;
    this.resolve = null;
    previous?.(null);
    this.setTitle(title);
    setText(this.ok, okLabel);
    this.input.value = value;
    this.open(this.input);
    this.input.select();
    return new Promise<string | null>((resolve) => { this.resolve = resolve; });
  }

  private finish(v: string | null): void {
    const done = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    done?.(v);
  }
}

let confirmDlg: Confirm | null = null;
let promptDlg: Prompt | null = null;

const windowDialogs = (): boolean => !!document.getElementById('overlay-root');

export function confirmAction(title: string, text: string, okLabel = 'OK', danger = false, cancelLabel = 'Cancel'): Promise<boolean> {
  try {
    if (!windowDialogs()) throw new Error('no overlay root');
    confirmDlg ??= new Confirm();
    return confirmDlg.ask(title, text, okLabel, danger, cancelLabel);
  } catch {
    return Promise.resolve(window.confirm(`${title}\n\n${text}`));
  }
}

export function promptName(title: string, value: string, okLabel = 'OK'): Promise<string | null> {
  try {
    if (!windowDialogs()) throw new Error('no overlay root');
    promptDlg ??= new Prompt();
    return promptDlg.ask(title, value, okLabel);
  } catch {
    return Promise.resolve(window.prompt(title, value)?.trim() || null);
  }
}
