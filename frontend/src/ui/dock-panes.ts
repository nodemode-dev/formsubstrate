import { el, patchList, q, setClass, setHidden, setText, setTitle } from './dom';
import { onLanguage, t } from './i18n';
import { icon } from './icons';

export interface DockPane {
  id: string;
  title: string;
  icon: string;
  build(host: HTMLElement): void;
  shown?(): void;
}

const panes = new Map<string, DockPane>();
const listeners = new Set<() => void>();
let opener: ((id: string) => void) | null = null;

export function registerDockPane(pane: DockPane): void {
  panes.set(pane.id, pane);
  for (const fn of listeners) fn();
}

export function setPaneOpener(fn: (id: string) => void): void {
  opener = fn;
}

export function openDockPane(id: string): void {
  opener?.(id);
}

export class DockPanes {
  private active = '';
  private readonly hosts = new Map<string, HTMLElement>();

  constructor(private readonly bar: HTMLElement, private readonly stage: HTMLElement, private readonly pick: (id: string) => void) {
    bar.addEventListener('click', (e) => {
      const id = e.target instanceof Element ? e.target.closest<HTMLElement>('.ft-dock-ptab')?.dataset.key : undefined;
      if (id) this.pick(id);
    });
    listeners.add(() => this.sync());
    onLanguage(() => this.sync());
    this.sync();
  }

  get current(): string {
    return this.active;
  }

  show(id: string): void {
    const pane = panes.get(id);
    if (!pane) return;
    let host = this.hosts.get(id);
    if (!host) {
      host = el<HTMLElement>(`<div class="ft-pane" data-pane="${id}"></div>`);
      this.stage.append(host);
      this.hosts.set(id, host);
      pane.build(host);
    }
    for (const [key, node] of this.hosts) setHidden(node, key !== id);
    this.active = id;
    this.sync();
    pane.shown?.();
  }

  hide(): void {
    if (!this.active) return;
    this.active = '';
    for (const node of this.hosts.values()) setHidden(node, true);
    this.sync();
  }

  private sync(): void {
    patchList(this.bar, [...panes.values()], {
      key: (p) => p.id,
      create: (p) => el<HTMLElement>(`<button type="button" class="ft-dock-tab ft-dock-ptab" role="tab" tabindex="-1">${icon(p.icon, 14)}<span class="ft-dock-tab-title"></span></button>`),
      update: (node, p) => {
        const label = t(p.title);
        setText(q(node, '.ft-dock-tab-title'), label);
        setTitle(node, label);
        const on = p.id === this.active;
        setClass(node, 'is-on', on);
        if (node.getAttribute('aria-selected') !== String(on)) node.setAttribute('aria-selected', String(on));
      },
    });
    setHidden(this.bar, panes.size === 0);
  }
}
