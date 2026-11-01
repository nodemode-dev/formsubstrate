import { ApiError } from '../../io/api';
import { el, q, setClass, setText } from '../../ui/dom';
import { t } from '../../ui/i18n';
import { toast } from '../../ui/toast';

export const TOOLS_CHANGED = 'subform:tools-changed';

export function toolsChanged(): void {
  window.dispatchEvent(new Event(TOOLS_CHANGED));
}

export interface Toggle {
  root: HTMLLabelElement;
  input: HTMLInputElement;
}

export function toggle(label: string): Toggle {
  const root = el<HTMLLabelElement>('<label class="cv-toggle"><input type="checkbox"><span class="cv-toggle-track"><span class="cv-toggle-knob"></span></span></label>');
  const input = q<HTMLInputElement>(root, 'input');
  input.setAttribute('aria-label', label);
  return { root, input };
}

export function setToggle(tg: Toggle, on: boolean, disabled = false, label?: string): void {
  if (tg.input.checked !== on) tg.input.checked = on;
  if (tg.input.disabled !== disabled) tg.input.disabled = disabled;
  if (label && tg.input.getAttribute('aria-label') !== label) tg.input.setAttribute('aria-label', label);
}

export interface Tabs {
  root: HTMLElement;
  views: HTMLElement[];
  show(index: number): void;
}

export function tabs(labels: string[], onShow?: (index: number) => void): Tabs {
  const root = el(`<div class="cv-lib-tabs" role="tablist">${labels.map((l, i) => `<button class="cv-lib-tab" type="button" role="tab" data-i="${i}">${l}</button>`).join('')}</div>`);
  const views = labels.map(() => el('<div class="cv-lib-view" role="tabpanel" hidden></div>'));
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.cv-lib-tab'));
  const show = (index: number): void => {
    buttons.forEach((b, i) => {
      setClass(b, 'is-active', i === index);
      b.setAttribute('aria-selected', String(i === index));
    });
    views.forEach((v, i) => { if (v.hidden !== (i !== index)) v.hidden = i !== index; });
    onShow?.(index);
  };
  root.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.cv-lib-tab') : null;
    if (b) show(Number(b.dataset.i));
  });
  return { root, views, show };
}

export function fail(err: unknown, what: string): void {
  const detail = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
  toast(`${t(what)}: ${detail}`, 'error');
}

export function patchChip(node: HTMLElement, text: string, shown: boolean): void {
  if (node.hidden !== !shown) node.hidden = !shown;
  setText(node, text);
}

export function ago(ts: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
