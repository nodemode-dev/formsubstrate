import { openDockPane, registerDockPane } from '../../ui/dock-panes';
import { register, type ExtensionContext } from '../registry';
import { ConsolePane } from './pane';

register({
  id: 'console',
  name: 'Console',
  description: 'Operator console in the terminal dock: health, approvals, providers and engine status.',
  setup(ctx: ExtensionContext) {
    registerDockPane({
      id: 'console',
      title: 'Console',
      icon: 'consoleTab',
      build: (host) => { new ConsolePane(host, ctx); },
    });
    ctx.commands.add({ id: 'console-open', label: 'Show Console', run: () => { openDockPane('console'); } });
  },
});
