import type { Commands } from '../commands';
import { t } from '../i18n';
import type { Views } from '../review/views';
import type { WorkspaceStore } from '../workspace-store';
import { studio, STUDIO_OPEN } from './api';
import { loadSaved, newGraph, saveCurrent } from './studio-file';
import { StudioTab, STUDIO_ID } from './studio-view';

export { studio } from './api';
export type { StudioAction, Selection } from './api';

export function installStudio(store: WorkspaceStore, commands: Commands, views: Views): void {
  let tab: StudioTab | null = null;
  let path = `${t('Studio')}: ${studio.getDoc().name}`;

  const retitle = (next: string): void => {
    if (next === path) return;
    path = next;
    const doc = store.docs.find((d) => d.id === STUDIO_ID);
    if (doc && store.active?.id === STUDIO_ID) store.openDoc({ id: STUDIO_ID, name: doc.name, path, modified: doc.modified });
  };

  const show = (): void => {
    if (!store.workspace) return;
    path = `${t('Studio')}: ${studio.getDoc().name}`;
    views.open(STUDIO_ID, { name: t('Studio'), path }, () => {
      tab = new StudioTab(retitle, (dirty) => views.setModified(STUDIO_ID, dirty));
      return tab;
    });
    views.show(STUDIO_ID);
    tab?.focusCanvas();
  };

  const open = async (name: string | null): Promise<boolean> => {
    if (!store.workspace) return false;
    if (name !== null && !(await loadSaved(name))) return false;
    show();
    if (name !== null) tab?.requestFit();
    return true;
  };

  studio.setOpener(open);
  window.addEventListener(STUDIO_OPEN, (e) => {
    const name = (e as CustomEvent<{ name?: string } | null>).detail?.name;
    void open(typeof name === 'string' ? name : null);
  });
  store.on('workspace', () => {
    if (!store.workspace) studio.setFile(null);
  });

  commands.add(
    { id: 'view-studio', label: 'Studio', keys: ['Alt+Shift+S'], enabled: () => !!store.workspace, run: show },
    {
      id: 'studio-new',
      label: 'New Graph',
      enabled: () => !!store.workspace,
      run: () => { void newGraph().then((ok) => { if (ok) { show(); tab?.requestFit(); } }); },
    },
    {
      id: 'studio-save',
      label: 'Save Graph',
      enabled: () => !!store.workspace && store.active?.id === STUDIO_ID,
      run: () => { void saveCurrent(); },
    },
  );
}
