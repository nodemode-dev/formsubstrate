import { el, patchList, setHidden, setText } from './dom';
import { icon } from './icons';

interface Entry { key: string; head: boolean; text: string; value: string; chosen: boolean }

export function enhanceSelect(select: HTMLSelectElement, opts: { search?: string; onHover?: (value: string | null) => void } = {}): void {
  const btn = el<HTMLButtonElement>(`<button class="cv-dd-btn" type="button" aria-haspopup="listbox"><span class="cv-dd-label"></span>${icon('chevronDown', 12)}</button>`);
  const pop = el(`<div class="cv-dd-pop" role="listbox" hidden>${opts.search ? '<input class="cv-dd-search" type="search">' : ''}<div class="cv-dd-list"></div></div>`);
  const list = pop.querySelector('.cv-dd-list') as HTMLElement, search = pop.querySelector('.cv-dd-search') as HTMLInputElement | null;
  if (search) { search.placeholder = opts.search as string; search.setAttribute('aria-label', opts.search as string); }
  const nameOf = (): string => {
    const own = select.getAttribute('aria-label')?.trim() || select.title.trim();
    if (own) return own;
    const lab = select.labels?.[0];
    if (!lab) return '';
    const copy = lab.cloneNode(true) as HTMLElement;
    for (const s of Array.from(copy.querySelectorAll('select, .cv-dd-btn, .cv-dd-pop'))) s.remove();
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  for (const c of Array.from(select.classList)) if (c !== 'cv-dd-native') btn.classList.add(c);
  new MutationObserver(() => label()).observe(select, { childList: true, subtree: true });
  btn.title = select.title;
  select.classList.add('cv-dd-native');
  select.after(btn);
  const host = document.getElementById('overlay-root');
  if (host) host.appendChild(pop); else document.body.appendChild(pop);
  let picked = 0;
  const labelNode = btn.querySelector('.cv-dd-label') as HTMLElement;
  const label = (): void => {
    setText(labelNode, select.selectedOptions[0]?.textContent ?? '');
    btn.disabled = select.disabled;
    const name = nameOf();
    if (name && btn.getAttribute('aria-label') !== name) btn.setAttribute('aria-label', name);
    if (btn.title !== select.title) btn.title = select.title;
  };
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value') as PropertyDescriptor;
  Object.defineProperty(select, 'value', { configurable: true, get() { return proto.get?.call(select); }, set(v) { proto.set?.call(select, v); label(); } });
  const disabled = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'disabled') as PropertyDescriptor;
  Object.defineProperty(select, 'disabled', { configurable: true, get() { return disabled.get?.call(select); }, set(v) { disabled.set?.call(select, v); label(); } });
  select.addEventListener('change', label);

  const items = (): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>('.cv-dd-item'));
  const mark = (): void => { items().forEach((i, n) => i.classList.toggle('is-picked', n === picked)); };

  const create = (e: Entry): HTMLElement => {
    const node = build(e);
    update(node, e);
    return node;
  };
  const build = (e: Entry): HTMLElement => {
    if (e.head) return el('<div class="cv-dd-head"></div>');
    const item = el<HTMLButtonElement>(`<button class="cv-dd-item" type="button" role="option"><span></span>${icon('check', 14)}</button>`);
    item.addEventListener('click', () => {
      const v = item.dataset.value ?? '';
      if (select.value !== v) { select.value = v; select.dispatchEvent(new Event('change', { bubbles: true })); }
      close();
    });
    item.addEventListener('pointerenter', () => { picked = items().indexOf(item); mark(); opts.onHover?.(item.dataset.value ?? null); });
    return item;
  };
  const update = (node: HTMLElement, e: Entry): void => {
    if (e.head) { setText(node, e.text); return; }
    setText(node.querySelector('span'), e.text);
    node.dataset.value = e.value;
    if (node.classList.contains('is-chosen') !== e.chosen) node.classList.toggle('is-chosen', e.chosen);
    const sel = String(e.chosen);
    if (node.getAttribute('aria-selected') !== sel) node.setAttribute('aria-selected', sel);
  };

  const fill = (): void => {
    const q = search?.value.trim().toLowerCase() ?? '';
    const entries: Entry[] = [];
    for (const node of Array.from(select.children)) {
      const group = node instanceof HTMLOptGroupElement ? node : null, options = group ? Array.from(group.children) as HTMLOptionElement[] : [node as HTMLOptionElement];
      const shown = options.filter((o) => !o.hidden && (!q || (o.textContent ?? '').toLowerCase().includes(q)));
      if (!shown.length) continue;
      if (group && !q) entries.push({ key: `g:${group.label}`, head: true, text: group.label, value: '', chosen: false });
      for (const o of shown) entries.push({ key: `o:${o.value}`, head: false, text: o.textContent ?? '', value: o.value, chosen: o.value === select.value });
    }
    patchList(list, entries, { key: (e) => e.key, create, update });
    picked = q ? 0 : Math.max(0, items().findIndex((i) => i.classList.contains('is-chosen')));
    mark();
  };
  const close = (): void => { setHidden(pop, true); btn.setAttribute('aria-expanded', 'false'); opts.onHover?.(null); };
  const open = (): void => {
    if (search) search.value = '';
    fill();
    setHidden(pop, false);
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect(), h = pop.offsetHeight;
    pop.style.minWidth = `${Math.round(r.width)}px`;
    pop.style.left = `${Math.round(Math.min(r.left, window.innerWidth - pop.offsetWidth - 4))}px`;
    pop.style.top = `${Math.round(r.bottom + 4 + h <= window.innerHeight - 4 ? r.bottom + 4 : Math.max(4, r.top - 4 - h))}px`;
    (search ?? (list.querySelector('.is-chosen') as HTMLElement | null) ?? btn).focus();
    (list.querySelector('.is-chosen') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  };
  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  search?.addEventListener('input', () => { fill(); opts.onHover?.(null); });
  list.addEventListener('pointerleave', () => opts.onHover?.(null));
  pop.addEventListener('keydown', (e) => {
    const all = items();
    if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (all.length) {
        picked = (picked + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length;
        mark();
        all[picked].scrollIntoView({ block: 'nearest' });
        opts.onHover?.(all[picked].dataset.value ?? null);
      }
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); all[picked]?.click(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target as Node) && !btn.contains(e.target as Node)) close(); }, true);
  label();
}

export function enhanceAllSelects(root: ParentNode = document): void {
  const eligible = (s: HTMLSelectElement): boolean => !s.classList.contains('cv-dd-native') && !s.multiple && !s.hasAttribute('size') && !s.hasAttribute('data-native');
  const pick = (n: ParentNode): void => {
    for (const s of Array.from(n.querySelectorAll<HTMLSelectElement>('select:not(.cv-dd-native):not([multiple]):not([size]):not([data-native])'))) enhanceSelect(s);
  };
  pick(root);
  new MutationObserver((records) => {
    for (const r of records) {
      for (const node of Array.from(r.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue;
        if (node instanceof HTMLSelectElement) { if (eligible(node)) enhanceSelect(node); } else pick(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
