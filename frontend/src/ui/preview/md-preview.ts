import { el, q, setClass, setHidden } from '../dom';
import { isMarkdownPath } from '../editor/languages';
import { t } from '../i18n';
import { icon } from '../icons';
import type { WorkspaceStore } from '../workspace-store';
import { openExternal } from './external';
import { patch, renderMarkdown, resolveRelative } from './markdown';

export type PreviewMode = 'off' | 'side' | 'only';

export interface MarkdownDeps {
  store: WorkspaceStore;
  area: HTMLElement;
  text(path: string): string | null;
  openFile(path: string): void;
  hint(text: string): void;
}

const DEBOUNCE_MS = 140;
const IMAGE_WAIT_MS = 260;

export class MarkdownPreview {
  private readonly pane = el<HTMLElement>('<div class="cv-md-pane" hidden><div class="cv-md-scroll"><article class="cv-md-body"></article></div></div>');
  private readonly scroll = q(this.pane, '.cv-md-scroll');
  private readonly body = q(this.pane, '.cv-md-body');
  private readonly tools = el<HTMLElement>(`<div class="cv-md-tools" hidden>
<button class="cv-md-btn" type="button" data-cmd="md-preview-toggle" data-pressed="0" aria-pressed="false">${icon('eye', 16)}</button>
<button class="cv-md-btn" type="button" data-cmd="md-preview-side" data-pressed="0" aria-pressed="false">${icon('previewSide', 16)}</button>
</div>`);
  private readonly toggleBtn = q<HTMLButtonElement>(this.tools, '[data-cmd="md-preview-toggle"]');
  private readonly sideBtn = q<HTMLButtonElement>(this.tools, '[data-cmd="md-preview-side"]');
  private readonly modes = new Map<string, PreviewMode>();
  private readonly scrolls = new Map<string, number>();
  private shownPath = '';
  private lastText: string | null = null;
  private timer = 0;
  private frame = 0;
  private settling = 0;

  constructor(private readonly deps: MarkdownDeps) {
    deps.area.append(this.pane, this.tools);
    deps.store.on('active', () => this.sync());
    deps.store.on('docs', (list) => this.prune(list.map((d) => d.id)));
    this.body.addEventListener('click', (e) => this.click(e));
    this.scroll.addEventListener('scroll', () => { if (this.shownPath) this.scrolls.set(this.shownPath, this.scroll.scrollTop); }, { passive: true });
  }

  get activePath(): string | null {
    const doc = this.deps.store.active;
    return doc && doc.id === doc.path && isMarkdownPath(doc.path) ? doc.path : null;
  }

  mode(): PreviewMode {
    const path = this.activePath;
    return path ? this.modes.get(path) ?? 'off' : 'off';
  }

  set(mode: PreviewMode): void {
    const path = this.activePath;
    if (!path) return;
    this.modes.set(path, mode);
    this.sync();
  }

  toggle(): void { this.set(this.mode() === 'off' ? 'only' : 'off'); }

  side(): void { this.set(this.mode() === 'side' ? 'off' : 'side'); }

  changed(path: string): void {
    if (path !== this.activePath || this.mode() === 'off') return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.render(), DEBOUNCE_MS);
  }

  sync(): void {
    const path = this.activePath;
    const mode = path ? this.modes.get(path) ?? 'off' : 'off';
    setHidden(this.tools, !path);
    setClass(this.deps.area, 'is-md-side', mode === 'side');
    setClass(this.deps.area, 'is-md-only', mode === 'only');
    this.press(this.toggleBtn, mode === 'only');
    this.press(this.sideBtn, mode === 'side');
    setHidden(this.pane, mode === 'off');
    if (mode === 'off' || !path) return;
    if (this.shownPath !== path) {
      if (this.shownPath) this.scrolls.set(this.shownPath, this.scroll.scrollTop);
      this.shownPath = path;
      this.lastText = null;
    }
    this.render();
  }

  private press(btn: HTMLButtonElement, on: boolean): void {
    const v = on ? 'true' : 'false';
    if (btn.getAttribute('aria-pressed') !== v) btn.setAttribute('aria-pressed', v);
    setClass(btn, 'is-on', on);
  }

  private render(): void {
    const path = this.activePath;
    if (!path || this.mode() === 'off') return;
    const text = this.deps.text(path);
    if (text === null || text === this.lastText) return;
    this.lastText = text;
    const first = this.body.childNodes.length === 0 || this.body.dataset.path !== path;
    const next = renderMarkdown(text, path, () => { this.lastText = null; if (this.activePath === path) this.changed(path); });
    const keep = this.scrolls.get(path) ?? 0;
    if (first) {
      this.scroll.style.visibility = 'hidden';
      const seq = ++this.settling;
      this.body.dataset.path = path;
      patch(this.body, next);
      this.scroll.scrollTop = keep;
      const imgs = Array.from(this.body.querySelectorAll('img')).filter((i) => !i.complete);
      const reveal = (): void => {
        if (seq !== this.settling) return;
        this.scroll.scrollTop = keep;
        this.scroll.style.visibility = '';
      };
      if (imgs.length === 0) { reveal(); return; }
      const wait = new Promise<void>((r) => { window.setTimeout(r, IMAGE_WAIT_MS); });
      void Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), wait]).then(reveal);
      return;
    }
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => { patch(this.body, next); });
  }

  private click(e: MouseEvent): void {
    const a = e.target instanceof Element ? e.target.closest('a') : null;
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      const target = this.body.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      if (target) this.scroll.scrollTo({ top: target.offsetTop });
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
      void openExternal(href.startsWith('//') ? `https:${href}` : href);
      return;
    }
    const file = this.shownPath;
    const target = resolveRelative(file, decodeURIComponent(href.split(/[?#]/)[0]));
    if (target) this.deps.openFile(target);
  }

  private prune(ids: string[]): void {
    const live = new Set(ids);
    for (const path of Array.from(this.modes.keys())) if (!live.has(path)) { this.modes.delete(path); this.scrolls.delete(path); }
  }
}
