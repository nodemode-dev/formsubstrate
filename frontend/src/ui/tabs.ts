import { el, patchList, q, setClass, setText, setTitle } from './dom';
import { icon } from './icons';
import { t } from './i18n';
import type { OpenDoc, WorkspaceStore } from './workspace-store';

const APP = 'Substrate';

export class Tabs {
  private frame = 0;
  private activeId: string | null = null;
  private windowTitle: string | null = null;
  private rover: string | null = null;
  private closing: { id: string; next: string | null } | null = null;

  constructor(private readonly strip: HTMLElement, private readonly store: WorkspaceStore, private readonly requestClose: (id: string) => void | Promise<unknown>, private readonly docTitle?: HTMLElement) {
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
    strip.addEventListener('keydown', (e) => this.onKey(e, tabOf(e)));
    strip.addEventListener('focusin', (e) => {
      const tab = tabOf(e);
      if (tab?.dataset.key && tab.dataset.key !== this.rover) { this.rover = tab.dataset.key; this.queue(); }
    });
    this.render();
  }

  private onKey(e: KeyboardEvent, tab: HTMLElement | null): void {
    const id = tab?.dataset.key;
    if (!id) return;
    const fromClose = e.target instanceof Element && !!e.target.closest('.cv-tab-close');
    const mod = e.ctrlKey || e.metaKey;
    this.closing = null;
    if ((e.key === 'Enter' || e.key === ' ') && !fromClose && !mod) {
      e.preventDefault();
      this.store.setActive(id);
      return;
    }
    if (e.key === 'Delete' || (mod && !e.shiftKey && !e.altKey && e.code === 'KeyW')) {
      e.preventDefault();
      e.stopPropagation();
      const ids = this.store.docs.map((d) => d.id), at = ids.indexOf(id);
      const left = ids.filter((d) => d !== id);
      this.closing = { id, next: left[Math.min(at, left.length - 1)] ?? null };
      void Promise.resolve(this.requestClose(id)).catch((err: unknown) => console.warn('closing the tab failed', err)).then(() => {
        if (this.closing?.id === id && this.store.docs.some((d) => d.id === id)) this.closing = null;
      });
      return;
    }
    const ids = this.store.docs.map((d) => d.id), n = ids.length, at = ids.indexOf(id);
    let to = -1;
    if (e.key === 'ArrowRight') to = (at + 1) % n;
    else if (e.key === 'ArrowLeft') to = (at - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to < 0 || at < 0) return;
    e.preventDefault();
    this.focusTab(ids[to]);
  }

  private focusTab(id: string): void {
    this.rover = id;
    this.render();
    this.node(id)?.focus();
  }

  private node(id: string): HTMLElement | null {
    return (Array.from(this.strip.children) as HTMLElement[]).find((c) => c.dataset.key === id) ?? null;
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
        const n = el(`<div class="cv-tab" role="tab" tabindex="-1"><span class="cv-tab-dot"></span><span class="cv-tab-name"></span><button class="cv-tab-close" type="button" tabindex="-1" aria-label="${t('Close tab')}">${icon('close', 12)}</button></div>`);
        this.update(n, d, current);
        return n;
      },
      update: (n, d) => this.update(n, d, current),
    });
    const docs = this.store.docs;
    if (this.rover && !docs.some((d) => d.id === this.rover)) this.rover = null;
    const stop = this.rover ?? current?.id ?? docs[0]?.id ?? null;
    for (const child of Array.from(this.strip.children) as HTMLElement[]) {
      const want = child.dataset.key === stop ? '0' : '-1';
      if (child.getAttribute('tabindex') !== want) child.setAttribute('tabindex', want);
    }
    if (this.closing && !docs.some((d) => d.id === this.closing?.id)) {
      const next = this.closing.next;
      this.closing = null;
      if (next && this.node(next)) { this.rover = next; this.node(next)?.setAttribute('tabindex', '0'); this.node(next)?.focus(); }
    }
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
