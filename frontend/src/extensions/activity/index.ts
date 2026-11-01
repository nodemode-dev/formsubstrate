import { mountOnce } from '../../ui/dom';
import { register, type ExtensionContext, type Shell } from '../registry';
import { ActivityPanel } from './panel';

export { RUN_EVENT, RUN_STARTED, type RunEvent } from './panel';

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
        new ActivityPanel(host.firstElementChild as HTMLElement);
      },
    });
    _ctx.commands.add({ id: 'activity-open', label: 'Activity', run: () => { shell.toggleRight?.(true); section.reveal(); } });
  },
});
