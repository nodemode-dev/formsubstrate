import { compact, FORMSLOT_OPEN, formslotState, type FormslotPhase } from '../io/formslot';
import { sessionsClient } from '../io/sessions';
import { q, setClass, setText, setTitle } from './dom';
import { workspace } from './workspace-store';
import { onLanguage, t } from './i18n';

const LABEL: Record<FormslotPhase, string> = {
  unknown: 'formslot',
  unreachable: 'formslot offline',
  missing: 'formslot not installed',
  off: 'formslot off',
  starting: 'formslot starting',
  running: 'formslot running',
};

export class FormslotStatusItem {
  private readonly label: HTMLElement;
  private frame = 0;

  constructor(private readonly button: HTMLElement, private readonly saved: HTMLElement) {
    this.label = q(button, '.cv-st-fs-t');
    button.addEventListener('click', () => { window.dispatchEvent(new CustomEvent(FORMSLOT_OPEN)); });
    formslotState.on('status', () => this.schedule());
    formslotState.on('active', () => this.schedule());
    sessionsClient.on('sessions', () => this.schedule());
    workspace.on('workspace', () => this.schedule());
    onLanguage(() => this.schedule());
    this.paint();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  private paint(): void {
    const on = formslotState.isEnabled;
    const phase: FormslotPhase = formslotState.phase;
    const s = formslotState.status;
    const key = on ? phase : 'off';
    if (this.button.dataset.phase !== key) this.button.dataset.phase = key;
    setText(this.label, on ? t(LABEL[phase]) : t('formslot disabled'));
    const tip: string[] = [];
    if (!on) tip.push(t('formslot is turned off in Preferences.'));
    else if (s) {
      if (s.running) tip.push(`${t('Version')} ${s.version ?? '?'}${s.port ? ` · ${t('port')} ${s.port}` : ''}${s.pid ? ` · pid ${s.pid}` : ''}`);
      tip.push(`${s.corpora.length} ${t(s.corpora.length === 1 ? 'corpus' : 'corpora')}${s.workspaceCorpus ? ` · ${s.workspaceCorpus}` : ''}`);
      if (workspace.workspace && s.installed && !s.workspaceCorpus) tip.push(t('This workspace is not indexed, so no gates run here. Open the panel and choose Index this workspace.'));
      if (s.note) tip.push(s.note);
    } else if (formslotState.problem) tip.push(formslotState.problem);
    tip.push(t('Open the formslot panel'));
    setTitle(this.button, tip.join('\n'));

    const showSaved = on && (phase === 'running' || phase === 'off' || phase === 'starting');
    setClass(this.saved, 'is-idle', !showSaved);
    const total = sessionsClient.tokensSavedTotal();
    const id = formslotState.activeSession;
    const mine = id ? sessionsClient.get(id)?.tokensSaved ?? 0 : null;
    setClass(this.saved, 'is-zero', total === 0 && !mine);
    setText(this.saved, showSaved ? (mine === null ? `${t('Saved')} ${compact(total)}` : `${t('Saved')} ${compact(mine)} / ${compact(total)}`) : '');
    setTitle(this.saved, showSaved ? `${t('Tokens not spent because an agent reused a slot instead of writing the code again.')}\n${mine === null ? '' : `${t('This session')}: ${mine.toLocaleString()}\n`}${t('All sessions')}: ${total.toLocaleString()}` : '');
  }
}
