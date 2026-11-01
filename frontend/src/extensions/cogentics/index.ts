import { lazyPanel, register, type ExtensionContext, type Shell } from '../registry';
import type { InsightPanel } from './insight';

register({
  id: 'cogentics',
  name: 'Cogentics',
  description: 'Shared channels where you and agent members work on one ledger, with usage and per-turn changes.',
  setup(ctx: ExtensionContext, shell: Shell) {
    let insightPanel: InsightPanel | null = null;
    let insightStart: (() => Promise<void>) | null = null;
    const insightSection = shell.rightSection?.({
      id: 'insight',
      title: 'Insight',
      icon: 'gauge',
      render: (host) => { insightStart = lazyPanel(host, () => import('./insight'), (m) => { insightPanel = new m.InsightPanel(host, ctx); }); },
    });
    const section = shell.rightSection?.({
      id: 'cogentics',
      title: 'Cogentics',
      icon: 'wire',
      render: (host) => {
        lazyPanel(host, () => import('./panel'), (m) => {
          new m.CogenticsPanel(host, ctx, shell, (scope) => {
            insightSection?.reveal();
            void insightStart?.().then(() => insightPanel?.showScope(scope));
          });
        });
      },
    });
    ctx.commands.add(
      { id: 'cogentics-open', label: 'Show Cogentics Channels', run: () => { section?.reveal(); } },
      { id: 'insight-open', label: 'Show Usage and Changes', run: () => { insightSection?.reveal(); void insightStart?.().then(() => insightPanel?.load()); } },
    );
  },
});
