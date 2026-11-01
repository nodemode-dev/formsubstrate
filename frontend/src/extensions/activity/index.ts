import { mountOnce } from '../../ui/dom';
import { lazyPanel, register, type ExtensionContext, type Shell } from '../registry';

export type { RunEvent } from './panel';

register({
  id: 'activity',
  name: 'Activity',
  description: 'Live feed of tool calls, plugin and MCP changes, collection writes and Studio runs, with phase filters.',
  setup(_ctx: ExtensionContext, shell: Shell): void {
    if (!shell.rightSection) return;
    const section = shell.rightSection({
      id: 'activity',
      title: 'Activity',
      icon: 'libPulse',
      render: (host) => {
        mountOnce(host, '<div class="cv-lib-host"></div>');
        lazyPanel(host, () => import('./panel'), (m) => { new m.ActivityPanel(host.firstElementChild as HTMLElement); });
      },
    });
    _ctx.commands.add({ id: 'activity-open', label: 'Activity', run: () => { shell.toggleRight?.(true); section.reveal(); } });
  },
});
