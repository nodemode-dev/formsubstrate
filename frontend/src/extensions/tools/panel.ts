import { library, type JsonSchema, type ToolDef } from '../../io/library';
import { el, patchList, q, setClass, setHidden, setText, setTitle } from '../../ui/dom';
import { onLanguage, t, tn } from '../../ui/i18n';
import { replaceGroup, type Block } from '../blocks/registry';
import { fail, TOOLS_CHANGED } from '../manager/parts';

export { TOOLS_CHANGED };

interface Refs {
  name: HTMLElement;
  source: HTMLElement;
  desc: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  fields: HTMLElement;
  result: HTMLElement;
  def: ToolDef;
  built: boolean;
}

const coerce = (spec: { type?: string } | undefined, raw: string): unknown => {
  if (spec?.type === 'integer' || spec?.type === 'number') return Number(raw);
  if (spec?.type === 'boolean') return raw === 'true' || raw === '1';
  if (spec?.type === 'object' || spec?.type === 'array') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
};

export function toBlocks(defs: ToolDef[]): { tools: Block[]; mcp: Block[] } {
  const tools: Block[] = [];
  const mcp: Block[] = [];
  for (const d of defs) {
    const isMcp = d.source.startsWith('mcp:');
    const block: Block = {
      id: `tool:${d.function.name}`,
      group: isMcp ? 'mcp' : 'tool',
      label: d.function.name,
      hint: d.function.description,
      icon: isMcp ? 'libServer' : 'nkTool',
      tool: { name: d.function.name, source: d.source, parameters: d.function.parameters as JsonSchema },
    };
    (isMcp ? mcp : tools).push(block);
  }
  return { tools, mcp };
}

export class ToolsPanel {
  private readonly search: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly refs = new WeakMap<HTMLElement, Refs>();
  private defs: ToolDef[] = [];
  private open = '';
  private loaded = false;

  constructor(host: HTMLElement) {
    host.append(el(
      '<div class="cv-lib-pane">' +
      '<div class="cv-lib-bar"><input class="cv-input cv-lib-search" type="text" spellcheck="false" autocomplete="off"><span class="cv-lib-count"></span></div>' +
      '<div class="cv-lib-list" role="list"></div><p class="cv-note cv-lib-empty" hidden></p></div>'));
    this.search = q(host, '.cv-lib-search');
    this.count = q(host, '.cv-lib-count');
    this.list = q(host, '.cv-lib-list');
    this.empty = q(host, '.cv-lib-empty');
    this.search.addEventListener('input', () => this.render());
    onLanguage(() => { this.relabel(); this.render(); });
    this.relabel();
  }

  private relabel(): void {
    this.search.placeholder = t('Search tools');
    this.search.setAttribute('aria-label', t('Search tools'));
  }

  async refresh(): Promise<void> {
    try {
      this.defs = (await library.tools()).tools;
    } catch {
      this.defs = [];
    }
    this.loaded = true;
    const split = toBlocks(this.defs);
    replaceGroup('tool', split.tools);
    replaceGroup('mcp', split.mcp);
    this.render();
  }

  private render(): void {
    const wanted = this.search.value.trim().toLowerCase();
    const shown = this.defs.filter((d) => !wanted || `${d.function.name} ${d.function.description} ${d.source}`.toLowerCase().includes(wanted));
    patchList(this.list, shown, {
      key: (d) => d.function.name,
      create: (d) => this.create(d),
      update: (node, d) => this.update(node, d),
    });
    setText(this.count, tn(shown.length, '{n} tool', '{n} tools'));
    setHidden(this.empty, shown.length > 0 || !this.loaded);
    setText(this.empty, t('No tools match'));
  }

  private create(def: ToolDef): HTMLElement {
    const node = el(
      '<div class="cv-lib-block" role="listitem"><button class="cv-lib-row cv-lib-tool" type="button">' +
      '<div class="cv-lib-main"><div class="cv-lib-top"><span class="cv-lib-name"></span><span class="cv-lib-chip"></span></div><div class="cv-lib-desc"></div></div></button>' +
      '<div class="cv-lib-form cv-tool-body" hidden><div class="cv-lib-fields"></div>' +
      '<div class="cv-lib-formbar"><button class="cv-lib-btn cv-tool-call" type="button"></button></div><pre class="cv-lib-result"></pre></div></div>');
    const refs: Refs = { name: q(node, '.cv-lib-name'), source: q(node, '.cv-lib-chip'), desc: q(node, '.cv-lib-desc'), head: q(node, '.cv-lib-tool'), body: q(node, '.cv-tool-body'), fields: q(node, '.cv-lib-fields'), result: q(node, '.cv-lib-result'), def, built: false };
    this.refs.set(node, refs);
    refs.head.addEventListener('click', () => this.expand(node, refs));
    q(node, '.cv-tool-call').addEventListener('click', () => void this.call(refs));
    this.update(node, def);
    return node;
  }

  private update(node: HTMLElement, def: ToolDef): void {
    const refs = this.refs.get(node);
    if (!refs) return;
    refs.def = def;
    setText(refs.name, def.function.name);
    setText(refs.source, def.source);
    setText(refs.desc, def.function.description);
    setTitle(refs.desc, def.function.description);
    setText(q(node, '.cv-tool-call'), t('Call tool'));
    setClass(node, 'is-open', this.open === def.function.name);
    setHidden(refs.body, this.open !== def.function.name);
  }

  private expand(node: HTMLElement, refs: Refs): void {
    const name = refs.def.function.name;
    this.open = this.open === name ? '' : name;
    for (const child of Array.from(this.list.children) as HTMLElement[]) {
      const r = this.refs.get(child);
      if (!r) continue;
      const on = r.def.function.name === this.open;
      setHidden(r.body, !on);
      setClass(child, 'is-open', on);
    }
    if (this.open && !refs.built) {
      refs.built = true;
      const props = refs.def.function.parameters.properties ?? {};
      const required = refs.def.function.parameters.required ?? [];
      const keys = Object.keys(props);
      if (!keys.length) refs.fields.append(el(`<p class="cv-note">${t('No parameters')}</p>`));
      for (const key of keys) {
        const label = el('<label class="cv-lib-field"><span class="cv-lib-flabel"></span><input class="cv-input" spellcheck="false" autocomplete="off"></label>');
        const input = q<HTMLInputElement>(label, 'input');
        input.dataset.k = key;
        input.placeholder = props[key].description ?? props[key].type ?? '';
        setText(q(label, '.cv-lib-flabel'), `${key}${required.includes(key) ? ' *' : ''} · ${props[key].type ?? 'any'}`);
        refs.fields.append(label);
      }
    }
    void node;
  }

  private async call(refs: Refs): Promise<void> {
    const props = refs.def.function.parameters.properties ?? {};
    const args: Record<string, unknown> = {};
    for (const input of Array.from(refs.fields.querySelectorAll<HTMLInputElement>('input[data-k]'))) {
      if (input.value !== '') args[input.dataset.k ?? ''] = coerce(props[input.dataset.k ?? ''], input.value);
    }
    setText(refs.result, '...');
    try {
      const out = await library.call(refs.def.function.name, args);
      setText(refs.result, JSON.stringify(out.result, null, 2).slice(0, 4000));
    } catch (err) {
      setText(refs.result, '');
      fail(err, 'Tool call failed');
    }
  }
}
