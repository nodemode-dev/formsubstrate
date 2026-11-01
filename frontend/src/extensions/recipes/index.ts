import { detailOf } from '../../io/workspace';
import { confirmAction } from '../../ui/dialogs';
import { el, mountOnce, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { onLanguage, t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { toast } from '../../ui/toast';
import { FOCUS_EVENT } from '../../ui/workbench';
import { register, type ExtensionContext, type Shell, type SidebarSection } from '../registry';
import { RECIPES_CHANGED, RUN_STARTED, recipesApi, type RecipeRow, type RunStarted } from './client';
import { NewRecipeDialog, RunDialog } from './dialogs';

type Entry =
  | { key: string; kind: 'head'; label: string; count: number }
  | { key: string; kind: 'recipe'; row: RecipeRow }
  | { key: string; kind: 'preset'; row: RecipeRow };

class RecipesPanel {
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly note: HTMLElement;
  private readonly newBtn: HTMLButtonElement;
  private readonly refreshBtn: HTMLButtonElement;
  private readonly runDialog: RunDialog;
  private readonly newDialog: NewRecipeDialog;
  private recipes: RecipeRow[] = [];
  private presets: RecipeRow[] = [];
  private problem = '';
  private loaded = false;
  private seq = 0;
  private frame = 0;

  constructor(private readonly host: HTMLElement, private readonly ctx: ExtensionContext, private readonly shell: Shell) {
    mountOnce(host, `<div class="cv-rc">
<div class="cv-rc-bar"><span class="cv-rc-spacer"></span><button class="cv-wb-tool cv-rc-new" type="button">${icon('plus', 14)}</button><button class="cv-wb-tool cv-rc-refresh" type="button">${icon('refresh', 14)}</button></div>
<p class="cv-rc-note cv-note" role="status"></p>
<div class="cv-rc-body"><div class="cv-rc-list" role="list"></div><p class="cv-rc-empty cv-note"></p></div>
</div>`);
    this.list = q(host, '.cv-rc-list');
    this.empty = q(host, '.cv-rc-empty');
    this.note = q(host, '.cv-rc-note');
    this.newBtn = q<HTMLButtonElement>(host, '.cv-rc-new');
    this.refreshBtn = q<HTMLButtonElement>(host, '.cv-rc-refresh');
    this.runDialog = new RunDialog((r) => this.started(r));
    this.newDialog = new NewRecipeDialog((name) => { toast(`${t('Recipe saved')}: ${name}`); void this.load(); });
    this.newBtn.addEventListener('click', () => { void this.newDialog.show(); });
    this.refreshBtn.addEventListener('click', () => { void this.load(); });
    this.list.addEventListener('click', (e) => this.onClick(e));
    host.addEventListener(FOCUS_EVENT, () => { void this.load(); });
    ctx.store.on('workspace', () => { void this.load(); });
    window.addEventListener(RECIPES_CHANGED, () => { void this.load(); });
    onLanguage(() => this.schedule());
    this.paint();
    void this.load();
  }

  newRecipe(): void { void this.newDialog.show(); }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  async load(): Promise<void> {
    const mine = ++this.seq;
    if (!this.ctx.store.workspace) {
      this.recipes = [];
      this.presets = [];
      this.problem = '';
      this.loaded = true;
      this.paint();
      return;
    }
    try {
      const reply = await recipesApi.list();
      if (mine !== this.seq) return;
      this.recipes = reply.recipes;
      this.presets = reply.presets.filter((p) => !p.installed);
      this.problem = reply.note;
    } catch (err) {
      if (mine !== this.seq) return;
      this.problem = detailOf(err);
    }
    this.loaded = true;
    this.paint();
  }

  private started(r: RunStarted): void {
    toast(`${t('Recipe running')}: ${r.recipe} · ${r.run_id}`);
    this.shell.setStatus(`${r.recipe}: run ${r.run_id}`);
    window.dispatchEvent(new CustomEvent(RUN_STARTED, { detail: r }));
  }

  private onClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    const row = target?.closest<HTMLElement>('.cv-rc-row');
    if (!row) return;
    const name = row.dataset.name ?? '';
    const act = target?.closest<HTMLElement>('[data-act]')?.dataset.act ?? (row.dataset.kind === 'recipe' ? 'run' : '');
    if (act === 'run') {
      const recipe = this.recipes.find((r) => r.name === name);
      if (recipe) this.runDialog.show(recipe);
    } else if (act === 'remove') void this.remove(name);
    else if (act === 'install') void this.install(name);
  }

  private async remove(name: string): Promise<void> {
    if (!(await confirmAction('Delete recipe', `${name}: ${t('removes the recipe file from this workspace.')}`, 'Delete', true))) return;
    try {
      await recipesApi.remove(name);
      toast(`${t('Recipe deleted')}: ${name}`);
    } catch (err) {
      toast(detailOf(err), 'error');
    }
    await this.load();
  }

  private async install(name: string): Promise<void> {
    try {
      await recipesApi.install(name);
      toast(`${t('Recipe installed')}: ${name}`);
    } catch (err) {
      toast(detailOf(err), 'error');
    }
    await this.load();
  }

  private entries(): Entry[] {
    const out: Entry[] = [];
    if (this.recipes.length) {
      out.push({ key: 'h:recipes', kind: 'head', label: 'Recipes', count: this.recipes.length });
      for (const row of this.recipes) out.push({ key: `r:${row.name}`, kind: 'recipe', row });
    }
    if (this.presets.length) {
      out.push({ key: 'h:presets', kind: 'head', label: 'Presets', count: this.presets.length });
      for (const row of this.presets) out.push({ key: `p:${row.name}`, kind: 'preset', row });
    }
    return out;
  }

  private create(entry: Entry): HTMLElement {
    if (entry.kind === 'head') return el('<div class="cv-rc-head" role="presentation"><span class="cv-rc-head-t"></span><span class="cv-rc-count"></span></div>');
    const act = entry.kind === 'recipe'
      ? `<button class="cv-wb-tool" type="button" data-act="run">${icon('play', 12)}</button><button class="cv-wb-tool" type="button" data-act="remove">${icon('delete', 12)}</button>`
      : `<button class="cv-wb-tool" type="button" data-act="install">${icon('download', 12)}</button>`;
    return el(`<div class="cv-rc-row" role="listitem" data-kind="${entry.kind}"><span class="cv-rc-mark">${icon('rcpBook', 14)}</span><span class="cv-rc-main"><span class="cv-rc-name"></span><span class="cv-rc-desc"></span></span><span class="cv-rc-acts">${act}</span></div>`);
  }

  private update(node: HTMLElement, entry: Entry): void {
    if (entry.kind === 'head') {
      setText(q(node, '.cv-rc-head-t'), t(entry.label));
      setText(q(node, '.cv-rc-count'), String(entry.count));
      return;
    }
    node.dataset.name = entry.row.name;
    setText(q(node, '.cv-rc-name'), entry.row.name);
    setText(q(node, '.cv-rc-desc'), entry.row.description);
    setTitle(node, entry.row.description);
    for (const b of Array.from(node.querySelectorAll<HTMLButtonElement>('[data-act]'))) {
      const label = t(b.dataset.act === 'run' ? 'Run' : b.dataset.act === 'remove' ? 'Delete' : 'Install');
      const named = `${label} ${entry.row.name}`;
      setTitle(b, label);
      if (b.getAttribute('aria-label') !== named) b.setAttribute('aria-label', named);
    }
  }

  private paint(): void {
    const ws = !!this.ctx.store.workspace;
    setTitle(this.newBtn, t('New recipe from a saved graph'));
    setTitle(this.refreshBtn, t('Refresh'));
    setDisabled(this.newBtn, !ws);
    setDisabled(this.refreshBtn, !ws);
    patchList(this.list, this.entries(), { key: (e) => e.key, create: (e) => { const n = this.create(e); this.update(n, e); return n; }, update: (n, e) => this.update(n, e) });
    const none = this.loaded && !this.recipes.length && !this.presets.length;
    setText(this.empty, !ws ? t('Open a folder to use recipes.') : none ? t('No recipes yet.') : '');
    setHidden(this.empty, !(this.empty.textContent ?? ''));
    setText(this.note, this.problem);
    setClass(this.note, 'is-error', !!this.problem);
  }
}

register({
  id: 'recipes',
  name: 'Recipes',
  description: 'Parameterised bundles of a graph, a task template and declared inputs, run from a form.',
  setup(ctx: ExtensionContext, shell: Shell): void {
    let panel: RecipesPanel | null = null;
    const section: SidebarSection = shell.sidebarSection({
      id: 'recipes',
      title: 'Recipes',
      icon: 'rcpBook',
      render: (host) => { panel = new RecipesPanel(host, ctx, shell); },
    });
    ctx.commands.add(
      { id: 'recipes-panel', label: 'Recipes', run: () => { section.reveal(); } },
      { id: 'recipes-new', label: 'New Recipe...', mutates: true, enabled: () => !!ctx.store.workspace, run: () => { section.reveal(); panel?.newRecipe(); } },
    );
  },
});
