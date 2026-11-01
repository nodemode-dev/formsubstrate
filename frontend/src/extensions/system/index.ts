import { ApiError, request, systemStatus, type SystemStatus } from '../../io/api';
import { workspaceTrusted } from '../../io/trust';
import { owner } from '../../io/window-token';
import { Dialog } from '../../ui/dialogs';
import { el, patchList, q, setDisabled, setText } from '../../ui/dom';
import { t } from '../../ui/i18n';
import { toast } from '../../ui/toast';
import { register, type ExtensionContext } from '../registry';

interface Summary { present: boolean; files: number; groups: Record<string, number>; other: number; truncated: boolean }
interface Exported { harness: { version: number; files: Record<string, string> }; skipped: string[] }

const ROWS: ReadonlyArray<readonly [string, string]> = [
  ['version', 'Version'],
  ['engine', 'Engine'],
  ['data', 'Data folder'],
  ['git', 'git'],
  ['claude', 'Claude Code'],
  ['workspace', 'Workspace'],
  ['mcp', 'MCP endpoint'],
  ['harness', 'Harness files'],
];

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface ManifestEntry { path: string; group: string; bytes: number; action: 'write' | 'overwrite' | 'skip' | 'refuse'; reason: string }
interface Preview { entries: ManifestEntry[]; will_write: number }

class ManifestDialog extends Dialog {
  private readonly note = el('<p class="cv-note"></p>');
  private readonly list = el('<div class="cv-harness-list"></div>');
  private readonly go: HTMLButtonElement;
  private resolve: ((v: boolean) => void) | null = null;

  constructor() {
    super('Import harness', 560);
    this.body.append(this.note, this.list);
    this.button('Cancel', 'ghost', () => this.finish(false));
    this.go = this.button('Import', 'primary', () => this.finish(true));
    this.onClose = () => this.finish(false);
  }

  ask(p: Preview, trusted: boolean): Promise<boolean> {
    this.resolve?.(false);
    this.resolve = null;
    const refused = p.entries.filter((e) => e.action === 'refuse').length;
    const skipped = p.entries.filter((e) => e.action === 'skip').length;
    setText(this.note, `${p.will_write} ${t('files will be written')}, ${skipped} ${t('skipped')}, ${refused} ${t('refused')}${trusted ? '' : ` (${t('plugins need a trusted workspace')})`}. ${t('Imported graphs, recipes and skills can steer agents: read the list first.')}`);
    const fill = (n: HTMLElement, e: ManifestEntry): void => {
      setText(q(n, 'span'), t(e.action === 'overwrite' ? 'Overwrite' : e.action === 'write' ? 'New' : e.action === 'skip' ? 'Skip' : 'Refuse'));
      setText(q(n, '.cv-note'), `${e.path}${e.reason ? ` (${t(e.reason)})` : ''}`);
    };
    patchList(this.list, p.entries, {
      key: (e) => e.path,
      create: (e) => {
        const n = el('<div class="cv-dialog-row"><span></span><span class="cv-note"></span></div>');
        fill(n, e);
        return n;
      },
      update: fill,
    });
    setDisabled(this.go, p.will_write === 0);
    this.open(this.go);
    return new Promise<boolean>((resolve) => { this.resolve = resolve; });
  }

  private finish(v: boolean): void {
    const done = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    done?.(v);
  }
}

class SystemDialog extends Dialog {
  private readonly values = new Map<string, HTMLElement>();
  private readonly exportBtn: HTMLButtonElement;
  private readonly importBtn: HTMLButtonElement;
  private readonly file = el<HTMLInputElement>('<input type="file" accept="application/json,.json" hidden>');
  private run = 0;
  private manifest: ManifestDialog | null = null;

  constructor(private readonly ctx: ExtensionContext) {
    super('System', 480);
    for (const [key, label] of ROWS) {
      const row = el(`<div class="cv-dialog-row"><span></span><span class="cv-note"></span></div>`);
      setText(q(row, 'span'), label);
      this.values.set(key, q(row, '.cv-note'));
      this.body.appendChild(row);
    }
    this.body.appendChild(el(`<p class="cv-note">${t('The harness is the .subform folder of the workspace (graphs, recipes, skills, plugins, collections) as one JSON file you can share.')}</p>`));
    this.body.appendChild(this.file);
    this.button('Close', 'ghost', () => this.close());
    this.importBtn = this.button('Import harness', '', () => this.file.click());
    this.exportBtn = this.button('Export harness', 'primary', () => { void this.exportHarness(); });
    this.file.addEventListener('change', () => { void this.importHarness(); });
  }

  private put(key: string, text: string): void { setText(this.values.get(key) ?? null, text); }

  show(): void {
    this.open();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const run = ++this.run;
    const ws = this.ctx.store.workspace;
    this.put('workspace', ws?.path ?? t('None open'));
    this.put('mcp', `${location.origin}/mcp`);
    setDisabled(this.exportBtn, !ws);
    setDisabled(this.importBtn, !ws);
    let status: SystemStatus | null = null;
    let summary: Summary | null = null;
    try { status = await systemStatus(); } catch { status = null; }
    if (ws) { try { summary = await request<Summary>('/api/harness/summary'); } catch { summary = null; } }
    if (run !== this.run) return;
    this.put('version', status ? `${status.app} ${status.version}` : t('Engine offline'));
    this.put('engine', status?.engine ?? '');
    this.put('data', status?.data_dir ?? '');
    this.put('git', status ? (typeof status.git === 'string' ? status.git : t('Not found')) : '');
    this.put('claude', status ? (typeof status.claude === 'string' ? status.claude : t('Not found')) : '');
    this.put('harness', !ws ? '' : summary ? (summary.present ? `${summary.files}` : t('None yet')) : t('Unavailable'));
  }

  private async exportHarness(): Promise<void> {
    try {
      const data = await request<Exported>('/api/harness/export');
      const blob = new Blob([JSON.stringify(data.harness, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'subform-harness.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`${t('Harness exported')}: ${Object.keys(data.harness.files).length}${data.skipped.length ? `, ${data.skipped.length} ${t('skipped')}` : ''}`);
    } catch (e) {
      toast(`${t('The harness was not exported')}: ${message(e)}`, 'error');
    }
  }

  private async importHarness(): Promise<void> {
    const f = this.file.files?.[0];
    this.file.value = '';
    if (!f) return;
    try {
      const parsed: unknown = JSON.parse(await f.text());
      const harness = parsed && typeof parsed === 'object' && 'files' in parsed ? parsed : (parsed as { harness?: unknown }).harness;
      if (!harness || typeof harness !== 'object') throw new Error(t('Not a harness file'));
      const body = JSON.stringify({ harness });
      const trust = workspaceTrusted() ? '?trust=1' : '';
      const preview = await owner<Preview>(`/api/harness/preview${trust}`, { method: 'POST', body });
      this.manifest ??= new ManifestDialog();
      if (!(await this.manifest.ask(preview, !!trust))) return;
      const r = await owner<{ written: number }>(`/api/harness/import${trust}`, { method: 'POST', body });
      toast(`${t('Harness imported')}: ${r.written}`);
      window.dispatchEvent(new CustomEvent('subform:harness-imported'));
      void this.refresh();
    } catch (e) {
      toast(`${t('The harness was not imported')}: ${e instanceof ApiError ? e.message : message(e)}`, 'error');
    }
  }
}

register({
  id: 'system',
  name: 'System',
  description: 'Engine, git, Claude Code and workspace status, and harness export and import',
  setup(ctx) {
    let dlg: SystemDialog | null = null;
    ctx.commands.add({
      id: 'system-status',
      label: 'System status',
      group: 'Help',
      run: () => { dlg ??= new SystemDialog(ctx); dlg.show(); },
    });
  },
});
