import { openDockPane, registerDockPane } from '../../ui/dock-panes';
import { idleLoad, register, type ExtensionContext } from '../registry';

register({
  id: 'console',
  name: 'Console',
  description: 'Operator console in the terminal dock: health, approvals, providers and engine status.',
  setup(ctx: ExtensionContext) {
    registerDockPane({
      id: 'console',
      title: 'Console',
      icon: 'consoleTab',
      build: (host) => { void import('./pane').then((m) => { new m.ConsolePane(host, ctx); }); },
    });
    idleLoad(() => import('./pane'));
    ctx.commands.add({ id: 'console-open', label: 'Show Console', run: () => { openDockPane('console'); } });
  },
});
