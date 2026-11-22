import { ApiError } from '../../io/api';
import { cogentics, insight, type CatalogGroup, type ChannelDoc, type ChannelInfo, type Member, type Msg } from '../../io/cogentics';
import { workspaceTrusted } from '../../io/trust';
import { confirmAction, promptName } from '../../ui/dialogs';
import { el, q, setClass, setDisabled, setHidden, setText, setTitle, setValue } from '../../ui/dom';
import { enhanceSelect } from '../../ui/dropdown';
import { onLanguage, t, tn } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { toast } from '../../ui/toast';
import type { ExtensionContext, Shell } from '../registry';
import { Ledger } from './ledger';
import { fillModels, MemberRail, type Spent } from './members';
import { blankCode, fmtTok, patchFilled } from './rich';

const ACTIVE_KEY = 'formsubstrate.cogentics.active';
const SEEN_KEY = 'formsubstrate.cogentics.seen.';
const METER_WAIT_MS = 250;

const getSeen = (c: string): number => {
  try { return Number(localStorage.getItem(SEEN_KEY + c) ?? 0); } catch { return 0; }
};
const setSeen = (c: string, seq: number): void => {
  if (seq <= getSeen(c)) return;
  try { localStorage.setItem(SEEN_KEY + c, String(seq)); } catch { return; }
};
const failText = (err: unknown): string => {
  if (err instanceof ApiError) {
    const body = err.body as { detail?: unknown } | null;
    return typeof body?.detail === 'string' ? body.detail : err.message;
  }
  return err instanceof Error ? err.message : String(err);
};

interface AcItem { key: string; insert: string; label: string; hint: string }

export class CogenticsPanel {
  private readonly chanSel: HTMLSelectElement;
  private readonly meterEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly reachEl: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly postBtn: HTMLButtonElement;
  private readonly acEl: HTMLElement;
  private readonly delBtn: HTMLButtonElement;
  private readonly newBtn: HTMLButtonElement;
  private readonly brakeEl: HTMLInputElement;
  private readonly gatedEl: HTMLInputElement;
  private readonly statusEl: HTMLElement;
  private readonly kindSel: HTMLSelectElement;
  private readonly modelSel: HTMLSelectElement;
  private readonly presetSel: HTMLSelectElement;
  private readonly fullWrap: HTMLElement;
  private readonly ledger: Ledger;
  private readonly rail: MemberRail;
  private channels: ChannelInfo[] = [];
  private active = '';
  private members: Member[] = [];
  private es: EventSource | null = null;
  private meterTimer = 0;
  private catalog: CatalogGroup[] | null = null;
  private cli: Array<{ id: string; label: string }> | null = null;
  private acItems: AcItem[] = [];
  private acSel = 0;
  private acRange: { start: number; end: number } | null = null;
  private lastSeq = 0;
  private busy = false;
  private materialized = false;

  constructor(private readonly host: HTMLElement, private readonly ctx: ExtensionContext, private readonly shell: Shell, private readonly openChanges: (scope: string) => void) {
    const root = el<HTMLElement>(`<div class="cx">
<div class="cx-bar"><select class="cx-chansel" aria-label="${t('Channel')}"></select><button type="button" class="cv-tt-btn cx-new" title="${t('New channel')}" aria-label="${t('New channel')}">${icon('plus', 14)}</button><button type="button" class="cv-tt-btn cx-del" title="${t('Delete channel')}" aria-label="${t('Delete channel')}">${icon('delete', 14)}</button></div>
<div class="cx-meter cv-note"></div>
<div class="cx-stage"><p class="cx-empty cv-note"></p><div class="cx-ledger" role="log" aria-live="off"></div></div>
<div class="cx-reach cv-note"></div>
<div class="cx-composer"><div class="cx-ac" role="listbox" hidden></div><textarea class="cv-input cx-input" rows="2" disabled placeholder="${t('Message the channel')}"></textarea><button type="button" class="cv-btn cv-btn-primary cx-post" disabled>${icon('send', 13)}<span>${t('Post')}</span></button></div>
<div class="cx-more">
<details class="cx-sec"><summary>${t('Members')}</summary><div class="cx-members"></div>
<div class="cx-add"><div class="cx-row"><select class="cx-preset" aria-label="${t('Roster preset')}"></select><button type="button" class="cv-btn cx-preset-add" title="${t('Add this roster to the channel')}">${t('Add roster')}</button></div>
<select class="cx-kind" aria-label="${t('Member kind')}"><option value="agent">${t('API agent (configured provider)')}</option><option value="claude">${t('Claude Code (terminal CLI)')}</option></select>
<select class="cx-model" aria-label="${t('Model')}"></select>
<input class="cv-input cx-handle" placeholder="${t('Handle (for example reviewer)')}" aria-label="${t('Handle')}">
<textarea class="cv-input cx-prompt" rows="3" placeholder="${t('Role prompt: what this agent is on the channel to do')}" aria-label="${t('Role prompt')}"></textarea>
<label class="cx-full" hidden><input type="checkbox" class="cx-full-box"><span>${t('Full access (skip CLI permission prompts)')}</span></label>
<button type="button" class="cv-btn cx-member-add">${icon('plus', 12)}<span>${t('Add agent')}</span></button></div></details>
<details class="cx-sec"><summary>${t('Channel settings')}</summary><div class="cx-add">
<label class="cx-field"><span>${t('Turn brake')}</span><input class="cv-input cx-brake" type="number" min="0" max="99" title="${t('Hold agent chains after N consecutive agent turns (0 is off)')}"></label>
<label class="cx-field"><span>${t('Tools needing approval')}</span><input class="cv-input cx-gated" placeholder="run_shell, write_file" title="${t('Comma separated tool names a human must allow')}"></label>
<p class="cx-status cv-note"></p></div></details>
</div></div>`);
    host.append(root);
    this.chanSel = q<HTMLSelectElement>(root, '.cx-chansel');
    this.meterEl = q(root, '.cx-meter');
    this.emptyEl = q(root, '.cx-empty');
    this.reachEl = q(root, '.cx-reach');
    this.input = q<HTMLTextAreaElement>(root, '.cx-input');
    this.postBtn = q<HTMLButtonElement>(root, '.cx-post');
    this.acEl = q(root, '.cx-ac');
    this.delBtn = q<HTMLButtonElement>(root, '.cx-del');
    this.newBtn = q<HTMLButtonElement>(root, '.cx-new');
    this.brakeEl = q<HTMLInputElement>(root, '.cx-brake');
    this.gatedEl = q<HTMLInputElement>(root, '.cx-gated');
    this.statusEl = q(root, '.cx-status');
    this.kindSel = q<HTMLSelectElement>(root, '.cx-kind');
    this.modelSel = q<HTMLSelectElement>(root, '.cx-model');
    this.presetSel = q<HTMLSelectElement>(root, '.cx-preset');
    this.fullWrap = q(root, '.cx-full');
    this.ledger = new Ledger(q(root, '.cx-ledger'), {
      handles: () => new Set(this.members.map((m) => m.handle)),
      decide: (seq, ok) => { void this.decide(seq, ok); },
      openNote: (name) => { if (this.active) shell.openEditorTab(`.formsubstrate/cogentics/${this.active}-ledger/${name}.md`); },
      openChanges: (scope) => this.openChanges(scope),
      scopeOf: (seq) => `cog-${this.active}-${seq}`,
    });
    this.rail = new MemberRail(q(root, '.cx-members'), {
      toggle: (m) => { void this.toggleMember(m); },
      remove: (m) => { void this.removeMember(m); },
      release: (m) => { void this.release(m); },
    });
    enhanceSelect(this.chanSel);
    enhanceSelect(this.kindSel);
    enhanceSelect(this.modelSel, { search: t('Search models') });
    enhanceSelect(this.presetSel);
    fillModels(this.modelSel, null, null, 'agent');
    this.bind(root);
    onLanguage(() => this.paintEmpty());
    ctx.store.on('workspace', () => { void this.onWorkspace(); });
    window.addEventListener('formsubstrate:trust-changed', () => this.updateReach());
    host.addEventListener('wb-focus', () => { void this.refresh(); });
    void this.onWorkspace();
    void this.loadStatic();
  }

  private paintEmpty(): void {
    const has = !!this.ctx.store.workspace;
    const none = this.channels.length === 0;
    let text = '';
    if (!has) text = t('Open a folder to use channels.');
    else if (!this.active) text = none ? t('Create a channel to start the wire.') : t('Select a channel.');
    else if (this.ledger.size === 0) text = t('Quiet wire: add an agent member, then @mention it.');
    setText(this.emptyEl, text);
    setHidden(this.emptyEl, text === '');
  }

  private bind(root: HTMLElement): void {
    this.newBtn.addEventListener('click', () => { void this.newChannel(); });
    this.delBtn.addEventListener('click', () => { void this.deleteChannel(); });
    this.chanSel.addEventListener('change', () => { if (this.chanSel.value) void this.select(this.chanSel.value); });
    this.postBtn.addEventListener('click', () => { void this.submit(); });
    this.input.addEventListener('input', () => { this.onInput(); });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => { window.setTimeout(() => this.closeAc(), 120); });
    this.acEl.addEventListener('pointerdown', (e) => {
      const key = e.target instanceof Element ? e.target.closest<HTMLElement>('.cx-ac-item')?.dataset.key : undefined;
      if (key === undefined) return;
      e.preventDefault();
      this.acceptAc(this.acItems.findIndex((i) => i.key === key));
    });
    this.brakeEl.addEventListener('change', () => { void this.saveBrake(); });
    this.gatedEl.addEventListener('change', () => { void this.saveGated(); });
    this.kindSel.addEventListener('change', () => {
      setHidden(this.fullWrap, this.kindSel.value !== 'claude');
      fillModels(this.modelSel, this.catalog, this.cli, this.kindSel.value);
    });
    q(root, '.cx-member-add').addEventListener('click', () => { void this.addMember(root); });
    q(root, '.cx-preset-add').addEventListener('click', () => { void this.addPreset(); });
  }

  private async loadStatic(): Promise<void> {
    try {
      const [models, presets, status] = await Promise.all([cogentics.models(), cogentics.presets(), cogentics.status()]);
      this.catalog = models.catalog;
      this.cli = models.cli_models;
      fillModels(this.modelSel, this.catalog, this.cli, this.kindSel.value);
      this.modelSel.title = `${t('Catalog verified')} ${models.verified}`;
      patchFilled(this.presetSel, presets.presets, {
        key: (p) => p.name,
        create: () => document.createElement('option'),
        update: (node, p) => { const o = node as HTMLOptionElement; o.value = p.name; setText(o, p.label); setTitle(o, p.note); },
      });
      if (!this.presetSel.value && presets.presets[0]) this.presetSel.value = presets.presets[0].name;
      const api = status.llm_configured ? `${t('API')}: ${status.provider} · ${status.model}` : t('API: simulator (no provider key); set one in Console, Providers');
      const cli = status.claude_cli ? t('Claude CLI: found') : t('Claude CLI: not found');
      setText(this.statusEl, `${api} · ${cli}`);
    } catch {
      setText(this.statusEl, t('The channel engine is not reachable.'));
    }
  }

  async onWorkspace(): Promise<void> {
    this.closeStream();
    this.active = '';
    this.members = [];
    this.channels = [];
    this.ledger.clear();
    this.rail.set([]);
    this.syncControls();
    this.paintChannels();
    this.paintEmpty();
    if (this.ctx.store.workspace) await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.ctx.store.workspace) return;
    try {
      this.channels = (await cogentics.channels()).channels;
    } catch {
      this.channels = [];
    }
    this.paintChannels();
    if (!this.active && this.channels.length) {
      let want = '';
      try { want = localStorage.getItem(ACTIVE_KEY) ?? ''; } catch { want = ''; }
      const name = this.channels.some((c) => c.name === want) ? want : this.channels[0].name;
      await this.select(name);
    }
    this.paintEmpty();
  }

  private paintChannels(): void {
    patchFilled(this.chanSel, this.channels, {
      key: (c) => c.name,
      create: () => document.createElement('option'),
      update: (node, c) => {
        const o = node as HTMLOptionElement;
        o.value = c.name;
        const unread = c.name === this.active ? 0 : Math.max(0, c.seq - getSeen(c.name));
        setText(o, unread ? `#${c.name} (${unread})` : `#${c.name}`);
      },
    });
    setValue(this.chanSel, this.active);
    if (this.chanSel.value !== this.active) this.chanSel.value = this.active;
  }

  private syncControls(): void {
    const on = this.active !== '';
    if (this.input.disabled !== !on) this.input.disabled = !on;
    setDisabled(this.postBtn, !on);
    setDisabled(this.delBtn, !on);
    setDisabled(this.newBtn, !this.ctx.store.workspace);
    setDisabled(this.brakeEl, !on);
    setDisabled(this.gatedEl, !on);
    if (!on) setText(this.meterEl, '');
  }

  private async select(name: string): Promise<void> {
    if (this.active === name && this.es) return;
    this.closeStream();
    this.active = name;
    try { localStorage.setItem(ACTIVE_KEY, name); } catch { this.active = name; }
    let doc: ChannelDoc;
    try {
      doc = await cogentics.channel(name);
    } catch (err) {
      toast(failText(err), 'error');
      this.active = '';
      this.syncControls();
      return;
    }
    if (this.active !== name) return;
    this.ledger.clear();
    this.members = doc.members;
    this.rail.set(doc.members);
    for (const m of doc.messages) this.ledger.upsert(m);
    this.lastSeq = doc.seq;
    setSeen(name, doc.seq);
    setValue(this.brakeEl, String(doc.config?.turn_brake ?? 0));
    setValue(this.gatedEl, (doc.config?.approval_tools ?? ['run_shell']).join(', '));
    this.syncControls();
    this.paintChannels();
    this.paintEmpty();
    this.updateReach();
    this.ledger.root.scrollTop = this.ledger.root.scrollHeight;
    this.scheduleMeter();
    void this.loadSpend();
    this.openStream(name);
  }

  private closeStream(): void {
    if (this.es) { this.es.close(); this.es = null; }
  }

  private openStream(name: string): void {
    const es = cogentics.stream(name);
    this.es = es;
    let dropped = false;
    es.onerror = () => { dropped = true; };
    es.onopen = () => {
      if (dropped) { dropped = false; void this.resync(); }
    };
    es.onmessage = (ev) => {
      try { this.onEvent(JSON.parse(ev.data) as Record<string, unknown>); } catch { return; }
    };
  }

  private async resync(): Promise<void> {
    if (!this.active) return;
    try {
      const doc = await cogentics.channel(this.active);
      for (const m of doc.messages) if (m.seq > this.lastSeq - 40) this.ledger.upsert(m);
      this.members = doc.members;
      this.rail.set(doc.members);
      this.lastSeq = doc.seq;
    } catch {
      return;
    }
  }

  private onEvent(e: Record<string, unknown>): void {
    const type = e.type;
    if (type === 'message' || type === 'finalize' || type === 'card') {
      const m = e.message as Msg;
      this.ledger.upsert(m);
      this.lastSeq = Math.max(this.lastSeq, m.seq);
      if (this.host.offsetParent !== null) setSeen(this.active, m.seq);
      this.paintEmpty();
      this.updateReach();
      if (type !== 'message') this.scheduleMeter();
    } else if (type === 'delta') {
      this.ledger.delta(e.seq as number, e.text as string);
    } else if (type === 'tool') {
      this.ledger.tool(e.seq as number, e.note as string);
    } else if (type === 'usage') {
      const seq = e.seq as number;
      this.ledger.touch(seq);
      const msg = this.ledger.find(seq);
      if (msg) this.rail.addSpend(msg.author, ((e.prompt as number) || 0) + ((e.completion as number) || 0), (e.cost as number) || 0);
      this.scheduleMeter();
    } else if (type === 'member_state') {
      this.rail.setLive(e.handle as string, { state: e.state as string, depth: e.depth as number | undefined, held: e.held as number | undefined });
    } else if (type === 'member') {
      void cogentics.channel(this.active).then((d) => {
        this.members = d.members;
        this.rail.set(d.members);
        void this.loadSpend();
      }).catch((err: unknown) => console.warn('member list refresh failed', err));
    }
  }

  private scheduleMeter(): void {
    window.clearTimeout(this.meterTimer);
    this.meterTimer = window.setTimeout(() => { void this.paintMeter(); }, METER_WAIT_MS);
  }

  private async paintMeter(): Promise<void> {
    if (!this.active) return;
    try {
      const d = await cogentics.meter(this.active);
      const tok = d.prompt_tokens + d.completion_tokens;
      let text = tn(d.turns, '{n} turn', '{n} turns');
      if (tok) text += ` · ${fmtTok(tok)} tok`;
      if (d.cost) text += ` · $${d.cost.toFixed(3)}`;
      if (d.groups_open) text += ` · ${d.groups_open} ${t('group open')}`;
      setText(this.meterEl, text);
    } catch {
      return;
    }
  }

  private async loadSpend(): Promise<void> {
    const name = this.active;
    const map = new Map<string, Spent>();
    await Promise.all(this.members.filter((m) => m.kind !== 'human').map(async (m) => {
      try {
        const d = await insight.scopeSpend(`cogentics:${name}:${m.handle}`);
        map.set(m.handle, { tok: d.prompt_tokens + d.completion_tokens, cost: d.cost });
      } catch {
        return;
      }
    }));
    if (this.active === name) this.rail.setSpend(map);
  }

  private workers(): Set<string> {
    return new Set(this.members.filter((m) => m.kind === 'agent' || m.kind === 'claude').map((m) => m.handle));
  }

  private updateReach(): void {
    const draft = this.input.value;
    let text = '';
    let warn = false;
    if (this.active && draft.trim()) {
      const handles = new Set(this.members.map((m) => m.handle));
      const workers = this.workers();
      const seen: string[] = [];
      const unres: string[] = [];
      for (const m of blankCode(draft).matchAll(/@([A-Za-z0-9_-]+)/g)) {
        const h = m[1];
        if (handles.has(h) && workers.has(h)) { if (!seen.includes(h)) seen.push(h); }
        else if (!handles.has(h) && h !== 'all' && !unres.includes(h)) unres.push(h);
      }
      if (seen.length >= 2) text = `→ ${t('group round')}: ${seen.map((h) => `@${h}`).join(' ')} ${t('run independently, results bundle at the barrier')}`;
      else if (seen.length === 1) text = `→ @${seen[0]}`;
      else {
        const d = this.ledger.defaultRecipient(workers);
        text = d ? `→ @${d} (${t('untagged default')})` : `→ ${t('channel commentary, reaches nobody')}`;
      }
      if (unres.length) { text += ` · ${t('unresolved')}: ${unres.map((h) => `@${h}`).join(' ')}`; warn = true; }
    }
    if (this.active && !workspaceTrusted() && this.workers().size) {
      text = `${text ? `${text} · ` : ''}${t('Workspace not trusted: agent members will not run until you trust it in Preferences.')}`;
      warn = true;
    }
    setText(this.reachEl, text);
    setClass(this.reachEl, 'warn', warn);
  }

  private onInput(): void {
    const v = this.input.value;
    if (!this.materialized && v.length === 1 && /[^@#\s]/.test(v)) {
      const d = this.ledger.defaultRecipient(this.workers());
      if (d) {
        this.input.value = `@${d} ${v}`;
        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
      }
    }
    this.materialized = this.input.value.length > 0;
    this.updateReach();
    this.updateAc();
  }

  private tokenAtCaret(): { kind: string; text: string; start: number; end: number } | null {
    const pos = this.input.selectionStart;
    const m = /([@#])([A-Za-z0-9_-]*)$/.exec(this.input.value.slice(0, pos));
    return m ? { kind: m[1], text: m[2], start: pos - m[0].length, end: pos } : null;
  }

  private updateAc(): void {
    const tok = this.tokenAtCaret();
    if (!tok) { this.closeAc(); return; }
    this.acRange = { start: tok.start, end: tok.end };
    if (tok.kind === '@') {
      this.acItems = this.members
        .filter((m) => m.handle.startsWith(tok.text) && m.handle !== 'operator')
        .slice(0, 8)
        .map((m) => ({ key: `@${m.handle}`, insert: `@${m.handle} `, label: `@${m.handle}`, hint: m.kind === 'human' ? t('human') : m.kind === 'claude' ? t('cli') : t('api') }));
    } else {
      this.acItems = this.ledger.messages()
        .filter((m) => (m.body || '').trim() && String(m.seq).startsWith(tok.text))
        .sort((a, b) => b.seq - a.seq)
        .slice(0, 8)
        .map((m) => ({ key: `#${m.seq}`, insert: `#${m.seq} `, label: `#${m.seq} @${m.author}`, hint: (m.body || '').slice(0, 44) }));
    }
    if (!this.acItems.length) { this.closeAc(); return; }
    this.acSel = 0;
    this.paintAc();
  }

  private paintAc(): void {
    setHidden(this.acEl, false);
    patchFilled(this.acEl, this.acItems, {
      key: (i) => i.key,
      create: () => el<HTMLElement>('<button type="button" class="cx-ac-item" role="option"><b></b><span></span></button>'),
      update: (node, i) => {
        setText(q(node, 'b'), i.label);
        setText(q(node, 'span'), i.hint);
        setClass(node, 'sel', this.acItems[this.acSel]?.key === i.key);
      },
    });
  }

  private closeAc(): void {
    setHidden(this.acEl, true);
    this.acRange = null;
    this.acItems = [];
  }

  private acceptAc(i: number): void {
    const it = this.acItems[i];
    const range = this.acRange;
    if (!it || !range) return;
    this.input.value = this.input.value.slice(0, range.start) + it.insert + this.input.value.slice(range.end);
    const pos = range.start + it.insert.length;
    this.input.setSelectionRange(pos, pos);
    this.closeAc();
    this.input.focus();
    this.updateReach();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.acEl.hidden && this.acItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.acSel = Math.max(0, Math.min(this.acItems.length - 1, this.acSel + (e.key === 'ArrowDown' ? 1 : -1)));
        this.paintAc();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); this.acceptAc(this.acSel); return; }
      if (e.key === 'Escape') { this.closeAc(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void this.submit(); }
  }

  private async submit(): Promise<void> {
    const body = this.input.value.trim();
    if (!body || !this.active || this.busy) return;
    this.busy = true;
    this.materialized = false;
    this.input.value = '';
    this.updateReach();
    this.closeAc();
    try {
      await cogentics.post(this.active, body, workspaceTrusted());
    } catch (err) {
      this.input.value = body;
      toast(`${t('Post failed')}: ${failText(err)}`, 'error');
    } finally {
      this.busy = false;
    }
  }

  private async newChannel(): Promise<void> {
    const name = await promptName(t('New channel'), '', t('Create'));
    if (!name) return;
    try {
      await cogentics.create(name.trim());
      await this.refresh();
      await this.select(name.trim());
    } catch (err) {
      toast(`${t('Could not create the channel')}: ${failText(err)}`, 'error');
    }
  }

  private async deleteChannel(): Promise<void> {
    const name = this.active;
    if (!name) return;
    if (!(await confirmAction(t('Delete channel'), `${t('Delete')} #${name} ${t('and its whole ledger?')}`, t('Delete'), true))) return;
    try {
      await cogentics.remove(name);
    } catch (err) {
      toast(failText(err), 'error');
      return;
    }
    this.closeStream();
    this.active = '';
    this.members = [];
    this.ledger.clear();
    this.rail.set([]);
    this.syncControls();
    await this.refresh();
    this.paintEmpty();
  }

  private async decide(seq: number, approved: boolean): Promise<void> {
    try {
      await cogentics.decide(this.active, seq, approved);
    } catch {
      toast(t('That approval was already settled.'), 'error');
    }
  }

  private async toggleMember(m: Member): Promise<void> {
    try {
      await cogentics.setState(this.active, m.handle, m.state === 'active' ? 'paused' : 'active', workspaceTrusted());
    } catch (err) {
      toast(failText(err), 'error');
    }
  }

  private async removeMember(m: Member): Promise<void> {
    if (!(await confirmAction(t('Remove member'), `${t('Remove')} @${m.handle} ${t('from the channel?')}`, t('Remove'), true))) return;
    try {
      await cogentics.removeMember(this.active, m.handle);
    } catch (err) {
      toast(failText(err), 'error');
    }
  }

  private async release(m: Member): Promise<void> {
    try {
      await cogentics.release(this.active, m.handle, workspaceTrusted());
      this.rail.setLive(m.handle, { state: 'idle', held: 0 });
    } catch (err) {
      toast(failText(err), 'error');
    }
  }

  private async saveBrake(): Promise<void> {
    if (!this.active) return;
    const v = Math.max(0, Math.min(99, Number(this.brakeEl.value) || 0));
    this.brakeEl.value = String(v);
    try {
      await cogentics.config(this.active, { turn_brake: v });
      toast(v ? `${t('Turn brake set to')} ${v}` : t('Turn brake off'));
    } catch (err) {
      toast(failText(err), 'error');
    }
  }

  private async saveGated(): Promise<void> {
    if (!this.active) return;
    const list = this.gatedEl.value.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const r = await cogentics.config(this.active, { approval_tools: list });
      this.gatedEl.value = r.gated.join(', ');
      toast(r.gated.length ? `${t('Approval needed for')} ${r.gated.join(', ')}` : t('No tool needs approval'));
    } catch (err) {
      toast(failText(err), 'error');
    }
  }

  private async addPreset(): Promise<void> {
    if (!this.active) { toast(t('Select a channel first.'), 'error'); return; }
    if (!this.presetSel.value) return;
    try {
      const r = await cogentics.installPreset(this.active, this.presetSel.value);
      toast(r.added.length ? `${t('Added')} ${r.added.map((h) => `@${h}`).join(' ')}` : t('All preset handles are already present.'));
    } catch (err) {
      toast(failText(err), 'error');
    }
  }

  private async addMember(root: HTMLElement): Promise<void> {
    const handle = q<HTMLInputElement>(root, '.cx-handle');
    const prompt = q<HTMLTextAreaElement>(root, '.cx-prompt');
    const full = q<HTMLInputElement>(root, '.cx-full-box');
    if (!this.active) { toast(t('Select a channel first.'), 'error'); return; }
    if (!handle.value.trim()) { toast(t('A handle is required.'), 'error'); return; }
    try {
      await cogentics.addMember(this.active, {
        handle: handle.value.trim(), role_prompt: prompt.value.trim(), kind: this.kindSel.value,
        full_access: this.kindSel.value === 'claude' && full.checked, model: this.modelSel.value,
      });
      handle.value = '';
      prompt.value = '';
    } catch (err) {
      toast(failText(err), 'error');
    }
  }
}
