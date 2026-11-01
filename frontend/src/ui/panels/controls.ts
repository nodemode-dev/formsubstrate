import { el, escapeHtml, q, setChecked, setText, setValue } from '../dom';
import { enhanceSelect } from '../dropdown';

export interface Row<T> { el: HTMLElement; set(v: T): void }

export const fmt = (v: number): string => String(Number(v.toFixed(3)));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function sliderRow(label: string, min: number, max: number, step: number, onInput: (v: number) => void, limits: { min?: number; max?: number; def?: number; log?: boolean } = {}): Row<number> {
  const lo = limits.min ?? min, hi = limits.max ?? max;
  const log = limits.log === true && min > 0 && max > min;
  const toPos = (v: number): number => (log ? Math.round((1000 * Math.log(clamp(v, min, max) / min)) / Math.log(max / min)) : v);
  const fromPos = (p: number): number => (log ? clamp(Number((min * Math.pow(max / min, p / 1000)).toPrecision(3)), min, max) : p);
  const root = el(`<div class="cv-field cv-slider"><span></span><div class="cv-slider-ctl"><input type="range" min="${log ? 0 : min}" max="${log ? 1000 : max}" step="${log ? 1 : step}"><input class="cv-num" type="number" min="${lo}" max="${hi}" step="${step}"></div></div>`);
  setText(q(root, 'span'), label);
  const range = q(root, 'input[type="range"]') as HTMLInputElement;
  const box = q(root, 'input.cv-num') as HTMLInputElement;
  range.setAttribute('aria-label', label);
  box.setAttribute('aria-label', `${label} value`);
  const fill = (): void => { const lo2 = Number(range.min), span = Number(range.max) - lo2; range.style.setProperty('--pct', `${span > 0 ? clamp(((range.valueAsNumber - lo2) / span) * 100, 0, 100) : 0}%`); };
  range.addEventListener('input', fill);
  range.addEventListener('input', () => {
    const v = fromPos(range.valueAsNumber);
    box.value = fmt(v);
    onInput(v);
  });
  box.addEventListener('change', () => {
    const raw = box.valueAsNumber;
    if (!Number.isFinite(raw)) return;
    const v = clamp(raw, lo, hi);
    box.value = fmt(v);
    range.value = String(toPos(v));
    fill();
    onInput(v);
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.blur(); } });
  if (limits.def !== undefined) {
    const def = limits.def;
    const reset = (): void => { range.value = String(toPos(def)); fill(); box.value = fmt(def); onInput(def); };
    q(root, 'span').addEventListener('dblclick', reset);
    range.addEventListener('dblclick', reset);
    q(root, 'span').title = 'Double-click to reset';
  }
  const lab = q(root, 'span');
  let scrub: { x: number; v: number; id: number; on: boolean } | null = null;
  lab.classList.add('cv-scrub');
  lab.addEventListener('pointerdown', (e) => { if (e.button === 0) { scrub = { x: e.clientX, v: range.valueAsNumber, id: e.pointerId, on: false }; lab.setPointerCapture(e.pointerId); } });
  lab.addEventListener('pointermove', (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const dx = e.clientX - scrub.x;
    if (!scrub.on) { if (Math.abs(dx) < 3) return; scrub.on = true; }
    const per = ((log ? 1000 : max - min) / 250) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
    range.value = log ? String(clamp(Math.round(scrub.v + dx * per), 0, 1000)) : String(clamp(Number((Math.round((scrub.v + dx * per) / step) * step).toFixed(6)), min, max));
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const endScrub = (e: PointerEvent): void => { if (lab.hasPointerCapture(e.pointerId)) lab.releasePointerCapture(e.pointerId); scrub = null; };
  lab.addEventListener('pointerup', endScrub);
  lab.addEventListener('pointercancel', endScrub);
  fill();
  return { el: root, set(v) { range.value = String(toPos(v)); fill(); setValue(box, fmt(v)); } };
}

export function selectRow(label: string, options: ReadonlyArray<readonly [string, string]>, onChange: (v: string) => void, onHover?: (v: string | null) => void): Row<string> {
  const root = el(`<label class="cv-field"><span></span><select class="cv-input">${options.map(([v, t]) => `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`).join('')}</select></label>`);
  setText(q(root, 'span'), label);
  const sel = q(root, 'select') as HTMLSelectElement;
  sel.addEventListener('change', () => onChange(sel.value));
  if (onHover) enhanceSelect(sel, { onHover });
  return { el: root, set(v) { if (sel.value !== v) sel.value = v; } };
}

export function checkRow(label: string, onChange: (v: boolean) => void): Row<boolean> {
  const root = el('<label class="cv-field cv-check"><span></span><input type="checkbox"></label>');
  setText(q(root, 'span'), label);
  const box = q(root, 'input') as HTMLInputElement;
  box.addEventListener('change', () => onChange(box.checked));
  return { el: root, set(v) { setChecked(box, v); } };
}

const TOGGLE_TRACK = '<span class="cv-toggle-track"><span class="cv-toggle-knob"></span></span>';

export function toggleRow(label: string, onChange: (v: boolean) => void): Row<boolean> {
  const root = el(`<label class="cv-field cv-toggle-row"><span></span><span class="cv-toggle"><input type="checkbox">${TOGGLE_TRACK}</span></label>`);
  setText(q(root, 'span'), label);
  const box = q(root, 'input') as HTMLInputElement;
  box.addEventListener('change', () => onChange(box.checked));
  return { el: root, set(v) { setChecked(box, v); } };
}

export function toggleOf(box: HTMLInputElement): HTMLLabelElement {
  const node = el<HTMLLabelElement>(`<label class="cv-toggle">${TOGGLE_TRACK}</label>`);
  node.prepend(box);
  return node;
}

export function colorRow(label: string, onChange: (hex: string) => void): Row<string> {
  const root = el('<label class="cv-field"><span></span><input class="cv-input cv-color" type="color"></label>');
  setText(q(root, 'span'), label);
  const inp = q(root, 'input') as HTMLInputElement;
  inp.addEventListener('input', () => onChange(inp.value));
  return { el: root, set(v) { setValue(inp, v); } };
}

export function numberRow(label: string, min: number, max: number, step: number, onChange: (v: number) => void): Row<number> & { input: HTMLInputElement } {
  const root = el(`<label class="cv-field"><span></span><input class="cv-input" type="number" min="${min}" max="${max}" step="${step}"></label>`);
  setText(q(root, 'span'), label);
  const input = q(root, 'input') as HTMLInputElement;
  input.addEventListener('input', () => { const v = input.valueAsNumber; if (Number.isFinite(v)) onChange(v); });
  return { el: root, input, set(v) { setValue(input, fmt(v)); } };
}
