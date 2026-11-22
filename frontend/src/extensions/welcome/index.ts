import { systemStatus } from '../../io/api';
import { secretStatus, secretStatusText } from '../../io/secrets';
import { Dialog } from '../../ui/dialogs';
import { el, q, setText } from '../../ui/dom';
import { t } from '../../ui/i18n';
import { register, type ExtensionContext } from '../registry';

const FLAG = 'formsubstrate.welcomed.v1';
const KEY_NAME = 'anthropic-api-key';
const SHOW_DELAY_MS = 900;

type Check = 'engine' | 'git' | 'claude' | 'key' | 'workspace';

const STEPS: ReadonlyArray<{ id: Check; title: string; hint: string }> = [
  { id: 'engine', title: 'Engine', hint: 'The local engine answers this computer only.' },
  { id: 'git', title: 'git', hint: 'Needed for worktrees, review and commits. Install it from git-scm.com if it is missing.' },
  { id: 'claude', title: 'Claude Code', hint: 'Sessions run the claude command found on this system. Install it, then reopen this page.' },
  { id: 'key', title: 'Anthropic API key', hint: 'Optional. Headless sessions can use a key kept in the system keychain, or in a file only you can read where there is no keychain; set it in Preferences. Not checked yet means Substrate has not looked in the keychain since an update; saving the key again settles it.' },
  { id: 'workspace', title: 'Workspace', hint: 'Open a folder or a Form repository to begin.' },
];

const seen = (): boolean => { try { return localStorage.getItem(FLAG) === '1'; } catch { return true; } };
const markSeen = (): void => { try { localStorage.setItem(FLAG, '1'); } catch { return; } };

class WelcomeDialog extends Dialog {
  private readonly rows = new Map<Check, HTMLElement>();
  private run = 0;

  constructor(private readonly ctx: ExtensionContext) {
    super('Welcome to Substrate', 500);
    this.body.appendChild(el(`<p class="cv-note">${t('Substrate is the Form family code and text editor. A quick check of what is ready on this computer:')}</p>`));
    for (const s of STEPS) {
      const row = el(`<div class="cv-dialog-row"><span></span><span class="cv-note"></span></div>`);
      setText(q(row, 'span'), s.title);
      row.title = t(s.hint);
      this.rows.set(s.id, row);
      this.body.appendChild(row);
    }
    this.button('Preferences', 'ghost', () => { this.close(); document.dispatchEvent(new CustomEvent('formsubstrate:open-settings')); });
    this.button('Open folder', '', () => { this.close(); ctx.commands.run('open-folder'); });
    this.button('Start', 'primary', () => this.close());
    this.onClose = markSeen;
  }

  private put(id: Check, ok: boolean | null, text: string): void {
    const row = this.rows.get(id);
    if (!row) return;
    setText(q(row, '.cv-note'), ok === null ? text : `${t(ok ? 'Ready' : 'Missing')}: ${text}`);
  }

  show(): void {
    this.open();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const run = ++this.run;
    this.put('workspace', null, this.ctx.store.workspace?.path ?? t('None open'));
    try {
      const s = await systemStatus();
      if (run !== this.run) return;
      this.put('engine', true, `${s.app} ${s.version}`);
      this.put('git', typeof s.git === 'string', typeof s.git === 'string' ? s.git : t('Not found'));
      this.put('claude', typeof s.claude === 'string', typeof s.claude === 'string' ? s.claude : t('Not found'));
    } catch {
      if (run !== this.run) return;
      this.put('engine', false, t('Engine offline'));
    }
    try {
      const status = await secretStatus(KEY_NAME);
      if (run === this.run) this.put('key', null, t(secretStatusText(status)));
    } catch {
      if (run === this.run) this.put('key', null, t('Not set'));
    }
  }
}

register({
  id: 'welcome',
  name: 'Welcome',
  description: 'First-run readiness check for the engine, git, Claude Code and the workspace',
  setup(ctx) {
    let dlg: WelcomeDialog | null = null;
    const show = (): void => { dlg ??= new WelcomeDialog(ctx); dlg.show(); };
    ctx.commands.add({ id: 'welcome', label: 'Welcome', group: 'Help', run: show });
    if (!seen() && !ctx.store.workspace) setTimeout(() => { if (!seen() && !ctx.store.workspace) show(); }, SHOW_DELAY_MS);
  },
});
