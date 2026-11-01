import { detailOf } from '../../io/workspace';
import { Dialog } from '../../ui/dialogs';
import { el, setDisabled, setText } from '../../ui/dom';
import { enhanceSelect } from '../../ui/dropdown';
import { t } from '../../ui/i18n';
import { keepMode, placeholdersOf, recipesApi, savedMode, type RecipeInput, type RecipeRow, type RunStarted } from './client';

const MODES: ReadonlyArray<readonly [string, string]> = [['simulate', 'Simulator (no model)'], ['claude', 'Claude Code']];

export function fillModes(select: HTMLSelectElement): void {
  for (const [value, label] of MODES) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = t(label);
    select.append(o);
  }
}

export class RunDialog extends Dialog {
  private readonly intro = el('<p class="cv-note cv-rc-intro"></p>');
  private readonly fields = el('<div class="cv-rc-fields"></div>');
  private readonly mode = el<HTMLSelectElement>('<select class="cv-input" data-f="mode"></select>');
  private readonly problem = el('<p class="cv-note cv-rc-problem"></p>');
  private readonly run: HTMLButtonElement;
  private recipe: RecipeRow | null = null;
  private busy = false;

  constructor(private readonly done: (r: RunStarted) => void) {
    super('Run Recipe', 480);
    fillModes(this.mode);
    this.body.append(this.intro, this.fields);
    this.field('Run with', this.mode);
    enhanceSelect(this.mode);
    this.body.append(this.problem);
    this.button('Cancel', 'ghost', () => this.close());
    this.run = this.button('Run', 'primary', () => { void this.send(); });
    this.mode.addEventListener('change', () => keepMode(this.mode.value));
    this.fields.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); void this.send(); }
    });
  }

  show(recipe: RecipeRow): void {
    if (this.isOpen) return;
    this.recipe = recipe;
    this.setTitle(`${t('Run Recipe')}: ${recipe.name}`);
    setText(this.intro, recipe.description || t('This recipe takes no inputs.'));
    this.fields.replaceChildren(...recipe.inputs.map((i) => this.row(i)));
    setText(this.problem, '');
    this.mode.value = savedMode();
    this.busy = false;
    setDisabled(this.run, false);
    this.open();
    void recipesApi.env().then((env) => {
      if (!env.claude && this.mode.value === 'claude') { this.mode.value = 'simulate'; setText(this.problem, t('Claude Code was not found on this computer; the simulator is selected.')); }
    }).catch(() => undefined);
    (this.fields.querySelector('input') ?? this.mode).focus();
  }

  private row(i: RecipeInput): HTMLElement {
    const input = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off">');
    input.dataset.name = i.name;
    input.value = i.default ?? '';
    input.placeholder = i.placeholder ?? '';
    const row = el(`<label class="cv-field"><span></span></label>`);
    setText(row.firstElementChild as HTMLElement, `${i.label || i.name}${i.required ? ' *' : ''}`);
    row.append(input);
    return row;
  }

  private async send(): Promise<void> {
    if (!this.recipe || this.busy) return;
    const inputs: Record<string, string> = {};
    for (const input of Array.from(this.fields.querySelectorAll<HTMLInputElement>('input'))) {
      if (input.value.trim()) inputs[input.dataset.name ?? ''] = input.value.trim();
    }
    for (const spec of this.recipe.inputs) {
      if (spec.required && !inputs[spec.name] && !spec.default) { setText(this.problem, `${t('Missing required input')}: ${spec.name}`); return; }
    }
    this.busy = true;
    setDisabled(this.run, true);
    try {
      const started = await recipesApi.run(this.recipe.name, inputs, this.mode.value);
      this.close();
      this.done(started);
    } catch (err) {
      setText(this.problem, detailOf(err));
    } finally {
      this.busy = false;
      setDisabled(this.run, false);
    }
  }
}

export class NewRecipeDialog extends Dialog {
  private readonly name = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" maxlength="64">');
  private readonly about = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" maxlength="300">');
  private readonly graph = el<HTMLSelectElement>('<select class="cv-input"></select>');
  private readonly template = el<HTMLTextAreaElement>('<textarea class="cv-input cv-rc-template" rows="4" spellcheck="false"></textarea>');
  private readonly derived = el('<p class="cv-note cv-rc-derived"></p>');
  private readonly problem = el('<p class="cv-note cv-rc-problem"></p>');
  private readonly save: HTMLButtonElement;
  private busy = false;

  constructor(private readonly done: (name: string) => void) {
    super('New Recipe', 500);
    this.name.placeholder = t('review-before-release');
    this.template.placeholder = t('Do this: {goal}');
    this.field('Name', this.name);
    this.field('Description', this.about);
    this.field('Graph', this.graph);
    enhanceSelect(this.graph);
    this.field('Task template', this.template);
    this.body.append(this.derived, this.problem);
    this.button('Cancel', 'ghost', () => this.close());
    this.save = this.button('Save recipe', 'primary', () => { void this.send(); });
    this.template.addEventListener('input', () => this.sync());
    this.name.addEventListener('input', () => this.sync());
  }

  async show(): Promise<void> {
    if (this.isOpen) return;
    this.name.value = '';
    this.about.value = '';
    this.template.value = '';
    setText(this.problem, '');
    this.graph.replaceChildren();
    this.sync();
    this.open();
    this.name.focus();
    try {
      const { graphs } = await recipesApi.graphs();
      const usable = graphs.filter((g) => g.valid);
      for (const g of usable) {
        const o = document.createElement('option');
        o.value = g.name;
        o.textContent = `${g.name} (${g.nodes})`;
        this.graph.append(o);
      }
      if (!usable.length) setText(this.problem, t('Save a graph in the Studio first; a recipe wraps a saved graph.'));
    } catch (err) {
      setText(this.problem, detailOf(err));
    }
    this.sync();
  }

  private sync(): void {
    const names = placeholdersOf(this.template.value).map((i) => i.name);
    setText(this.derived, names.length ? `${t('Inputs asked for')}: ${names.join(', ')}` : t('Use {placeholders} in the template to ask for inputs.'));
    setDisabled(this.save, this.busy || !this.name.value.trim() || !this.graph.value);
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.sync();
    try {
      const file = await recipesApi.graph(this.graph.value);
      const parsed = JSON.parse(file.text) as Record<string, unknown>;
      const doc = (typeof parsed.doc === 'object' && parsed.doc ? parsed.doc : parsed) as Record<string, unknown>;
      const name = this.name.value.trim();
      await recipesApi.save({ name, description: this.about.value.trim(), doc, task_template: this.template.value, inputs: placeholdersOf(this.template.value), skills: [] });
      this.close();
      this.done(name);
    } catch (err) {
      setText(this.problem, detailOf(err));
    } finally {
      this.busy = false;
      this.sync();
    }
  }
}
