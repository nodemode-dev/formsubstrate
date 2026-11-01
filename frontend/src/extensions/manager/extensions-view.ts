import { el, patchList, q, setClass, setHidden, setText, setTitle } from '../../ui/dom';
import { onLanguage, t, tn } from '../../ui/i18n';
import { toast } from '../../ui/toast';
import { listExtensions, setEnabled } from '../registry';
import { setToggle, toggle, type Toggle } from './parts';

interface Item {
  id: string;
  name: string;
  description: string;
  required: boolean;
  enabled: boolean;
  active: boolean;
}

interface Refs {
  name: HTMLElement;
  state: HTMLElement;
  desc: HTMLElement;
  tg: Toggle;
  item: Item;
}

const pretty = (id: string): string => id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export class ExtensionsView {
  private readonly search: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly refs = new WeakMap<HTMLElement, Refs>();

  constructor(private readonly host: HTMLElement) {
    host.append(el(
      '<div class="cv-lib-pane">' +
      '<div class="cv-lib-bar"><input class="cv-input cv-lib-search" type="text" spellcheck="false" autocomplete="off"><span class="cv-lib-count"></span></div>' +
      '<div class="cv-lib-list" role="list"></div>' +
      '<p class="cv-note cv-lib-empty" hidden></p></div>'));
    this.search = q(host, '.cv-lib-search');
    this.count = q(host, '.cv-lib-count');
    this.list = q(host, '.cv-lib-list');
    this.empty = q(host, '.cv-lib-empty');
    this.search.addEventListener('input', () => this.render());
    onLanguage(() => { this.relabel(); this.render(); });
    this.relabel();
    this.render();
  }

  private relabel(): void {
    this.search.placeholder = t('Search extensions');
    this.search.setAttribute('aria-label', t('Search extensions'));
  }

  private items(): Item[] {
    const wanted = this.search.value.trim().toLowerCase();
    return listExtensions()
      .map((e) => ({ id: e.id, name: e.name ?? pretty(e.id), description: e.description ?? '', required: e.required === true, enabled: e.enabled, active: e.active }))
      .filter((i) => !wanted || `${i.id} ${i.name} ${i.description}`.toLowerCase().includes(wanted))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  render(): void {
    const items = this.items();
    patchList(this.list, items, {
      key: (i) => i.id,
      create: (i) => this.create(i),
      update: (node, i) => this.update(node, i),
    });
    setText(this.count, tn(items.length, '{n} extension', '{n} extensions'));
    setHidden(this.empty, items.length > 0);
    setText(this.empty, t('No extensions match'));
  }

  private create(item: Item): HTMLElement {
    const node = el(
      '<div class="cv-lib-row cv-lib-ext" role="listitem">' +
      '<div class="cv-lib-main"><div class="cv-lib-top"><span class="cv-lib-name"></span><span class="cv-lib-chip"></span></div>' +
      '<div class="cv-lib-desc"></div></div></div>');
    const tg = toggle(item.name);
    node.append(tg.root);
    const refs: Refs = { name: q(node, '.cv-lib-name'), state: q(node, '.cv-lib-chip'), desc: q(node, '.cv-lib-desc'), tg, item };
    this.refs.set(node, refs);
    tg.input.addEventListener('change', () => {
      const want = tg.input.checked;
      const outcome = setEnabled(refs.item.id, want);
      if (outcome === 'reload') toast(`${refs.item.name}: ${t('disabled; reload the window to unload its panels')}`);
      else if (outcome === 'active') toast(`${refs.item.name}: ${t('enabled')}`);
      this.render();
    });
    this.update(node, item);
    return node;
  }

  private update(node: HTMLElement, item: Item): void {
    const refs = this.refs.get(node);
    if (!refs) return;
    refs.item = item;
    setText(refs.name, t(item.name));
    setText(refs.desc, t(item.description));
    setTitle(refs.desc, t(item.description));
    const state = item.required ? 'Core' : !item.enabled ? 'Off' : item.active ? 'On' : 'Reload';
    setText(refs.state, t(state));
    refs.state.dataset.state = state.toLowerCase();
    setClass(node, 'is-off', !item.enabled);
    setToggle(refs.tg, item.enabled, item.required, item.required ? t('Core extensions stay on') : t(item.enabled ? 'Disable' : 'Enable'));
  }
}
