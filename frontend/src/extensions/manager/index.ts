import { TRUST_EVENT } from '../../io/trust';
import { mountOnce } from '../../ui/dom';
import { onLanguage, t } from '../../ui/i18n';
import { setText } from '../../ui/dom';
import { lazyPanel, register, type ExtensionContext, type Shell } from '../registry';
import type { ExtensionsView } from './extensions-view';
import type { McpView } from './mcp-view';
import { tabs } from './parts';
import type { PluginsView } from './plugins-view';

export const MANAGER_PANEL = 'extensions';

register({
  id: 'manager',
  name: 'Extensions',
  description: 'List, enable and disable extensions, backend plugins and MCP servers.',
  required: true,
  setup(ctx: ExtensionContext, shell: Shell): void {
    let extensions: ExtensionsView | null = null;
    let plugins: PluginsView | null = null;
    let mcp: McpView | null = null;
    const loaded = new Set<number>();
    let viewsStart: (() => Promise<void>) | null = null;
    const labels = ['Extensions', 'Plugins', 'MCP'];
    const section = shell.sidebarSection({
      id: MANAGER_PANEL,
      title: 'Extensions',
      icon: 'libExt',
      render: (host) => {
        mountOnce(host, '<div class="cv-lib"></div>');
        const root = host.firstElementChild as HTMLElement;
        const bar = tabs(labels.map((l) => t(l)), (i) => {
          if (loaded.has(i)) return;
          loaded.add(i);
          if (i === 1) void plugins?.refresh();
          if (i === 2) void mcp?.refresh();
        });
        root.append(bar.root, ...bar.views);
        bar.show(0);
        const parts = (): Promise<[typeof import('./extensions-view'), typeof import('./mcp-view'), typeof import('./plugins-view')]> => Promise.all([import('./extensions-view'), import('./mcp-view'), import('./plugins-view')]);
        viewsStart = lazyPanel(host, parts, ([ev, mv, pv]) => {
          extensions = new ev.ExtensionsView(bar.views[0]);
          plugins = new pv.PluginsView(bar.views[1]);
          mcp = new mv.McpView(bar.views[2]);
          for (const i of loaded) {
            if (i === 1) void plugins.refresh();
            if (i === 2) void mcp.refresh();
          }
        });
        const buttons = Array.from(bar.root.querySelectorAll<HTMLElement>('.cv-lib-tab'));
        onLanguage(() => buttons.forEach((b, i) => setText(b, t(labels[i]))));
      },
    });
    const reload = (): void => {
      if (loaded.has(1)) void plugins?.refresh();
      if (loaded.has(2)) void mcp?.refresh();
    };
    ctx.store.on('workspace', reload);
    window.addEventListener(TRUST_EVENT, reload);
    ctx.commands.add({ id: 'extensions-open', label: 'Extensions', run: () => { section.reveal(); void viewsStart?.().then(() => extensions?.render()); } });
  },
});
