import type { Commands } from '../commands';
import { t } from '../i18n';
import type { Views } from '../review/views';
import type { WorkspaceStore } from '../workspace-store';
import { GRAPH_ID, GraphTab } from './graph-view';

export const OPEN_GRAPH = 'subform:open-graph';

export function installGraph(store: WorkspaceStore, commands: Commands, views: Views, openFile: (path: string) => void): void {
  const open = (): void => {
    const ws = store.workspace;
    if (!ws) return;
    views.open(GRAPH_ID, { name: t('Graph'), path: `${t('File graph')}: ${ws.name}` }, () => new GraphTab(ws.path, openFile));
    views.show(GRAPH_ID);
  };

  window.addEventListener(OPEN_GRAPH, open);

  commands.add({
    id: 'view-graph',
    label: 'File Graph',
    keys: ['Alt+Shift+G'],
    enabled: () => !!store.workspace,
    run: open,
  });
}
