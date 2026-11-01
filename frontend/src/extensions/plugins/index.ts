import { library } from '../../io/library';
import { t } from '../../ui/i18n';
import { toast } from '../../ui/toast';
import { fail, toolsChanged } from '../manager/parts';
import { register, type ExtensionContext } from '../registry';

export { PluginsView } from '../manager/plugins-view';

register({
  id: 'plugins',
  name: 'Plugins',
  description: 'Backend Python plugins and connectors with settings; bundled ones and, in a trusted workspace, .subform/plugins.',
  setup(ctx: ExtensionContext): void {
    ctx.commands.add({
      id: 'plugins-reload',
      label: 'Reload Plugins',
      enabled: () => !!ctx.store.workspace,
      run: () => {
        library.reloadPlugins().then((d) => { toast(`${t('Plugins reloaded')}: ${d.plugins.length}`); toolsChanged(); }, (err: unknown) => fail(err, 'Plugin action failed'));
      },
    });
  },
});
