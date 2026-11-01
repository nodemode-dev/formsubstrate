import { formslot, formslotState, FORMSLOT_OPEN, SESSION_SELECTED, type SlotCopy, type SlotDetail, type SlotFile, type SlotHit } from '../../io/formslot';
import { sessionsClient } from '../../io/sessions';
import { detailOf } from '../../io/workspace';
import { confirmAction } from '../../ui/dialogs';
import { desktopNotify } from '../../ui/desktop-notify';
import { el, mountOnce, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { GateCards } from '../../ui/gate-cards';
import { onLanguage, t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { loadPrefs } from '../../ui/prefs';
import { toast } from '../../ui/toast';
import { FOCUS_EVENT } from '../../ui/workbench';
import { register, type ExtensionContext, type Shell, type SidebarSection } from '../registry';

const DEBOUNCE_MS = 260;
const OFFERED_KEY = 'subform.formslot.offered';

const DRIFT_LABEL: Record<string, string> = {
  clean: 'in sync',
  local: 'edited here',
  behind: 'slot has changed',
  diverged: 'diverged',
  missing: 'missing',
};

const STATUS_LABEL: Record<string, string> = {
  canonical: 'canonical',
  proposed: 'proposed',
  deprecated: 'deprecated',
  declined: 'declined',
  superseded: 'superseded',
};

interface Row {
  key: string;
  kind: 'slot' | 'unit' | 'memory';
  id: string;
  title: string;
  status: string;
  summary: string;
  where: string;
  path: string;
  line: number;
}

interface Line {
  key: string;
  main: string;
  sub: string;
  chip: string;
  state: string;
  path: string;
  line: number;
}

const startLine = (lines: SlotHit['lines']): number => {
  if (Array.isArray(lines)) return Number(lines[0]) || 0;
  if (typeof lines === 'string') return Number(/\d+/.exec(lines)?.[0]) || 0;
  return 0;
};

const toRow = (h: SlotHit, i: number): Row => {
  const kind = h.kind === 'slot' ? 'slot' : h.kind === 'memory' ? 'memory' : 'unit';
  const line = startLine(h.lines);
  const path = h.path ?? '';
  return {
    key: `${kind}:${h.id}:${i}`,
    kind,
    id: h.id,
    title: h.title || h.qualified || h.id,
    status: h.status ?? '',
    summary: h.summary ?? '',
    where: path ? (line > 0 ? `${path}:${line}` : path) : '',
    path,
    line,
  };
};

const lastLine = (text: string): string => text.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';

class FormslotPanel {
  private readonly input: HTMLInputElement;
  private readonly stateDot: HTMLElement;
  private readonly stateText: HTMLElement;
  private readonly stateSub: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly indexBtn: HTMLButtonElement;
  private readonly installBtn: HTMLButtonElement;
  private readonly mode: HTMLSelectElement;
  private readonly note: HTMLElement;
  private readonly results: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly manifest: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly mId: HTMLElement;
  private readonly mStatus: HTMLElement;
  private readonly mSummary: HTMLElement;
  private readonly mFiles: HTMLElement;
  private readonly mCopies: HTMLElement;
  private readonly mDrift: HTMLElement;
  private readonly mEmpty: HTMLElement;
  private rows: Row[] = [];
  private query = '';
  private searched = false;
  private problem = '';
  private searching = false;
  private seq = 0;
  private timer = 0;
  private frame = 0;
  private busy = false;
  private noteText = '';
  private noteBad = false;
  private open: string | null = null;
  private detail: SlotDetail | null = null;
  private detailProblem = '';
  private detailSeq = 0;

  constructor(private readonly host: HTMLElement, private readonly ctx: ExtensionContext, private readonly shell: Shell) {
    mountOnce(host, `<div class="cv-fs">
<div class="cv-fs-bar"><input class="cv-input cv-fs-q" type="search" spellcheck="false" autocomplete="off"><button class="cv-wb-tool cv-fs-go" type="button">${icon('search', 14)}</button><button class="cv-wb-tool cv-fs-refresh" type="button">${icon('refresh', 14)}</button></div>
<div class="cv-fs-state"><span class="cv-fs-dot"></span><span class="cv-fs-state-t"></span></div>
<p class="cv-fs-state-sub cv-note"></p>
<div class="cv-fs-acts"><button class="cv-btn cv-fs-start" type="button">${icon('play', 14)}<span class="cv-fs-bt"></span></button><button class="cv-btn cv-fs-index" type="button">${icon('refresh', 14)}<span class="cv-fs-bt"></span></button></div>
<div class="cv-fs-acts"><button class="cv-btn cv-fs-install" type="button">${icon('add', 14)}<span class="cv-fs-bt"></span></button><select class="cv-input cv-fs-mode"><option value="warn"></option><option value="deny"></option></select></div>
<p class="cv-fs-note cv-note" role="status"></p>
<div class="cv-fs-body">
<div class="cv-fs-results"><div class="cv-fs-list" role="list"></div><p class="cv-fs-empty cv-note"></p></div>
<div class="cv-fs-manifest" hidden>
<div class="cv-fs-mhead"><button class="cv-wb-tool cv-fs-back" type="button">${icon('chevronLeft', 14)}</button><span class="cv-fs-mid"></span><span class="cv-fs-chip cv-fs-mstatus"></span></div>
<p class="cv-fs-msummary"></p>
<div class="cv-fs-mscroll">
<div class="cv-fs-sec"><span class="cv-fs-sec-t" data-k="files"></span></div><div class="cv-fs-mfiles" role="list"></div>
<div class="cv-fs-sec"><span class="cv-fs-sec-t" data-k="copies"></span></div><div class="cv-fs-mcopies" role="list"></div>
<div class="cv-fs-sec"><span class="cv-fs-sec-t" data-k="drift"></span></div><div class="cv-fs-mdrift" role="list"></div>
<p class="cv-fs-mempty cv-note"></p>
</div>
<div class="cv-fs-mfoot"><button class="cv-btn cv-fs-confirm" type="button">${icon('check', 14)}<span class="cv-fs-bt"></span></button></div>
</div>
</div>
</div>`);
    this.input = q<HTMLInputElement>(host, '.cv-fs-q');
    this.stateDot = q(host, '.cv-fs-dot');
    this.stateText = q(host, '.cv-fs-state-t');
    this.stateSub = q(host, '.cv-fs-state-sub');
    this.startBtn = q<HTMLButtonElement>(host, '.cv-fs-start');
    this.indexBtn = q<HTMLButtonElement>(host, '.cv-fs-index');
    this.installBtn = q<HTMLButtonElement>(host, '.cv-fs-install');
    this.mode = q<HTMLSelectElement>(host, '.cv-fs-mode');
    this.note = q(host, '.cv-fs-note');
    this.results = q(host, '.cv-fs-results');
    this.list = q(host, '.cv-fs-list');
    this.empty = q(host, '.cv-fs-empty');
    this.manifest = q(host, '.cv-fs-manifest');
    this.backBtn = q<HTMLButtonElement>(host, '.cv-fs-back');
    this.confirmBtn = q<HTMLButtonElement>(host, '.cv-fs-confirm');
    this.mId = q(host, '.cv-fs-mid');
    this.mStatus = q(host, '.cv-fs-mstatus');
    this.mSummary = q(host, '.cv-fs-msummary');
    this.mFiles = q(host, '.cv-fs-mfiles');
    this.mCopies = q(host, '.cv-fs-mcopies');
    this.mDrift = q(host, '.cv-fs-mdrift');
    this.mEmpty = q(host, '.cv-fs-mempty');

    this.input.addEventListener('input', () => this.type());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); window.clearTimeout(this.timer); void this.search(); }
      if (e.key === 'Escape' && this.input.value) { e.preventDefault(); this.input.value = ''; this.type(); }
    });
    q<HTMLButtonElement>(host, '.cv-fs-go').addEventListener('click', () => { window.clearTimeout(this.timer); void this.search(); });
    q<HTMLButtonElement>(host, '.cv-fs-refresh').addEventListener('click', () => { void this.reload(); });
    this.startBtn.addEventListener('click', () => { void this.start(); });
    this.indexBtn.addEventListener('click', () => { void this.index(); });
    this.installBtn.addEventListener('click', () => { void this.install(); });
    this.backBtn.addEventListener('click', () => this.close());
    this.confirmBtn.addEventListener('click', () => { void this.confirm(); });
    this.list.addEventListener('click', (e) => this.onRow(e));
    this.list.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-fs-row') : null;
      if (!row || e.target !== row) return;
      e.preventDefault();
      this.activate(row.dataset.key ?? '');
    });
    for (const list of [this.mFiles, this.mCopies, this.mDrift]) {
      list.addEventListener('click', (e) => {
        const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-fs-line') : null;
        const path = row?.dataset.path;
        if (path) this.shell.openEditorTab(path, Number(row.dataset.line) || undefined);
      });
    }
    host.addEventListener(FOCUS_EVENT, () => { this.input.focus(); void formslotState.refresh(); void formslotState.ensureDrift(true); });
    formslotState.on('status', () => this.schedule());
    formslotState.on('drift', () => this.schedule());
    ctx.store.on('workspace', () => this.schedule());
    onLanguage(() => this.schedule());
    this.paint();
  }

  focusSearch(): void { this.input.focus(); }

  get working(): boolean { return this.busy; }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  private type(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.search(); }, DEBOUNCE_MS);
  }

  private async reload(): Promise<void> {
    await formslotState.refresh();
    await formslotState.ensureDrift(true);
    if (this.open) await this.load(this.open);
    else if (this.query) await this.search();
    this.paint();
  }

  async search(): Promise<void> {
    const text = this.input.value.trim();
    const mine = ++this.seq;
    this.query = text;
    if (!text) {
      this.rows = [];
      this.searched = false;
      this.problem = '';
      this.searching = false;
      this.paint();
      return;
    }
    if (formslotState.phase !== 'running') {
      this.searched = false;
      this.problem = '';
      this.paint();
      return;
    }
    this.searching = true;
    this.paint();
    try {
      const r = await formslot.find(text);
      if (mine !== this.seq) return;
      this.rows = (r.hits ?? []).map(toRow);
      this.problem = '';
    } catch (err) {
      if (mine !== this.seq) return;
      this.problem = detailOf(err);
    }
    this.searched = true;
    this.searching = false;
    this.paint();
  }

  private onRow(e: MouseEvent): void {
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-fs-row') : null;
    if (row) this.activate(row.dataset.key ?? '');
  }

  private activate(key: string): void {
    const row = this.rows.find((r) => r.key === key);
    if (!row) return;
    if (row.kind === 'slot') { void this.show(row.id); return; }
    if (row.path) this.shell.openEditorTab(row.path, row.line || undefined);
  }

  async show(id: string): Promise<void> {
    this.open = id;
    this.detail = null;
    this.detailProblem = '';
    this.paint();
    await this.load(id);
  }

  private async load(id: string): Promise<void> {
    const mine = ++this.detailSeq;
    try {
      const d = await formslot.get(id);
      if (mine !== this.detailSeq || this.open !== id) return;
      this.detail = d;
      this.detailProblem = '';
    } catch (err) {
      if (mine !== this.detailSeq || this.open !== id) return;
      this.detailProblem = detailOf(err);
    }
    void formslotState.ensureDrift();
    this.paint();
  }

  private close(): void {
    this.open = null;
    this.detail = null;
    this.detailSeq++;
    this.paint();
    this.input.focus();
  }

  private say(text: string, bad = false): void {
    this.noteText = text;
    this.noteBad = bad;
    this.schedule();
  }

  private async run(job: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.paint();
    try {
      await job();
    } catch (err) {
      this.say(detailOf(err), true);
    } finally {
      this.busy = false;
      this.paint();
    }
  }

  private start(): Promise<void> {
    return this.run(async () => {
      this.say(t('Starting formslot'));
      await formslotState.start();
      this.say(t('formslot is running.'));
    });
  }

  index(): Promise<void> {
    return this.run(async () => {
      this.say(t('Indexing the workspace'));
      const r = await formslot.index(this.ctx.store.workspace?.path);
      this.say(lastLine(r.output) || t(r.ok ? 'Indexed.' : 'Indexing failed.'), !r.ok);
      await formslotState.refresh();
      await formslotState.ensureDrift(true);
    });
  }

  install(): Promise<void> {
    return this.run(async () => {
      const mode = this.mode.value === 'deny' ? 'deny' : 'warn';
      const ws = this.ctx.store.workspace;
      if (!ws) return;
      const why = mode === 'deny' ? t('Writes of code that already exists are refused.') : t('Agents are warned before writing code that already exists.');
      if (!(await confirmAction('Install formslot plugin', `${ws.name}: ${t('adds formslot hooks and skills under .claude in this repository.')} ${why}`, 'Install'))) return;
      this.say(t('Installing'));
      const r = await formslot.install(mode);
      this.say(lastLine(r.output) || t(r.ok ? 'Installed.' : 'Install failed.'), !r.ok);
      await formslotState.refresh();
    });
  }

  confirm(): Promise<void> {
    return this.run(async () => {
      const id = this.open;
      if (!id) return;
      if (!(await confirmAction('Confirm slot', `${id}: ${t('marks this slot canonical. Only you can do this; agents can only propose.')}`, 'Confirm'))) return;
      const r = await formslot.confirm(id);
      this.say(lastLine(r.output) || t(r.ok ? 'Confirmed.' : 'Confirm failed.'), !r.ok);
      await this.load(id);
    });
  }

  private paint(): void {
    const phase = formslotState.phase;
    const on = formslotState.isEnabled;
    const s = formslotState.status;
    const ws = this.ctx.store.workspace;
    const running = on && phase === 'running';
    const key = on ? phase : 'off';
    if (this.stateDot.dataset.phase !== key) this.stateDot.dataset.phase = key;
    const label: Record<string, string> = {
      unknown: 'Checking formslot',
      unreachable: 'The engine cannot be reached',
      missing: 'formslot is not installed',
      off: 'formslot is not running',
      starting: 'formslot is starting',
      running: 'formslot is running',
    };
    setText(this.stateText, on ? t(label[phase]) : t('formslot is turned off in Preferences.'));
    const sub: string[] = [];
    if (on && s && !s.installed) {
      sub.push(s.note);
    } else if (on && s) {
      if (s.running) sub.push(`${s.version ?? ''}`.trim());
      sub.push(`${s.corpora.length} ${t(s.corpora.length === 1 ? 'corpus' : 'corpora')}`);
      if (ws) sub.push(s.workspaceCorpus ? `${t('this workspace')}: ${s.workspaceCorpus}` : t('this workspace is not indexed'));
    } else if (on && formslotState.problem) sub.push(formslotState.problem);
    setText(this.stateSub, sub.filter(Boolean).join(' · '));
    setTitle(this.stateSub, s?.binary ?? '');

    setText(q(this.startBtn, '.cv-fs-bt'), t('Start'));
    setText(q(this.indexBtn, '.cv-fs-bt'), t('Index'));
    setTitle(this.indexBtn, t('Index this workspace for formslot'));
    setText(q(this.installBtn, '.cv-fs-bt'), t('Install plugin'));
    setDisabled(this.startBtn, !on || this.busy || !s?.installed || s.running);
    setDisabled(this.indexBtn, !running || this.busy || !ws);
    setDisabled(this.installBtn, !on || this.busy || !s?.installed || !ws || s.pluginInstalled === true);
    setDisabled(this.mode, !on || this.busy);
    const opts = this.mode.options;
    if (opts[0].text !== t('Warn')) opts[0].text = t('Warn');
    if (opts[1].text !== t('Deny')) opts[1].text = t('Deny');
    setTitle(this.installBtn, s?.pluginInstalled === true ? t('The plugin is already installed in this workspace.') : t('Install the formslot plugin in this repository'));
    setTitle(this.mode, t('Warn lets the agent decide; Deny refuses the write'));
    setText(this.note, this.noteText);
    setClass(this.note, 'is-error', this.noteBad);

    const input = this.input;
    const ph = t('Search slots, code and decisions');
    if (input.placeholder !== ph) input.placeholder = ph;
    input.setAttribute('aria-label', t('Search formslot'));

    patchList(this.list, this.rows, { key: (r) => r.key, create: (r) => this.createRow(r), update: (n, r) => this.updateRow(n, r) });
    let msg = '';
    if (!running && on) msg = t(phase === 'missing' ? 'Install formslot to search the slots of your repositories.' : 'Start formslot to search.');
    else if (this.problem) msg = this.problem;
    else if (!this.query) msg = t('Type to search the slots, code and decisions of your indexed repositories.');
    else if (this.searched && this.rows.length === 0) msg = t('Nothing found.');
    setText(this.empty, msg);
    setClass(this.empty, 'is-error', !!this.problem && running);
    setHidden(this.empty, msg === '');
    this.list.setAttribute('aria-busy', String(this.searching));

    this.paintManifest();
  }

  private createRow(r: Row): HTMLElement {
    const n = el(`<div class="cv-fs-row" role="listitem" tabindex="0"><div class="cv-fs-top"><span class="cv-fs-kind"></span><span class="cv-fs-title"></span><span class="cv-fs-chip"></span></div><div class="cv-fs-sum"></div><div class="cv-fs-where"></div></div>`);
    this.updateRow(n, r);
    return n;
  }

  private updateRow(n: HTMLElement, r: Row): void {
    if (n.dataset.kind !== r.kind) n.dataset.kind = r.kind;
    setText(q(n, '.cv-fs-kind'), t(r.kind === 'slot' ? 'slot' : r.kind === 'memory' ? 'memory' : 'code'));
    setText(q(n, '.cv-fs-title'), r.title);
    setTitle(q(n, '.cv-fs-title'), r.id);
    const chip = q(n, '.cv-fs-chip');
    setText(chip, r.status ? t(STATUS_LABEL[r.status] ?? r.status) : '');
    if (chip.dataset.status !== r.status) chip.dataset.status = r.status;
    setText(q(n, '.cv-fs-sum'), r.summary);
    setHidden(q(n, '.cv-fs-sum'), !r.summary);
    setText(q(n, '.cv-fs-where'), r.where || r.id);
    setTitle(n, r.where || r.id);
  }

  private paintManifest(): void {
    const open = this.open;
    setHidden(this.manifest, !open);
    setHidden(this.results, !!open);
    if (!open) return;
    const d = this.detail;
    setText(this.mId, d?.id ?? open);
    setTitle(this.mId, d?.title ?? open);
    const status = d?.status ?? '';
    setText(this.mStatus, status ? t(STATUS_LABEL[status] ?? status) : '');
    if (this.mStatus.dataset.status !== status) this.mStatus.dataset.status = status;
    setText(this.mSummary, d ? [d.title, d.summary].filter(Boolean).join(': ') : this.detailProblem || t('Loading'));
    setClass(this.mSummary, 'is-error', !!this.detailProblem);
    for (const k of Array.from(this.manifest.querySelectorAll<HTMLElement>('.cv-fs-sec-t'))) {
      const names: Record<string, string> = { files: 'Files', copies: 'Copies', drift: 'Drift in this workspace' };
      setText(k, t(names[k.dataset.k ?? ''] ?? ''));
    }
    const files: Line[] = (d?.files ?? []).map((f: SlotFile, i) => ({ key: `f:${f.path}:${i}`, main: f.path, sub: f.role ?? '', chip: '', state: '', path: f.path, line: 0 }));
    const copies: Line[] = (d?.copies ?? []).map((c: SlotCopy, i) => ({
      key: `c:${c.repo ?? ''}:${c.path}:${i}`,
      main: c.path,
      sub: [c.repo, c.qualified, c.lines ? `${c.lines[0]}-${c.lines[1]}` : ''].filter(Boolean).join(' · '),
      chip: [c.relation, c.score !== undefined ? c.score.toFixed(2) : ''].filter(Boolean).join(' '),
      state: c.relation ?? '',
      path: c.path,
      line: c.lines?.[0] ?? 0,
    }));
    const drift: Line[] = formslotState.driftFiles.filter((f) => f.slot === open).map((f) => ({ key: `d:${f.path}`, main: f.path, sub: '', chip: t(DRIFT_LABEL[f.state] ?? f.state), state: f.state, path: f.path, line: 0 }));
    for (const [host, items] of [[this.mFiles, files], [this.mCopies, copies], [this.mDrift, drift]] as const) {
      patchList(host, items, { key: (l) => l.key, create: (l) => this.createLine(l), update: (n, l) => this.updateLine(n, l) });
    }
    const none = !!d && files.length + copies.length + drift.length === 0;
    setText(this.mEmpty, none ? t('No files, copies or drift recorded for this slot.') : '');
    setHidden(this.mEmpty, !none);
    const canonical = status === 'canonical';
    setText(q(this.confirmBtn, '.cv-fs-bt'), t(canonical ? 'Confirmed' : 'Confirm as owner'));
    setDisabled(this.confirmBtn, !d || canonical || this.busy);
    setTitle(this.confirmBtn, t('Only the owner can make a slot canonical'));
    setTitle(this.backBtn, t('Back to results'));
    this.backBtn.setAttribute('aria-label', t('Back to results'));
  }

  private createLine(l: Line): HTMLElement {
    const n = el('<div class="cv-fs-line" role="listitem"><span class="cv-fs-line-main"></span><span class="cv-fs-line-sub"></span><span class="cv-fs-line-chip"></span></div>');
    this.updateLine(n, l);
    return n;
  }

  private updateLine(n: HTMLElement, l: Line): void {
    if (n.dataset.path !== l.path) n.dataset.path = l.path;
    if (n.dataset.line !== String(l.line)) n.dataset.line = String(l.line);
    setText(q(n, '.cv-fs-line-main'), l.main);
    setTitle(n, l.main);
    setText(q(n, '.cv-fs-line-sub'), l.sub);
    const chip = q(n, '.cv-fs-line-chip');
    setText(chip, l.chip);
    setHidden(chip, !l.chip);
    if (chip.dataset.state !== l.state) chip.dataset.state = l.state;
  }
}

const readOffered = (): Set<string> => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(OFFERED_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
};

const markOffered = (path: string): void => {
  const set = readOffered();
  set.add(path);
  try { localStorage.setItem(OFFERED_KEY, JSON.stringify([...set])); } catch { return; }
};

register({
  id: 'formslot',
  name: 'formslot',
  description: 'Search the slots of your repositories, review copies and drift, and answer the existing-slot prompt.',
  required: true,
  setup(ctx: ExtensionContext, shell: Shell): void {
    let section: SidebarSection | null = null;
    let panel: FormslotPanel | null = null;
    const gates = new GateCards();
    const applyPrefs = (): void => { formslotState.setEnabled(loadPrefs().formslotEnabled); };
    applyPrefs();
    section = shell.sidebarSection({
      id: 'formslot',
      title: 'formslot',
      icon: 'slot',
      render: (host) => { panel = new FormslotPanel(host, ctx, shell); },
    });
    const hasWs = (): boolean => !!ctx.store.workspace;
    ctx.commands.add(
      { id: 'formslot-panel', label: 'formslot', run: () => { section?.reveal(); panel?.focusSearch(); } },
      { id: 'formslot-start', label: 'Start formslot', enabled: () => formslotState.phase === 'off', run: () => { section?.reveal(); void formslotState.start().catch((err: unknown) => toast(detailOf(err), 'error')); } },
      { id: 'formslot-index', label: 'Index Workspace for formslot', enabled: () => hasWs() && formslotState.phase === 'running', run: () => { section?.reveal(); void panel?.index(); } },
      { id: 'formslot-install', label: 'Install formslot Plugin', enabled: () => hasWs() && !!formslotState.status?.installed, run: () => { section?.reveal(); void panel?.install(); } },
      { id: 'formslot-gate', label: 'Answer Existing Slot Prompt', keys: ['Alt+Mod+G'], enabled: () => gates.count > 0, run: () => gates.focusFirst() },
    );

    window.addEventListener(FORMSLOT_OPEN, () => { section?.reveal(); panel?.focusSearch(); });
    window.addEventListener(SESSION_SELECTED, (e) => {
      const id = (e as CustomEvent<{ id?: string | null }>).detail?.id;
      formslotState.setActiveSession(typeof id === 'string' ? id : null);
    });
    document.addEventListener('nm:ui-settings-changed', applyPrefs);

    sessionsClient.on('gate', (g) => {
      const name = sessionsClient.get(g.session)?.title ?? g.session;
      if (document.hidden || !document.hasFocus()) desktopNotify(t('Existing slot found'), `${name}: ${g.message}`);
    });

    let autoStarted = false;
    let offeredFor = '';
    let fresh = '';
    const offer = (path: string): void => {
      const s = formslotState.status;
      if (!formslotState.isEnabled || !s || !s.installed || s.pluginInstalled !== false) return;
      if (readOffered().has(path)) return;
      markOffered(path);
      const name = ctx.store.workspace?.name ?? path;
      toast(`${t('Install formslot for this repository')}: ${name}. ${t('Agents are warned before writing code that already exists.')}`, 'info', {
        ms: 0,
        actions: [
          { label: t('Install'), run: () => { void formslot.install('warn').then((r) => { toast(lastLine(r.output) || t(r.ok ? 'Installed.' : 'Install failed.'), r.ok ? 'info' : 'error'); return formslotState.refresh(); }).catch((err: unknown) => toast(detailOf(err), 'error')); } },
          { label: t('Not now'), run: () => undefined },
        ],
      });
    };
    const onWorkspace = (): void => {
      const path = ctx.store.workspace?.path ?? '';
      if (path === offeredFor) return;
      offeredFor = path;
      fresh = '';
      formslotState.forgetDrift();
      if (!path) return;
      void formslotState.refresh(true).then(() => {
        if (ctx.store.workspace?.path !== path) return;
        fresh = path;
        offer(path);
      });
    };
    ctx.store.on('workspace', onWorkspace);
    formslotState.on('status', () => {
      if (fresh && fresh === offeredFor) offer(fresh);
      const s = formslotState.status;
      if (autoStarted || !s || !s.installed || s.running || !hasWs() || !formslotState.isEnabled || !loadPrefs().formslotAutoStart) return;
      autoStarted = true;
      void formslotState.start().catch(() => undefined);
    });
    formslotState.begin();
    if (hasWs()) onWorkspace();
    void sessionsClient.refreshGates().catch(() => undefined);
  },
});
