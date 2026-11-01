import { PALETTE_CHORD } from '../command-palette';
import type { Commands } from '../commands';
import { anyDialogOpen } from '../dialogs';
import { isMac } from '../dom';
import type { EditorHost } from '../editor/editor';
import { baseName } from '../editor/languages';
import type { Views } from '../review/views';
import type { WorkspaceStore } from '../workspace-store';
import { mediaKindOf } from './media';
import { MarkdownPreview } from './md-preview';
import { MediaTab } from './media-tab';

export { mediaKindOf } from './media';

export interface PreviewDeps {
  store: WorkspaceStore;
  commands: Commands;
  views: Views;
  area: HTMLElement;
  editor: EditorHost;
  openFile(path: string): void;
  hint(text: string): void;
}

export interface PreviewApi {
  openMedia(path: string): boolean;
}

const CHORD_MS = 700;

export const mediaDocId = (path: string): string => `media:${path}`;

export function installPreview(d: PreviewDeps): PreviewApi {
  const md = new MarkdownPreview({
    store: d.store,
    area: d.area,
    text: (path) => d.editor.textOf(path),
    openFile: d.openFile,
    hint: d.hint,
  });
  d.editor.onChanged = (path) => md.changed(path);

  d.commands.add(
    { id: 'md-preview-toggle', label: 'Toggle Markdown Preview', keys: ['Shift+Mod+V'], enabled: () => md.activePath !== null, checked: () => md.mode() === 'only', run: () => md.toggle() },
    { id: 'md-preview-side', label: 'Open Preview to the Side', enabled: () => md.activePath !== null, checked: () => md.mode() === 'side', run: () => md.side() },
  );

  let chordAt = -CHORD_MS;
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || anyDialogOpen()) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'k' || md.activePath === null) return;
    chordAt = performance.now();
  }, true);
  window.addEventListener(PALETTE_CHORD, (e) => {
    if (!(e instanceof CustomEvent) || performance.now() - chordAt >= CHORD_MS) return;
    const detail: unknown = e.detail;
    if (typeof detail !== 'object' || detail === null || !('key' in detail) || !('close' in detail)) return;
    if (detail.key !== 'v' || typeof detail.close !== 'function' || md.activePath === null) return;
    e.preventDefault();
    chordAt = -CHORD_MS;
    detail.close();
    d.commands.run('md-preview-side');
  });

  return {
    openMedia(path: string): boolean {
      const kind = mediaKindOf(path);
      if (!kind) return false;
      const id = mediaDocId(path);
      d.views.open(id, { name: baseName(path), path }, () => new MediaTab(path, kind));
      d.views.show(id);
      return true;
    },
  };
}
