import { el, patchList, q, setClass, setText, setTitle } from './dom';
import { icon } from './icons';
import type { OpenDoc, WorkspaceStore } from './workspace-store';

const APP = 'subform';

export class Tabs {
  private frame = 0;
  private activeId: string | null = null;
  private windowTitle: string | null = null;

  constructor(private readonly strip: HTMLElement, private readonly store: WorkspaceStore, private readonly requestClose: (id: string) => void, private readonly docTitle?: HTMLElement) {
    store.on('docs', () => this.queue());
    store.on('active', () => this.queue());
    const tabOf = (e: Event): HTMLElement | null => (e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-tab[data-key]') : null);
    strip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target instanceof Element && e.target.closest('.cv-tab-close'))) return;
      const tab = tabOf(e);
      if (tab?.dataset.key) this.store.setActive(tab.dataset.key);
    });
    strip.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const tab = tabOf(e);
      if (!tab?.dataset.key) return;
      e.preventDefault();
      this.requestClose(tab.dataset.key);
    });
    strip.addEventListener('click', (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.cv-tab-close')) return;
      const tab = tabOf(e);
      if (tab?.dataset.key) this.requestClose(tab.dataset.key);
    });
    this.render();
  }

  private queue(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }

  private render(): void {
    const current = this.store.active;
    patchList<OpenDoc>(this.strip, [...this.store.docs], {
      key: (d) => d.id,
      create: (d) => {
        const n = el(`<div class="cv-tab" role="tab"><span class="cv-tab-dot"></span><span class="cv-tab-name"></span><button class="cv-tab-close" type="button" aria-label="Close tab">${icon('close', 12)}</button></div>`);
        this.update(n, d, current);
        return n;
      },
      update: (n, d) => this.update(n, d, current),
    });
    const shown = current ? `${current.modified ? '• ' : ''}${current.name}` : '';
    setText(this.docTitle ?? null, shown);
    const title = current ? `${shown} - ${APP}` : APP;
    if (this.windowTitle !== title) {
      this.windowTitle = title;
      document.title = title;
      if ('__TAURI_INTERNALS__' in window) void import('@tauri-apps/api/core').then((m) => m.invoke('set_window_title', { title })).catch(() => undefined);
    }
    if ((current?.id ?? null) !== this.activeId) {
      this.activeId = current?.id ?? null;
      const tab = Array.from(this.strip.children).find((c) => (c as HTMLElement).dataset.key === this.activeId);
      tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  private update(n: HTMLElement, d: OpenDoc, current: OpenDoc | null): void {
    setText(q(n, '.cv-tab-name'), d.name);
    const active = !!current && d.id === current.id;
    setClass(n, 'is-active', active);
    setClass(n, 'is-dirty', d.modified);
    if (n.getAttribute('aria-selected') !== String(active)) n.setAttribute('aria-selected', String(active));
    setTitle(n, d.path);
  }
}
