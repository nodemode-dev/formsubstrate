import { ApiError, systemStatus, type SystemStatus } from '../../io/api';
import { cogentics, insight, type CogStatus, type PendingApproval, type ProviderInfo, type ScopeInfo, type UsageSummary } from '../../io/cogentics';
import { el, patchList, q, setClass, setDisabled, setHidden, setText, setTitle, setValue } from '../../ui/dom';
import { enhanceSelect } from '../../ui/dropdown';
import { t, tn } from '../../ui/i18n';
import { toast } from '../../ui/toast';
import { paintDiff, fmtTok } from '../cogentics/rich';
import type { ExtensionContext } from '../registry';

const REFRESH_MS = 4000;
type Page = 'dashboard' | 'approvals' | 'providers' | 'health';
const PAGES: Array<[Page, string]> = [['dashboard', 'Dashboard'], ['approvals', 'Approvals'], ['providers', 'Providers'], ['health', 'Health']];
const CARDS = ['engine', 'model', 'workspace', 'usage', 'channels', 'approvals'] as const;
type Card = (typeof CARDS)[number];
const CARD_LABEL: Record<Card, string> = { engine: 'Engine', model: 'Model', workspace: 'Workspace', usage: 'Usage', channels: 'Channels', approvals: 'Approvals' };
const PRESETS = [
  { name: 'Ollama (local)', provider: 'ollama', base_url: '', model: 'qwen2.5-coder:14b' },
  { name: 'LM Studio (local)', provider: 'lmstudio', base_url: '', model: 'local-model' },
  { name: 'OpenRouter', provider: 'openrouter', base_url: '', model: 'openrouter/auto' },
  { name: 'OpenAI', provider: 'custom', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
];

const failText = (err: unknown): string => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));

interface CardState { value: string; sub: string; tone: 'ok' | 'warn' | 'muted' }

export class ConsolePane {
  private page: Page = 'dashboard';
  private readonly pages = new Map<Page, HTMLElement>();
  private readonly tabs = new Map<Page, HTMLButtonElement>();
  private readonly cards = new Map<Card, HTMLElement>();
  private readonly recent: HTMLElement;
  private readonly approvalsEl: HTMLElement;
  private readonly approvalsNone: HTMLElement;
  private readonly healthRows: HTMLElement;
  private readonly provNote: HTMLElement;
  private readonly provSel: HTMLSelectElement;
  private readonly provUrl: HTMLInputElement;
  private readonly provModel: HTMLInputElement;
  private readonly provKey: HTMLInputElement;
  private readonly provTest: HTMLElement;
  private pending: PendingApproval[] = [];
  private info: ProviderInfo | null = null;
  private busy = new Set<string>();
  private timer = 0;

  constructor(private readonly host: HTMLElement, private readonly ctx: ExtensionContext) {
    const root = el<HTMLElement>(`<div class="cn">
<div class="cn-nav" role="tablist">${PAGES.map(([id, label]) => `<button type="button" class="cn-tab" role="tab" data-page="${id}">${t(label)}<span class="cn-badge" hidden></span></button>`).join('')}</div>
<div class="cn-body">
<section class="cn-page" data-page="dashboard"><div class="cn-cards">${CARDS.map((c) => `<div class="cn-card" data-card="${c}"><div class="cn-card-top"><span>${t(CARD_LABEL[c])}</span><i class="cn-lamp"></i></div><div class="cn-card-value"></div><div class="cn-card-sub"></div></div>`).join('')}</div>
<div class="cn-head">${t('Recent turns with tracked changes')}</div><div class="cn-recent"></div><p class="cn-none cn-recent-none cv-note">${t('Nothing yet. Turns that write files are listed here.')}</p></section>
<section class="cn-page" data-page="approvals" hidden><div class="cn-approvals"></div><p class="cn-none cn-approvals-none cv-note">${t('Nothing pending. Gated tools wait here for your decision.')}</p></section>
<section class="cn-page" data-page="providers" hidden><div class="cn-presets">${PRESETS.map((p, i) => `<button type="button" class="cv-btn" data-preset="${i}">${p.name}</button>`).join('')}</div>
<div class="cn-form"><label class="cn-field"><span>${t('Provider')}</span><select class="cn-prov"><option value="openrouter">OpenRouter</option><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option><option value="custom">${t('Custom OpenAI compatible')}</option></select></label>
<label class="cn-field"><span>${t('Base URL')}</span><input class="cv-input cn-url" placeholder="https://openrouter.ai/api/v1"></label>
<label class="cn-field"><span>${t('Model')}</span><input class="cv-input cn-model" placeholder="openrouter/auto"></label>
<label class="cn-field"><span>${t('API key')}</span><input class="cv-input cn-key" type="password" autocomplete="off" placeholder="${t('Stored in the system keyring')}"></label>
<div class="cn-actions"><button type="button" class="cv-btn cv-btn-primary cn-save">${t('Apply provider')}</button><button type="button" class="cv-btn cn-test">${t('Test connection')}</button><button type="button" class="cv-btn cn-forget">${t('Forget key')}</button></div>
<p class="cn-prov-note cv-note"></p><p class="cn-test-note cv-note"></p></div></section>
<section class="cn-page" data-page="health" hidden><div class="cn-health"></div></section>
</div></div>`);
    host.append(root);
    for (const [id] of PAGES) {
      this.pages.set(id, q(root, `.cn-page[data-page="${id}"]`));
      this.tabs.set(id, q<HTMLButtonElement>(root, `.cn-tab[data-page="${id}"]`));
    }
    for (const c of CARDS) this.cards.set(c, q(root, `.cn-card[data-card="${c}"]`));
    this.recent = q(root, '.cn-recent');
    this.approvalsEl = q(root, '.cn-approvals');
    this.approvalsNone = q(root, '.cn-approvals-none');
    this.healthRows = q(root, '.cn-health');
    this.provNote = q(root, '.cn-prov-note');
    this.provSel = q<HTMLSelectElement>(root, '.cn-prov');
    this.provUrl = q<HTMLInputElement>(root, '.cn-url');
    this.provModel = q<HTMLInputElement>(root, '.cn-model');
    this.provKey = q<HTMLInputElement>(root, '.cn-key');
    this.provTest = q(root, '.cn-test-note');
    enhanceSelect(this.provSel);
    root.querySelector('.cn-nav')?.addEventListener('click', (e) => {
      const id = e.target instanceof Element ? e.target.closest<HTMLElement>('.cn-tab')?.dataset.page : undefined;
      if (id) this.show(id as Page);
    });
    this.approvalsEl.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const row = target?.closest<HTMLElement>('.cn-appr');
      const btn = target?.closest<HTMLElement>('[data-decide]');
      if (row?.dataset.key && btn) void this.decide(row.dataset.key, btn.dataset.decide === '1');
    });
    root.querySelector('.cn-presets')?.addEventListener('click', (e) => {
      const i = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-preset]')?.dataset.preset : undefined;
      if (i !== undefined) void this.usePreset(PRESETS[Number(i)]);
    });
    q(root, '.cn-save').addEventListener('click', () => { void this.saveProvider(); });
    q(root, '.cn-test').addEventListener('click', () => { void this.testProvider(); });
    q(root, '.cn-forget').addEventListener('click', () => { void this.forgetKey(); });
    ctx.store.on('workspace', () => { void this.refresh(); });
    this.paintTabs();
    void this.refresh();
    this.timer = window.setInterval(() => {
      if (host.offsetParent !== null && (this.page === 'dashboard' || this.page === 'approvals')) void this.refresh();
    }, REFRESH_MS);
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }

  private show(page: Page): void {
    this.page = page;
    this.paintTabs();
    void this.refresh();
  }

  private paintTabs(): void {
    for (const [id, tab] of this.tabs) {
      const on = id === this.page;
      setClass(tab, 'is-on', on);
      if (tab.getAttribute('aria-selected') !== String(on)) tab.setAttribute('aria-selected', String(on));
      setHidden(this.pages.get(id) as HTMLElement, !on);
    }
  }

  async refresh(): Promise<void> {
    if (this.page === 'dashboard') await this.loadDashboard();
    else if (this.page === 'approvals') await this.loadApprovals();
    else if (this.page === 'providers') await this.loadProvider();
    else await this.loadHealth();
  }

  private card(name: Card, s: CardState): void {
    const node = this.cards.get(name) as HTMLElement;
    setText(q(node, '.cn-card-value'), s.value);
    setText(q(node, '.cn-card-sub'), s.sub);
    for (const tone of ['ok', 'warn', 'muted'] as const) setClass(node, `is-${tone}`, s.tone === tone);
  }

  private async loadDashboard(): Promise<void> {
    const ws = this.ctx.store.workspace;
    let sys: SystemStatus | null = null;
    let cog: CogStatus | null = null;
    let usage: UsageSummary | null = null;
    let scopes: ScopeInfo[] = [];
    let channels = 0;
    let pending: PendingApproval[] = [];
    try { sys = await systemStatus(); } catch { sys = null; }
    if (ws) {
      const [c, u, s, ch, ap] = await Promise.allSettled([cogentics.status(), insight.summary(7), insight.scopes(), cogentics.channels(), cogentics.approvals()]);
      cog = c.status === 'fulfilled' ? c.value : null;
      usage = u.status === 'fulfilled' ? u.value : null;
      scopes = s.status === 'fulfilled' ? s.value.scopes : [];
      channels = ch.status === 'fulfilled' ? ch.value.channels.length : 0;
      pending = ap.status === 'fulfilled' ? ap.value.approvals : [];
    }
    this.pending = pending;
    this.card('engine', sys ? { value: `v${sys.version}`, sub: `${sys.engine} · ${t('ready')}`, tone: 'ok' } : { value: t('offline'), sub: t('The engine is not answering.'), tone: 'warn' });
    this.card('model', cog ? { value: cog.llm_configured ? cog.model : t('Simulator'), sub: cog.llm_configured ? cog.provider : t('No provider key set'), tone: cog.llm_configured ? 'ok' : 'muted' } : { value: '-', sub: ws ? '' : t('Open a folder'), tone: 'muted' });
    this.card('workspace', ws ? { value: ws.name, sub: ws.branch || t('No branch'), tone: 'ok' } : { value: '-', sub: t('No folder open'), tone: 'muted' });
    const tt = usage?.total;
    this.card('usage', tt ? { value: `$${tt.cost.toFixed(tt.cost < 0.01 ? 4 : 3)}`, sub: `${tn(tt.calls, '{n} call', '{n} calls')} · ${fmtTok(tt.prompt_tokens + tt.completion_tokens)} tok · 7d`, tone: 'ok' } : { value: '-', sub: '', tone: 'muted' });
    this.card('channels', ws ? { value: String(channels), sub: tn(channels, '{n} channel', '{n} channels'), tone: channels ? 'ok' : 'muted' } : { value: '-', sub: '', tone: 'muted' });
    this.card('approvals', { value: String(pending.length), sub: pending.length ? t('awaiting your decision') : t('nothing pending'), tone: pending.length ? 'warn' : 'muted' });
    this.badge(pending.length);
    patchList(this.recent, scopes.slice(0, 8), {
      key: (s) => s.id,
      create: () => el<HTMLElement>('<div class="cn-run"><span class="cn-run-name"></span><span class="cn-run-meta"></span></div>'),
      update: (node, s) => {
        setText(q(node, '.cn-run-name'), s.label || s.id);
        setText(q(node, '.cn-run-meta'), `${tn(s.files, '{n} file', '{n} files')} · ${new Date(s.last * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      },
    });
    setHidden(q(this.host, '.cn-recent-none'), scopes.length > 0);
  }

  private badge(n: number): void {
    const b = q(this.tabs.get('approvals') as HTMLElement, '.cn-badge');
    setText(b, String(n));
    setHidden(b, n === 0);
  }

  private async loadApprovals(): Promise<void> {
    if (this.ctx.store.workspace) {
      try { this.pending = (await cogentics.approvals()).approvals; } catch { this.pending = []; }
    } else {
      this.pending = [];
    }
    this.badge(this.pending.length);
    setHidden(this.approvalsNone, this.pending.length > 0);
    patchList(this.approvalsEl, this.pending, {
      key: (a) => `${a.channel}:${a.seq}`,
      create: () => el<HTMLElement>(`<div class="cn-appr"><div class="cn-appr-head"><span class="cn-appr-who"></span><code class="cn-appr-tool"></code></div><pre class="cn-appr-pre cx-card-pre"></pre><div class="cn-actions"><button type="button" class="cv-btn cv-btn-primary" data-decide="1">${t('Allow')}</button><button type="button" class="cv-btn" data-decide="0">${t('Deny')}</button></div></div>`),
      update: (node, a) => {
        setText(q(node, '.cn-appr-who'), `#${a.channel} @${a.author}`);
        setText(q(node, '.cn-appr-tool'), a.card.tool);
        paintDiff(q(node, '.cn-appr-pre'), a.card.diff ?? a.card.args);
        for (const b of node.querySelectorAll<HTMLButtonElement>('[data-decide]')) setDisabled(b, this.busy.has(`${a.channel}:${a.seq}`));
      },
    });
  }

  private async decide(key: string, approved: boolean): Promise<void> {
    const [channel, seq] = key.split(':');
    this.busy.add(key);
    try {
      await cogentics.decide(channel, Number(seq), approved);
    } catch {
      toast(t('That approval was already settled.'), 'error');
    }
    this.busy.delete(key);
    await this.loadApprovals();
  }

  private async loadProvider(): Promise<void> {
    try { this.info = await cogentics.provider(); } catch { this.info = null; }
    const i = this.info;
    if (!i) return;
    setValue(this.provSel, i.provider);
    setValue(this.provUrl, i.base_url);
    setValue(this.provModel, i.model);
    setText(this.provNote, `${i.configured ? t('Configured') : t('Simulator mode: no key, runs use the built-in simulator')} · ${i.has_key ? t('key stored') : t('no key stored')}`);
  }

  private async usePreset(p: (typeof PRESETS)[number]): Promise<void> {
    this.provSel.value = p.provider;
    this.provUrl.value = p.base_url;
    this.provModel.value = p.model;
    await this.saveProvider();
  }

  private async saveProvider(): Promise<void> {
    try {
      this.info = await cogentics.setProvider({ provider: this.provSel.value, base_url: this.provSel.value === 'custom' ? this.provUrl.value.trim() : '', model: this.provModel.value.trim(), api_key: this.provKey.value.trim() });
      this.provKey.value = '';
      toast(this.info.configured ? t('Provider applied.') : t('Provider saved. Add an API key to leave simulator mode.'));
      await this.loadProvider();
    } catch (err) {
      toast(failText(err), 'error');
    }
  }

  private async testProvider(): Promise<void> {
    setText(this.provTest, t('Testing'));
    try {
      const r = await cogentics.testProvider();
      setText(this.provTest, r.ok ? `${t('Reachable')}: ${tn(r.models?.length ?? 0, '{n} model listed', '{n} models listed')}` : `${t('Not reachable')}: ${r.detail ?? ''}`);
    } catch (err) {
      setText(this.provTest, failText(err));
    }
  }

  private async forgetKey(): Promise<void> {
    try {
      await cogentics.forgetKey();
      toast(t('Key removed.'));
      await this.loadProvider();
    } catch (err) {
      toast(failText(err), 'error');
    }
  }

  private async loadHealth(): Promise<void> {
    const rows: Array<[string, string]> = [];
    try {
      const s = await systemStatus();
      rows.push([t('Engine'), `v${s.version} · ${s.engine}`], [t('Data folder'), s.data_dir], [t('git'), String(s.git ?? t('not found'))], [t('claude'), String(s.claude ?? t('not found'))]);
    } catch (err) {
      rows.push([t('Engine'), failText(err)]);
    }
    const ws = this.ctx.store.workspace;
    rows.push([t('Workspace'), ws ? ws.path : t('none open')]);
    if (ws) {
      try {
        const c = await cogentics.status();
        rows.push([t('Model'), c.llm_configured ? `${c.provider} · ${c.model}` : t('simulator')]);
      } catch {
        rows.push([t('Model'), '-']);
      }
    }
    patchList(this.healthRows, rows.map(([k, v]) => ({ k, v })), {
      key: (r) => r.k,
      create: () => el<HTMLElement>('<div class="cn-row"><em></em><span></span></div>'),
      update: (node, r) => {
        setText(q(node, 'em'), r.k);
        setText(q(node, 'span'), r.v);
        setTitle(q(node, 'span'), r.v);
      },
    });
  }
}
