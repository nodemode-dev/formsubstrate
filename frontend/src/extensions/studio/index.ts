import { installPreset, listPresets, listSavedGraphs, type GraphPreset, type SavedGraph } from '../../io/studio';
import { el, patchList, q, setClass, setHidden, setText, setTitle } from '../../ui/dom';
import { t, tn } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { toast } from '../../ui/toast';
import { studio, STUDIO_FILE, STUDIO_GRAPHS_CHANGED } from '../../ui/studio/api';
import { newGraph, removeSaved } from '../../ui/studio/studio-file';
import { register, type ExtensionContext, type Shell } from '../registry';

class GraphsPanel {
  private readonly saved: HTMLElement;
  private readonly presets: HTMLElement;
  private readonly savedEmpty: HTMLElement;
  private readonly presetEmpty: HTMLElement;
  private readonly count: HTMLElement;
  private rows: SavedGraph[] = [];
  private offered: GraphPreset[] = [];
  private generation = 0;
  private presetsLoaded = false;

  constructor(host: HTMLElement, private readonly ctx: ExtensionContext) {
    host.append(el(
      '<div class="cv-sg">' +
      '<div class="cv-sg-bar"><span class="cv-sg-count"></span>' +
      `<button class="cv-wb-tool" type="button" data-act="new">${icon('plus', 14)}</button>` +
      `<button class="cv-wb-tool" type="button" data-act="open">${icon('studio', 14)}</button>` +
      `<button class="cv-wb-tool" type="button" data-act="refresh">${icon('refresh', 14)}</button></div>` +
      '<p class="cv-sg-h" data-h="saved"></p><div class="cv-sg-list" data-list="saved"></div><p class="cv-sg-empty cv-note" data-empty="saved"></p>' +
      '<p class="cv-sg-h" data-h="presets"></p><div class="cv-sg-list" data-list="presets"></div><p class="cv-sg-empty cv-note" data-empty="presets"></p>' +
      '</div>'));
    this.saved = q(host, '[data-list="saved"]');
    this.presets = q(host, '[data-list="presets"]');
    this.savedEmpty = q(host, '[data-empty="saved"]');
    this.presetEmpty = q(host, '[data-empty="presets"]');
    this.count = q(host, '.cv-sg-count');
    setText(q(host, '[data-h="saved"]'), t('Saved graphs'));
    setText(q(host, '[data-h="presets"]'), t('Presets'));
    setText(this.savedEmpty, t('No saved graphs. Build one in Studio and save it.'));
    setText(this.presetEmpty, t('Presets could not be loaded.'));
    const tips: Record<string, string> = { new: 'New graph', open: 'Open Studio', refresh: 'Refresh' };
    for (const b of Array.from(host.querySelectorAll<HTMLButtonElement>('[data-act]'))) {
      const tip = t(tips[b.dataset.act ?? ''] ?? '');
      setTitle(b, tip);
      b.setAttribute('aria-label', tip);
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'new') void newGraph().then((ok) => { if (ok) void studio.open(null); });
        else if (act === 'open') void studio.open(null);
        else void this.refresh();
      });
    }
    this.saved.addEventListener('click', (e) => this.onSaved(e));
    this.presets.addEventListener('click', (e) => this.onPreset(e));
    window.addEventListener(STUDIO_GRAPHS_CHANGED, () => { void this.refresh(); });
    window.addEventListener(STUDIO_FILE, () => this.paintActive());
    ctx.store.on('workspace', () => { void this.refresh(); });
    this.paint();
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const gen = ++this.generation;
    if (!this.ctx.store.workspace) {
      this.rows = [];
      this.paint();
      return;
    }
    try {
      const rows = await listSavedGraphs();
      if (gen !== this.generation) return;
      this.rows = rows;
    } catch {
      if (gen !== this.generation) return;
      this.rows = [];
    }
    if (!this.presetsLoaded) {
      try {
        this.offered = await listPresets();
        this.presetsLoaded = true;
      } catch {
        this.offered = [];
      }
    }
    this.paint();
  }

  private paint(): void {
    patchList<SavedGraph>(this.saved, this.rows, {
      key: (r) => r.name,
      create: (r) => {
        const n = el<HTMLElement>(`<div class="cv-sg-row" role="button" tabindex="0"><span class="cv-sg-ico">${icon('studio', 14)}</span><span class="cv-sg-name"></span><span class="cv-sg-meta"></span><button class="cv-sg-del" type="button" data-del="1">${icon('delete', 12)}</button></div>`);
        setTitle(q(n, '.cv-sg-del'), t('Delete graph'));
        this.updateRow(n, r);
        return n;
      },
      update: (n, r) => this.updateRow(n, r),
    });
    patchList<GraphPreset>(this.presets, this.offered, {
      key: (p) => p.name,
      create: (p) => {
        const n = el<HTMLElement>(`<div class="cv-sg-row cv-sg-preset" role="button" tabindex="0"><span class="cv-sg-ico">${icon('plus', 14)}</span><span class="cv-sg-name"></span><span class="cv-sg-meta"></span></div>`);
        setText(q(n, '.cv-sg-name'), p.name);
        setText(q(n, '.cv-sg-meta'), tn(p.nodes, '{n} node', '{n} nodes'));
        setTitle(n, p.description);
        return n;
      },
      update: () => undefined,
    });
    setHidden(this.savedEmpty, this.rows.length > 0);
    setHidden(this.presetEmpty, this.offered.length > 0);
    setText(this.count, this.rows.length ? tn(this.rows.length, '{n} graph', '{n} graphs') : '');
    this.paintActive();
  }

  private updateRow(n: HTMLElement, r: SavedGraph): void {
    setText(q(n, '.cv-sg-name'), r.name);
    setText(q(n, '.cv-sg-meta'), r.valid ? tn(r.nodes, '{n} node', '{n} nodes') : t('invalid'));
    setClass(n, 'is-invalid', !r.valid);
    setTitle(n, r.path);
    n.dataset.name = r.name;
    setClass(n, 'is-active', studio.fileName === r.name);
  }

  private paintActive(): void {
    for (const n of Array.from(this.saved.children) as HTMLElement[]) setClass(n, 'is-active', n.dataset.name === studio.fileName);
  }

  private onSaved(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    const row = target?.closest<HTMLElement>('.cv-sg-row');
    const name = row?.dataset.name;
    if (!name) return;
    if (target?.closest('[data-del]')) {
      void removeSaved(name);
      return;
    }
    void studio.open(name);
  }

  private onPreset(e: MouseEvent): void {
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-sg-row') : null;
    const name = row?.dataset.key;
    if (!name) return;
    const exists = this.rows.some((r) => r.name === name);
    const done = async (): Promise<void> => {
      try {
        if (!exists) await installPreset(name);
        studio.graphsChanged();
        await studio.open(name);
      } catch (err) {
        toast(err instanceof Error ? err.message.replace(/^\d{3}\s*/, '') : String(err), 'error');
      }
    };
    void done();
  }
}

register({
  id: 'studio',
  name: 'Studio',
  description: 'The node canvas where agent graphs are built, with the JSON kept in sync and graphs saved in .subform/graphs.',
  setup(ctx: ExtensionContext, shell: Shell): void {
    const section = shell.sidebarSection({
      id: 'graphs',
      title: 'Graphs',
      icon: 'studio',
      render: (host) => { new GraphsPanel(host, ctx); },
    });
    ctx.commands.add({
      id: 'studio-graphs',
      label: 'Show Saved Graphs',
      enabled: () => !!ctx.store.workspace,
      run: () => section.reveal(),
    });
  },
});
