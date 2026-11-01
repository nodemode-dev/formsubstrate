import { mountOnce } from '../../ui/dom';
import { register, type ExtensionContext, type Shell } from '../registry';
import { CollectionsPanel } from './panel';

register({
  id: 'collections',
  name: 'Collections',
  description: 'Knowledge collections of the workspace, searched with relevance ranking that avoids near-duplicates.',
  setup(ctx: ExtensionContext, shell: Shell): void {
    if (!shell.rightSection) return;
    let panel: CollectionsPanel | null = null;
    const section = shell.rightSection({
      id: 'collections',
      title: 'Collections',
      icon: 'libStack',
      render: (host) => {
        mountOnce(host, '<div class="cv-lib-host"></div>');
        panel = new CollectionsPanel(host.firstElementChild as HTMLElement);
        void panel.refresh();
      },
    });
    ctx.store.on('workspace', () => { void panel?.refresh(); });
    ctx.commands.add({ id: 'collections-open', label: 'Collections', run: () => { shell.toggleRight?.(true); section.reveal(); void panel?.refresh(); } });
  },
});
