import { TRUST_EVENT, workspaceTrusted } from '../../io/trust';
import { detailOf } from '../../io/workspace';
import { confirmAction } from '../../ui/dialogs';
import { el, mountOnce, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { enhanceSelect } from '../../ui/dropdown';
import { onLanguage, t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { toast } from '../../ui/toast';
import { FOCUS_EVENT } from '../../ui/workbench';
import { recipesApi } from '../recipes/client';
import { fillModes } from '../recipes/dialogs';
import { register, type ExtensionContext, type Shell, type SidebarSection } from '../registry';
import { clock, TRIGGERS_CHANGED, triggersApi, type Trigger, type TriggerKind } from './client';
import { WebhookDialog } from './dialogs';

const POLL_MS = 3000;

const KIND_LABEL: Record<TriggerKind, string> = {
  interval: 'Every N seconds',
  delay: 'Once after N seconds',
  watch: 'When files change',
  webhook: 'Signed webhook',
};

const VALUE_HINT: Record<TriggerKind, string> = {
  interval: 'seconds, at least 10',
  delay: 'seconds',
  watch: 'pattern, e.g. src/**',
  webhook: 'secret of 24+ characters, or blank to generate',
};

const spec = (tr: Trigger): string => {
  if (tr.kind === 'interval') return `${t('every')} ${tr.spec.seconds}s`;
  if (tr.kind === 'delay') return `${t('after')} ${tr.spec.seconds}s`;
  if (tr.kind === 'watch') return String(tr.spec.glob ?? '');
  return tr.path ?? '';
};

const target = (tr: Trigger): string => {
  const a = tr.action;
  if (a.kind === 'run_recipe') return `${a.name ?? ''} · ${a.mode === 'claude' ? 'Claude Code' : t('Simulator')}`;
  if (a.kind === 'run_graph') return `${t('graph')} ${a.name ?? ''}`;
  return `${t('resume')} ${a.run_id ?? ''}`;
};

class TriggersPanel {
  private readonly kind: HTMLSelectElement;
  private readonly value: HTMLInputElement;
  private readonly recipe: HTMLSelectElement;
  private readonly mode: HTMLSelectElement;
  private readonly inputs: HTMLInputElement;
  private readonly add: HTMLButtonElement;
  private readonly refreshBtn: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly note: HTMLElement;
  private readonly webhookDialog = new WebhookDialog();
  private rows: Trigger[] = [];
  private known: string[] = [];
  private problem = '';
  private loaded = false;
  private minInterval = 10;
  private busy = false;
  private timer = 0;
  private seq = 0;
  private frame = 0;

  constructor(private readonly host: HTMLElement, private readonly ctx: ExtensionContext) {
    mountOnce(host, `<div class="cv-tg">
<div class="cv-tg-bar"><span class="cv-tg-spacer"></span><button class="cv-wb-tool cv-tg-refresh" type="button">${icon('refresh', 14)}</button></div>
<div class="cv-tg-form">
<select class="cv-input cv-tg-kind"></select>
<input class="cv-input cv-tg-value" type="text" spellcheck="false" autocomplete="off">
<select class="cv-input cv-tg-recipe"></select>
<select class="cv-input cv-tg-mode"></select>
<input class="cv-input cv-tg-inputs" type="text" spellcheck="false" autocomplete="off">
<button class="cv-btn cv-tg-add" type="button">${icon('plus', 14)}<span class="cv-tg-add-t"></span></button>
</div>
<p class="cv-tg-note cv-note" role="status"></p>
<div class="cv-tg-body"><div class="cv-tg-list" role="list"></div><p class="cv-tg-empty cv-note"></p></div>
</div>`);
    this.kind = q<HTMLSelectElement>(host, '.cv-tg-kind');
    this.value = q<HTMLInputElement>(host, '.cv-tg-value');
    this.recipe = q<HTMLSelectElement>(host, '.cv-tg-recipe');
    this.mode = q<HTMLSelectElement>(host, '.cv-tg-mode');
    this.inputs = q<HTMLInputElement>(host, '.cv-tg-inputs');
    this.add = q<HTMLButtonElement>(host, '.cv-tg-add');
    this.refreshBtn = q<HTMLButtonElement>(host, '.cv-tg-refresh');
    this.list = q(host, '.cv-tg-list');
    this.empty = q(host, '.cv-tg-empty');
    this.note = q(host, '.cv-tg-note');
    for (const k of Object.keys(KIND_LABEL) as TriggerKind[]) {
      const o = document.createElement('option');
      o.value = k;
      this.kind.append(o);
    }
    fillModes(this.mode);
    enhanceSelect(this.kind);
    enhanceSelect(this.recipe);
    enhanceSelect(this.mode);
    this.kind.addEventListener('change', () => this.paint());
    this.add.addEventListener('click', () => { void this.create(); });
    this.value.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void this.create(); } });
    this.refreshBtn.addEventListener('click', () => { void this.load(); });
    this.list.addEventListener('click', (e) => this.onClick(e));
    host.addEventListener(FOCUS_EVENT, () => { void this.load(); });
    ctx.store.on('workspace', () => { void this.load(); });
    window.addEventListener(TRIGGERS_CHANGED, () => { void this.load(); });
    onLanguage(() => this.schedule());
    this.timer = window.setInterval(() => { if (!host.hidden && host.getClientRects().length > 0) void this.load(); }, POLL_MS);
    this.paint();
    void this.load();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  async load(): Promise<void> {
    const mine = ++this.seq;
    if (!this.ctx.store.workspace) {
      this.rows = [];
      this.loaded = true;
      this.problem = '';
      this.paint();
      return;
    }
    try {
      const [reply, recipes] = await Promise.all([triggersApi.list(), recipesApi.list()]);
      if (mine !== this.seq) return;
      this.rows = reply.triggers;
      this.minInterval = reply.min_interval;
      this.syncRecipes(recipes.recipes.map((r) => r.name));
      this.problem = '';
    } catch (err) {
      if (mine !== this.seq) return;
      this.problem = detailOf(err);
    }
    this.loaded = true;
    this.paint();
  }

  private syncRecipes(names: string[]): void {
    if (names.join('\n') === this.known.join('\n')) return;
    const current = this.recipe.value;
    this.known = names;
    this.recipe.replaceChildren(...names.map((n) => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      return o;
    }));
    if (names.includes(current)) this.recipe.value = current;
  }

  private async create(): Promise<void> {
    if (this.busy || !this.recipe.value) return;
    const kind = this.kind.value as TriggerKind;
    const raw = this.value.value.trim();
    let inputs: Record<string, string> = {};
    if (this.inputs.value.trim()) {
      try { inputs = JSON.parse(this.inputs.value) as Record<string, string>; } catch { this.problem = t('Inputs must be valid JSON.'); this.paint(); return; }
    }
    const body = kind === 'watch' ? { glob: raw } : kind === 'webhook' ? { secret: raw } : { seconds: Number(raw) };
    this.busy = true;
    this.paint();
    try {
      const made = await triggersApi.add({ kind, spec: body, action: { kind: 'run_recipe', name: this.recipe.value, mode: this.mode.value, inputs } });
      this.value.value = '';
      this.inputs.value = '';
      this.problem = '';
      window.dispatchEvent(new Event(TRIGGERS_CHANGED));
      if (made.secret && made.trigger.path) this.webhookDialog.show(made.trigger.path, 'X-Subform-Signature', made.secret);
      else toast(t('Trigger created'));
    } catch (err) {
      this.problem = detailOf(err);
    } finally {
      this.busy = false;
      this.paint();
    }
  }

  private async act(id: string, act: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return;
    try {
      if (act === 'toggle') await triggersApi.enable(id, !row.enabled);
      else if (act === 'confirm') {
        if (!(await confirmAction('Confirm changed recipe', t('The recipe changed after this trigger was made. Confirm to let the trigger run the recipe as it is now.'), 'Confirm', false))) return;
        await triggersApi.confirm(id);
      } else if (act === 'fire') {
        const r = await triggersApi.fire(id);
        toast(r.error ? r.error : r.run_id ? `${t('Run started')}: ${r.run_id}` : t('Nothing started'), r.error ? 'error' : 'info');
      } else if (act === 'webhook') {
        const w = await triggersApi.webhook(id);
        this.webhookDialog.show(w.path, w.header, w.secret);
      } else if (act === 'remove') {
        if (!(await confirmAction('Delete trigger', t('The trigger stops and is removed.'), 'Delete', true))) return;
        await triggersApi.remove(id);
      }
    } catch (err) {
      toast(detailOf(err), 'error');
    }
    window.dispatchEvent(new Event(TRIGGERS_CHANGED));
  }

  private onClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    const button = target?.closest<HTMLElement>('[data-act]');
    const row = target?.closest<HTMLElement>('.cv-tg-row');
    if (button && row?.dataset.key) void this.act(row.dataset.key, button.dataset.act ?? '');
  }

  private makeRow(): HTMLElement {
    return el(`<div class="cv-tg-row" role="listitem"><button class="cv-wb-tool cv-tg-tgl" type="button" data-act="toggle"><i></i></button><span class="cv-tg-main"><span class="cv-tg-top"><span class="cv-tg-chip"></span><span class="cv-tg-spec"></span></span><span class="cv-tg-target"></span><span class="cv-tg-meta"></span></span><span class="cv-tg-acts"><button class="cv-wb-tool" type="button" data-act="confirm">${icon('check', 12)}</button><button class="cv-wb-tool" type="button" data-act="fire">${icon('play', 12)}</button><button class="cv-wb-tool" type="button" data-act="webhook">${icon('link', 12)}</button><button class="cv-wb-tool" type="button" data-act="remove">${icon('delete', 12)}</button></span></div>`);
  }

  private update(node: HTMLElement, tr: Trigger): void {
    setClass(node, 'is-off', !tr.enabled);
    setClass(q(node, '.cv-tg-tgl'), 'is-on', tr.enabled);
    setTitle(q(node, '.cv-tg-tgl'), t(tr.enabled ? 'Disable' : 'Enable'));
    setText(q(node, '.cv-tg-chip'), t(KIND_LABEL[tr.kind]));
    setText(q(node, '.cv-tg-spec'), spec(tr));
    setText(q(node, '.cv-tg-target'), target(tr));
    const last = tr.last_fired ? `${t('last')} ${clock(tr.last_fired)}` : t('never fired');
    const next = tr.next_fire ? ` · ${t('next')} ${clock(tr.next_fire)}` : '';
    const missed = tr.missed ? ` · ${t('missed while the app was closed')}` : '';
    const changed = tr.needs_confirm ? `${t('its recipe changed; confirm to run again')} · ` : '';
    const meta = `${changed}${tr.fires}× · ${last}${next}${missed}`;
    setText(q(node, '.cv-tg-meta'), meta);
    setTitle(q(node, '.cv-tg-meta'), meta);
    setClass(node, 'is-changed', !!tr.needs_confirm);
    const webhook = q<HTMLButtonElement>(node, '[data-act="webhook"]');
    setHidden(webhook, tr.kind !== 'webhook');
    setHidden(q<HTMLButtonElement>(node, '[data-act="confirm"]'), !tr.needs_confirm);
    for (const [act, label] of [['confirm', 'Confirm the changed recipe'], ['fire', 'Run now'], ['webhook', 'Webhook details'], ['remove', 'Delete']] as const) {
      const b = q<HTMLButtonElement>(node, `[data-act="${act}"]`);
      setTitle(b, t(label));
    }
  }

  private paint(): void {
    const ws = !!this.ctx.store.workspace;
    const kind = this.kind.value as TriggerKind;
    setText(q(this.add, '.cv-tg-add-t'), t('Add trigger'));
    for (const o of Array.from(this.kind.options)) setText(o, t(KIND_LABEL[o.value as TriggerKind]));
    this.value.placeholder = kind === 'interval' ? `${t('seconds, at least')} ${this.minInterval}` : t(VALUE_HINT[kind]);
    this.inputs.placeholder = t('Recipe inputs as JSON (optional)');
    setTitle(this.refreshBtn, t('Refresh'));
    this.kind.setAttribute('aria-label', t('Trigger kind'));
    this.recipe.setAttribute('aria-label', t('Recipe'));
    this.mode.setAttribute('aria-label', t('Run with'));
    setDisabled(this.add, !ws || this.busy || !this.recipe.value);
    patchList(this.list, this.rows, { key: (r) => r.id, create: (r) => { const n = this.makeRow(); this.update(n, r); return n; }, update: (n, r) => this.update(n, r) });
    const msg = !ws ? t('Open a folder to use triggers.') : this.loaded && !this.rows.length ? t('No triggers. They run only while subform is open.') : '';
    setText(this.empty, msg);
    setHidden(this.empty, !msg);
    setText(this.note, this.problem || (ws && !this.known.length && this.loaded ? t('Install a recipe first; a trigger starts one.') : ''));
    setClass(this.note, 'is-error', !!this.problem);
  }

  dispose(): void { window.clearInterval(this.timer); }
}

register({
  id: 'triggers',
  name: 'Triggers',
  description: 'Interval, once-after-delay, file-watch and signed-webhook triggers that start recipes while subform is open.',
  setup(ctx: ExtensionContext, shell: Shell): void {
    const announce = (): void => {
      const path = ctx.store.workspace?.path;
      if (path) void triggersApi.trust(path, workspaceTrusted()).catch(() => undefined);
    };
    ctx.store.on('workspace', announce);
    window.addEventListener(TRUST_EVENT, announce);
    announce();
    const section: SidebarSection = shell.sidebarSection({
      id: 'triggers',
      title: 'Triggers',
      icon: 'rcpBolt',
      render: (host) => { new TriggersPanel(host, ctx); },
    });
    ctx.commands.add({ id: 'triggers-panel', label: 'Triggers', run: () => { section.reveal(); } });
  },
});
