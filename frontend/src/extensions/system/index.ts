import { ApiError, request, systemStatus, type SystemStatus } from '../../io/api';
import { owner } from '../../io/window-token';
import { Dialog } from '../../ui/dialogs';
import { el, q, setDisabled, setText } from '../../ui/dom';
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

class SystemDialog extends Dialog {
  private readonly values = new Map<string, HTMLElement>();
  private readonly exportBtn: HTMLButtonElement;
  private readonly importBtn: HTMLButtonElement;
  private readonly file = el<HTMLInputElement>('<input type="file" accept="application/json,.json" hidden>');
  private run = 0;

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
      const r = await owner<{ written: number }>('/api/harness/import', { method: 'POST', body: JSON.stringify({ harness }) });
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
