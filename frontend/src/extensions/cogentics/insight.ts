import { ApiError } from '../../io/api';
import { insight, type ChangeInfo, type ScopeInfo, type UsageBucket, type UsageSummary } from '../../io/cogentics';
import { confirmAction } from '../../ui/dialogs';
import { el, patchList, q, setClass, setHidden, setStyleVar, setText, setTitle } from '../../ui/dom';
import { t, tn } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { toast } from '../../ui/toast';
import type { ExtensionContext } from '../registry';
import { paintDiff, fmtTok } from './rich';

interface Pair { key: string; name: string; b: UsageBucket }

const money = (n: number): string => (n ? `$${n.toFixed(n < 0.01 ? 4 : 3)}` : '$0');
const tok = (b: UsageBucket): number => b.prompt_tokens + b.completion_tokens;
const when = (ts: number): string => new Date(ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export class InsightPanel {
  private days = 7;
  private scope = '';
  private file = '';
  private summary: UsageSummary | null = null;
  private scopes: ScopeInfo[] = [];
  private changes: ChangeInfo[] = [];
  private readonly total: HTMLElement;
  private readonly bars: HTMLElement;
  private readonly models: HTMLElement;
  private readonly groups: HTMLElement;
  private readonly scopeList: HTMLElement;
  private readonly fileList: HTMLElement;
  private readonly diffEl: HTMLElement;
  private readonly diffHead: HTMLElement;
  private readonly noScopes: HTMLElement;
  private readonly noFiles: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly range: HTMLButtonElement[];

  constructor(host: HTMLElement, private readonly ctx: ExtensionContext) {
    const root = el<HTMLElement>(`<div class="ix">
<div class="ix-bar"><span class="ix-title">${t('Usage')}</span><span class="ix-spacer"></span><button type="button" class="cv-btn ix-range" data-days="7">${t('7 days')}</button><button type="button" class="cv-btn ix-range" data-days="30">${t('30 days')}</button><button type="button" class="cv-tt-btn ix-refresh" title="${t('Refresh')}" aria-label="${t('Refresh')}">${icon('refresh', 13)}</button></div>
<div class="ix-total"></div>
<div class="ix-bars" aria-hidden="true"></div>
<div class="ix-head">${t('By model')}</div><div class="ix-list ix-models"></div>
<div class="ix-head">${t('By source')}</div><div class="ix-list ix-groups"></div>
<div class="ix-bar ix-bar-changes"><button type="button" class="cv-tt-btn ix-back" title="${t('Back to the list')}" aria-label="${t('Back to the list')}" hidden>${icon('chevronLeft', 14)}</button><span class="ix-title ix-changes-title">${t('Changes by turn')}</span></div>
<p class="ix-none cv-note">${t('No tracked changes yet. File writes by agent members are recorded here with a pre-image so each can be reviewed or reverted.')}</p>
<div class="ix-scopes"></div>
<p class="ix-none-files cv-note" hidden>${t('This turn changed no files.')}</p>
<div class="ix-files" hidden></div>
<div class="ix-diff-head" hidden></div><pre class="ix-diff" hidden></pre>
</div>`);
    host.append(root);
    this.total = q(root, '.ix-total');
    this.bars = q(root, '.ix-bars');
    this.models = q(root, '.ix-models');
    this.groups = q(root, '.ix-groups');
    this.scopeList = q(root, '.ix-scopes');
    this.fileList = q(root, '.ix-files');
    this.diffEl = q(root, '.ix-diff');
    this.diffHead = q(root, '.ix-diff-head');
    this.noScopes = q(root, '.ix-none');
    this.noFiles = q(root, '.ix-none-files');
    this.back = q<HTMLButtonElement>(root, '.ix-back');
    this.range = Array.from(root.querySelectorAll<HTMLButtonElement>('.ix-range'));
    for (const b of this.range) b.addEventListener('click', () => { this.days = Number(b.dataset.days); void this.load(); });
    q(root, '.ix-refresh').addEventListener('click', () => { void this.load(); });
    this.back.addEventListener('click', () => { this.file = ''; if (this.fileOpen()) this.closeFile(); else this.scope = ''; this.paintChanges(); });
    this.scopeList.addEventListener('click', (e) => {
      const key = e.target instanceof Element ? e.target.closest<HTMLElement>('.ix-scope')?.dataset.key : undefined;
      if (key) void this.openScope(key);
    });
    this.fileList.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const row = target?.closest<HTMLElement>('.ix-file');
      if (!row?.dataset.key) return;
      if (target?.closest('.ix-revert')) void this.revert(row.dataset.key);
      else void this.openFile(row.dataset.key);
    });
    host.addEventListener('wb-focus', () => { void this.load(); });
    ctx.store.on('workspace', () => { this.scope = ''; this.file = ''; this.changes = []; void this.load(); });
    void this.load();
  }

  private fileOpen(): boolean {
    return !this.diffEl.hidden;
  }

  private closeFile(): void {
    setHidden(this.diffEl, true);
    setHidden(this.diffHead, true);
  }

  async load(): Promise<void> {
    if (!this.ctx.store.workspace) {
      this.summary = null;
      this.scopes = [];
      this.paintUsage();
      this.paintChanges();
      return;
    }
    try {
      const [s, sc] = await Promise.all([insight.summary(this.days), insight.scopes()]);
      this.summary = s;
      this.scopes = sc.scopes;
    } catch {
      return;
    }
    this.paintUsage();
    this.paintChanges();
    if (this.scope) await this.loadChanges();
  }

  async showScope(id: string): Promise<void> {
    await this.load();
    await this.openScope(id);
  }

  private async openScope(id: string): Promise<void> {
    this.scope = id;
    this.file = '';
    this.closeFile();
    await this.loadChanges();
  }

  private async loadChanges(): Promise<void> {
    try {
      this.changes = (await insight.changes(this.scope)).changes;
    } catch {
      this.changes = [];
    }
    this.paintChanges();
  }

  private async openFile(path: string): Promise<void> {
    this.file = path;
    try {
      const d = await insight.diff(this.scope, path);
      paintDiff(this.diffEl, d.diff);
      setText(this.diffHead, path);
      setHidden(this.diffEl, false);
      setHidden(this.diffHead, false);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
    this.paintChanges();
  }

  private async revert(path: string): Promise<void> {
    if (!(await confirmAction(t('Revert file'), `${t('Restore')} ${path} ${t('to its state before this turn?')}`, t('Revert'), true))) return;
    try {
      const r = await insight.revert(this.scope, path);
      toast(`${r.action === 'removed' ? t('Removed') : t('Restored')} ${r.reverted}`);
      await this.loadChanges();
      if (this.file === path) await this.openFile(path);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error');
    }
  }

  private pairs(map: Record<string, UsageBucket>): Pair[] {
    return Object.entries(map).map(([name, b]) => ({ key: name, name, b })).sort((a, b) => b.b.cost - a.b.cost || tok(b.b) - tok(a.b));
  }

  private rows(host: HTMLElement, list: Pair[]): void {
    patchList(host, list, {
      key: (p) => p.key,
      create: () => el<HTMLElement>('<div class="ix-row"><span class="ix-row-name"></span><span class="ix-row-val"></span></div>'),
      update: (node, p) => {
        setText(q(node, '.ix-row-name'), p.name);
        setTitle(q(node, '.ix-row-name'), p.name);
        setText(q(node, '.ix-row-val'), `${p.b.calls} · ${fmtTok(tok(p.b))} tok · ${money(p.b.cost)}`);
      },
    });
  }

  private paintUsage(): void {
    for (const b of this.range) setClass(b, 'is-on', Number(b.dataset.days) === this.days);
    const s = this.summary;
    if (!s) {
      setText(this.total, '');
      patchList(this.bars, [], { key: () => '', create: () => el('<i></i>'), update: () => undefined });
      this.rows(this.models, []);
      this.rows(this.groups, []);
      return;
    }
    const tt = s.total;
    setText(this.total, `${tn(tt.calls, '{n} call', '{n} calls')} · ${fmtTok(tok(tt))} tok · ${money(tt.cost)}`);
    const days = Object.keys(s.by_day).sort();
    const max = Math.max(1, ...days.map((d) => tok(s.by_day[d])));
    patchList(this.bars, days.map((d) => ({ d, v: tok(s.by_day[d]) })), {
      key: (x) => x.d,
      create: () => el<HTMLElement>('<i class="ix-bar-col"></i>'),
      update: (node, x) => {
        setStyleVar(node, '--h', `${Math.max(4, Math.round((x.v / max) * 100))}%`);
        setTitle(node, `${x.d}: ${fmtTok(x.v)} tok`);
      },
    });
    this.rows(this.models, this.pairs(s.by_model));
    this.rows(this.groups, this.pairs(s.by_scope));
  }

  private paintChanges(): void {
    const inScope = this.scope !== '';
    setHidden(this.back, !inScope);
    setText(q(this.back.parentElement as HTMLElement, '.ix-changes-title'), inScope ? (this.scopes.find((x) => x.id === this.scope)?.label || this.scope) : t('Changes by turn'));
    setHidden(this.scopeList, inScope);
    setHidden(this.noScopes, inScope || this.scopes.length > 0);
    setHidden(this.fileList, !inScope);
    setHidden(this.noFiles, !inScope || this.changes.length > 0);
    patchList(this.scopeList, this.scopes, {
      key: (s) => s.id,
      create: () => el<HTMLElement>('<button type="button" class="ix-scope"><span class="ix-scope-name"></span><span class="ix-scope-meta"></span></button>'),
      update: (node, s) => {
        setText(q(node, '.ix-scope-name'), s.label || s.id);
        setText(q(node, '.ix-scope-meta'), `${tn(s.files, '{n} file', '{n} files')} · ${when(s.last)}`);
      },
    });
    patchList(this.fileList, this.changes, {
      key: (c) => c.path,
      create: () => el<HTMLElement>(`<div class="ix-file" tabindex="0"><span class="ix-file-k"></span><span class="ix-file-name"></span><button type="button" class="cv-btn ix-revert">${t('Revert')}</button></div>`),
      update: (node, c) => {
        node.dataset.kind = c.status;
        setText(q(node, '.ix-file-k'), c.status === 'added' ? 'A' : c.status === 'deleted' ? 'D' : c.status === 'modified' ? 'M' : '-');
        setText(q(node, '.ix-file-name'), c.path);
        setTitle(node, `${c.path} (${c.status})`);
        setClass(node, 'is-on', c.path === this.file);
      },
    });
  }
}
