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

  let armed = false;
  let timer = 0;
  const disarm = (): void => { armed = false; window.clearTimeout(timer); };
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || anyDialogOpen()) return;
    if (armed) {
      if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Shift' || e.key === 'Alt') return;
      disarm();
      if (e.key.toLowerCase() === 'v' && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        d.commands.run('md-preview-side');
        return;
      }
      d.commands.run('command-palette');
      return;
    }
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'k' || md.activePath === null) return;
    e.preventDefault();
    e.stopPropagation();
    armed = true;
    timer = window.setTimeout(() => { if (!armed) return; armed = false; d.commands.run('command-palette'); }, CHORD_MS);
  }, true);

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
