import { TRUST_EVENT } from '../../io/trust';
import { mountOnce, setText } from '../../ui/dom';
import { onLanguage, t } from '../../ui/i18n';
import { BlocksPanel } from '../blocks/panel';
import { tabs } from '../manager/parts';
import { register, type ExtensionContext, type Shell } from '../registry';
import { TOOLS_CHANGED, ToolsPanel } from './panel';

export { TOOLS_CHANGED } from './panel';

register({
  id: 'tools',
  name: 'Tools and blocks',
  description: 'The live tool registry with a call form, and the blocks for the editor and the Studio palette.',
  setup(ctx: ExtensionContext, shell: Shell): void {
    let panel: ToolsPanel | null = null;
    const labels = ['Tools', 'Blocks'];
    const section = shell.sidebarSection({
      id: 'tools',
      title: 'Tools',
      icon: 'nkTool',
      render: (host) => {
        mountOnce(host, '<div class="cv-lib"></div>');
        const root = host.firstElementChild as HTMLElement;
        const bar = tabs(labels.map((l) => t(l)));
        root.append(bar.root, ...bar.views);
        panel = new ToolsPanel(bar.views[0]);
        new BlocksPanel(bar.views[1]);
        bar.show(0);
        const buttons = Array.from(bar.root.querySelectorAll<HTMLElement>('.cv-lib-tab'));
        onLanguage(() => buttons.forEach((b, i) => setText(b, t(labels[i]))));
      },
    });
    const refresh = (): void => { void panel?.refresh(); };
    ctx.store.on('workspace', refresh);
    window.addEventListener(TRUST_EVENT, refresh);
    window.addEventListener(TOOLS_CHANGED, refresh);
    ctx.commands.add({ id: 'tools-open', label: 'Tools', run: () => { section.reveal(); refresh(); } });
    refresh();
  },
});
