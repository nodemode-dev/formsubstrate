import { compact, formslot, type FormslotOnboard } from '../io/formslot';
import { sessionsClient } from '../io/sessions';
import { listTerminals, openOwnedTerminal } from '../io/terminals';
import type { Commands } from './commands';
import { el, q, setClass, setDisabled, setHidden, setText, setTitle, setValue } from './dom';
import { onLanguage, t } from './i18n';
import { icon } from './icons';
import { FORMSLOT_PATH_EVENT, loadPrefs } from './prefs';
import { toast } from './toast';
import type { WorkspaceStore } from './workspace-store';

export type OnboardState = 'loading' | 'missing' | 'setup' | 'add' | 'ready';

export interface HomeFormslotDeps {
  openTerminal?: (id: string) => void;
}

const WATCH_MS = 3000;
const WATCH_LIMIT_MS = 10 * 60 * 1000;
const windows = /win/i.test(navigator.platform);

const PLAIN = /^[\p{L}\p{N} _.\-/:@+,=~#()[\]{}]+$/u;
const PLAIN_WIN = /^[\p{L}\p{N} _.\-/\\:@+,=~#()[\]{}]+$/u;
const SAFE = { test: (p: string): boolean => (windows ? PLAIN_WIN.test(p) && !p.endsWith('\\') : PLAIN.test(p)) };

export function stateOf(s: FormslotOnboard | null): OnboardState {
  if (!s) return 'loading';
  if (!s.binary) return 'missing';
  if (!s.dataFolderExists || (!s.running && s.corpora.length === 0)) return 'setup';
  if (s.workspace && (!s.indexed || !s.connected)) return 'add';
  return 'ready';
}

export class HomeFormslot {
  readonly root = el(`<section class="cv-home-section cv-hfs" data-state="loading" aria-labelledby="cv-hfs-h">
    <div class="cv-home-section-head"><h2 class="cv-home-section-title" id="cv-hfs-h">formslot</h2></div>
    <div class="cv-hfs-card" role="group" aria-labelledby="cv-hfs-t" aria-describedby="cv-hfs-s">
      <span class="cv-hfs-icon">${icon('slot', 20)}</span>
      <div class="cv-hfs-text">
        <div class="cv-hfs-title" id="cv-hfs-t"></div>
        <div class="cv-hfs-sub" id="cv-hfs-s"></div>
        <form class="cv-hfs-field" hidden aria-label="${t('formslot folder')}"><input class="cv-hfs-input" type="text" readonly spellcheck="false" autocomplete="off" placeholder="${t('Path to a formslot checkout or binary')}" aria-label="${t('Path to a formslot checkout or binary')}"><button class="cv-btn" type="submit" aria-label="${t('Open Preferences to choose the formslot folder')}">${t('Preferences')}</button></form>
        <div class="cv-hfs-note"></div>
      </div>
      <div class="cv-hfs-actions"><button class="cv-home-action is-primary cv-hfs-go" type="button" hidden>${icon('terminal', 16)}<span class="cv-home-label"></span></button></div>
    </div>
  </section>`);
  private readonly title = q(this.root, '.cv-hfs-title');
  private readonly sub = q(this.root, '.cv-hfs-sub');
  private readonly note = q(this.root, '.cv-hfs-note');
  private readonly field = q<HTMLFormElement>(this.root, '.cv-hfs-field');
  private readonly input = q<HTMLInputElement>(this.root, '.cv-hfs-input');
  private readonly go = q<HTMLButtonElement>(this.root, '.cv-hfs-go');
  private readonly goLabel = q(this.go, '.cv-home-label');
  private status: FormslotOnboard | null = null;
  private state: OnboardState = 'loading';
  private inflight: Promise<void> | null = null;
  private watching = 0;
  private busy = false;
  private frame = 0;

  constructor(private readonly store: WorkspaceStore, _commands: Commands, _d: HomeFormslotDeps) {
    this.field.addEventListener('submit', (e) => {
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('subform:open-settings', { detail: { section: 'formslot' } }));
    });
    document.addEventListener(FORMSLOT_PATH_EVENT, () => this.schedule());
    this.go.addEventListener('click', () => { void this.launch(); });
    window.addEventListener('focus', () => { if (!this.root.closest('[hidden]')) void this.refresh(); });
    sessionsClient.on('sessions', () => this.schedule());
    onLanguage(() => this.schedule());
    this.paint();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = formslot.onboard().then((s) => { this.status = s; }, () => undefined).then(() => {
      this.inflight = null;
      this.paint();
    });
    return this.inflight;
  }

  private checkout(): string {
    const p = loadPrefs().formslotPath.trim();
    return windows ? p.replace(/[\\/]+$/, '') : p.replace(/\/+$/, '');
  }

  private command(): { text: string; argv: string[] } | null {
    const s = this.status;
    const ws = this.store.workspace?.path ?? '';
    const bin = s?.binary ?? '';
    const quote = (p: string): string => (p.includes(' ') ? `"${p}"` : p);
    const build = (argv: string[]): { text: string; argv: string[] } => ({ text: argv.map(quote).join(' '), argv });
    if (this.state === 'missing') {
      const dir = this.checkout();
      if (!dir || !SAFE.test(dir)) return null;
      return build([`${dir}${windows ? '\\formslot_oc_install.bat' : '/formslot_oc_install'}`]);
    }
    if (!bin || !SAFE.test(bin)) return null;
    if (this.state === 'setup') return build([bin, 'setup']);
    if (this.state === 'add' && ws && SAFE.test(ws)) return build([bin, 'setup', '--yes', '--repo', ws, '--no-path']);
    return null;
  }

  private async launch(): Promise<void> {
    const cmd = this.command();
    if (!cmd || this.busy) return;
    this.busy = true;
    this.paint();
    try {
      const id = await openOwnedTerminal({ argv: cmd.argv, title: 'formslot' });
      if (id) this.watch(id);
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t('Could not start the terminal'), 'error');
    } finally {
      this.busy = false;
      this.paint();
    }
  }

  private watch(id: string): void {
    window.clearInterval(this.watching);
    const began = Date.now();
    const tick = async (): Promise<void> => {
      let alive = false;
      try { alive = (await listTerminals()).some((x) => x.id === id && x.alive); } catch { alive = false; }
      await this.refresh();
      if (!alive || Date.now() - began > WATCH_LIMIT_MS) window.clearInterval(this.watching);
    };
    this.watching = window.setInterval(() => { void tick(); }, WATCH_MS);
  }

  private paint(): void {
    const s = this.status;
    this.state = stateOf(s);
    const st = this.state;
    if (this.root.dataset.state !== st) this.root.dataset.state = st;
    const ws = this.store.workspace;
    const cmd = this.command();
    let title = '';
    let sub = '';
    let label = '';
    let note = '';
    if (st === 'loading') {
      title = t('Checking formslot');
    } else if (st === 'missing') {
      title = t('formslot is not installed');
      sub = t('formslot remembers the code your repositories already have, so Claude Code reuses it instead of writing it again.');
      label = t('Install formslot');
      note = this.checkout() ? (cmd ? cmd.text : t('That path cannot be used in a terminal command.')) : t('Download formslot, then choose the folder you unpacked it into in Preferences.');
    } else if (st === 'setup') {
      title = t('formslot is installed, not set up');
      sub = t('Setup walks through six short steps: it checks this computer, starts the service and connects your projects.');
      label = t('Set up formslot');
      note = cmd ? cmd.text : t('That path cannot be used in a terminal command.');
    } else if (st === 'add') {
      title = t('formslot is set up. This project is not added yet.');
      sub = ws ? ws.name : '';
      label = t('Add this project');
      note = cmd ? cmd.text : t('That path cannot be used in a terminal command.');
    } else if (s) {
      const n = s.corpora.length;
      const saved = sessionsClient.tokensSavedTotal();
      title = t('formslot is ready');
      sub = [s.running ? t('Service running') : t('Service stopped'), `${n} ${t(n === 1 ? 'project' : 'projects')}`, saved > 0 ? `${compact(saved)} ${t('tokens saved')}` : ''].filter(Boolean).join(' · ');
      note = s.version ? `formslot ${s.version}` : '';
    }
    setText(this.title, title);
    setText(this.sub, sub);
    setText(this.goLabel, label);
    const show = st === 'missing' || st === 'setup' || st === 'add';
    setHidden(this.go, !show);
    setHidden(this.field, st !== 'missing');
    setValue(this.input, loadPrefs().formslotPath);
    setDisabled(this.go, !show || !cmd);
    const busy = String(this.busy);
    if (this.go.getAttribute('aria-disabled') !== busy) this.go.setAttribute('aria-disabled', busy);
    const folder = t('Path to a formslot checkout or binary');
    if (this.input.getAttribute('aria-label') !== folder) { this.input.setAttribute('aria-label', folder); this.input.placeholder = folder; }
    const prefs = q<HTMLButtonElement>(this.field, 'button');
    const prefsName = t('Open Preferences to choose the formslot folder');
    if (prefs.getAttribute('aria-label') !== prefsName) prefs.setAttribute('aria-label', prefsName);
    setText(prefs, t('Preferences'));
    const fieldName = t('formslot folder');
    if (this.field.getAttribute('aria-label') !== fieldName) this.field.setAttribute('aria-label', fieldName);
    setText(this.note, note);
    setTitle(this.go, cmd ? cmd.text : '');
    setClass(this.root, 'is-busy', this.busy);
  }
}
