import { mountOnce, pendingClass, q, setClass, setHidden, setStyleVar, setText, setTitle, type Disposer } from './dom';
import { onLanguage, t } from './i18n';
import { icon } from './icons';
import { JobsList } from './jobs-list';
import { FormslotStatusItem } from './status-formslot';
import type { WorkspaceStore } from './workspace-store';

export const SERVICE_NOTE = 'The engine service is not running, so these wait for it: reading files, git, Claude Code sessions, the terminal and formslot.';

const ERROR_MS = 6000;

export class StatusBar {
  private readonly branch: HTMLElement;
  private readonly branchName: HTMLElement;
  private readonly branchSync: HTMLElement;
  private readonly wsName: HTMLElement;
  private readonly problems: HTMLElement;
  private readonly lsp: HTMLElement;
  private readonly lspText: HTMLElement;
  private readonly lspErrors: HTMLElement;
  private readonly lspWarnings: HTMLElement;
  private readonly engineState: HTMLElement;
  private readonly formslot: HTMLElement;
  private readonly sessions: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly busy: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly steps: HTMLElement;
  private readonly busyText: Text;
  private readonly stepsText = document.createTextNode('');
  private readonly jobs: JobsList;
  private dismiss: Disposer | null = null;
  private engineRaw = '';
  private baseHint = '';
  private errText = '';
  private errTimer = 0;

  constructor(root: HTMLElement, private readonly store: WorkspaceStore) {
    mountOnce(root,
      `<span class="cv-st-branch" role="button" tabindex="0" aria-haspopup="menu" hidden>${icon('branch', 12)}<span class="cv-st-branch-name"></span><span class="cv-st-sync"></span></span>` +
      '<span class="cv-st-ws" hidden></span>' +
      '<span class="cv-st-problems" hidden></span>' +
      `<button class="cv-st-lsp is-idle" type="button" tabindex="-1"><span class="cv-st-lsp-text"></span><span class="cv-st-lsp-e">${icon('error', 12)}<b>0</b></span><span class="cv-st-lsp-w">${icon('warning', 12)}<b>0</b></span></button>` +
      '<span class="cv-st-engine"></span>' +
      `<button class="cv-st-formslot" type="button"><span class="cv-st-fs-dot"></span><span class="cv-st-fs-t"></span></button>` +
      '<span class="cv-st-saved"></span>' +
      '<span class="cv-st-sessions" hidden></span>' +
      '<span class="cv-st-hint"></span>' +
      `<span class="cv-st-busy">${icon('loading', 12)}</span>`);
    this.branch = q(root, '.cv-st-branch');
    this.branchName = q(root, '.cv-st-branch-name');
    this.branchSync = q(root, '.cv-st-sync');
    this.wsName = q(root, '.cv-st-ws');
    this.problems = q(root, '.cv-st-problems');
    this.lsp = q(root, '.cv-st-lsp');
    this.lspText = q(root, '.cv-st-lsp-text');
    this.lspErrors = q(root, '.cv-st-lsp-e b');
    this.lspWarnings = q(root, '.cv-st-lsp-w b');
    this.engineState = q(root, '.cv-st-engine');
    this.formslot = q(root, '.cv-st-formslot');
    this.sessions = q(root, '.cv-st-sessions');
    new FormslotStatusItem(this.formslot, q(root, '.cv-st-saved'));
    this.hint = q(root, '.cv-st-hint');
    this.busy = q(root, '.cv-st-busy');
    this.busyText = document.createTextNode(t('Working'));
    this.busy.appendChild(this.busyText);
    this.bar = document.createElement('span');
    this.bar.className = 'cv-st-bar';
    this.bar.setAttribute('role', 'progressbar');
    this.bar.setAttribute('aria-valuemin', '0');
    this.bar.setAttribute('aria-valuemax', '100');
    this.bar.appendChild(document.createElement('i'));
    this.steps = document.createElement('span');
    this.steps.className = 'cv-st-steps';
    this.steps.appendChild(this.stepsText);
    this.busy.append(this.bar, this.steps);
    this.jobs = new JobsList(store, root);
    setTitle(this.busy, t('Show the running jobs, each with its own Stop'));
    this.busy.addEventListener('click', () => this.jobs.toggle());
    this.lsp.addEventListener('click', () => window.dispatchEvent(new Event('formsubstrate:lsp-servers')));
    window.addEventListener('formsubstrate:lsp-status', (e) => this.syncLsp((e as CustomEvent<{ text: string; title: string; state: string; errors: number; warnings: number }>).detail));
    store.on('workspace', () => this.syncWorkspace());
    window.addEventListener('formsubstrate:git-sync', (e) => this.syncGit((e as CustomEvent<{ ahead: number; behind: number; upstream: string }>).detail));
    store.on('sessions', () => this.syncSessions());
    store.on('jobs', () => this.syncJobs());
    store.on('active', () => this.syncActive());
    store.on('docs', () => this.syncActive());
    this.syncWorkspace();
    this.syncSessions();
    this.syncActive();
    onLanguage(() => {
      this.busyText.data = t('Working');
      setTitle(this.busy, t('Show the running jobs, each with its own Stop'));
      this.showEngine();
      this.syncSessions();
    });
  }

  toggleJobs(): void { this.jobs.toggle(); }
  get jobsOpen(): boolean { return this.jobs.isOpen; }

  setEngine(text: string): void { this.engineRaw = text; this.showEngine(); }

  setProblems(count: number | null): void {
    setHidden(this.problems, count === null);
    setText(this.problems, count === null ? '' : `${count} ${t(count === 1 ? 'problem' : 'problems')}`);
  }

  setHint(text: string): void {
    this.baseHint = text;
    this.syncHint();
  }

  flashError(text: string): void {
    this.errText = text;
    this.syncHint();
    window.clearTimeout(this.errTimer);
    this.errTimer = window.setTimeout(() => { this.errText = ''; this.syncHint(); }, ERROR_MS);
  }

  private showEngine(): void {
    const raw = this.engineRaw, m = /^Engine (\d\S*)( · desktop)?$/.exec(raw);
    setText(this.engineState, m ? `${t('Engine')} ${m[1]}${m[2] ? ` · ${t('desktop')}` : ''}` : t(raw));
    setTitle(this.engineState, raw === 'Engine offline' ? t(SERVICE_NOTE) : '');
  }

  private syncLsp(d: { text: string; title: string; state: string; errors: number; warnings: number }): void {
    for (const s of ['idle', 'starting', 'ready', 'unavailable', 'stopped']) setClass(this.lsp, `is-${s}`, s === d.state);
    setText(this.lspText, d.text);
    setText(this.lspErrors, String(d.errors));
    setText(this.lspWarnings, String(d.warnings));
    setTitle(this.lsp, d.title || d.text);
    this.lsp.tabIndex = d.state === 'idle' ? -1 : 0;
  }

  private syncWorkspace(): void {
    const ws = this.store.workspace;
    setHidden(this.wsName, !ws);
    setText(this.wsName, ws?.name ?? '');
    setTitle(this.wsName, ws?.path ?? '');
    const branch = ws?.branch ?? '';
    setHidden(this.branch, !branch);
    setText(this.branchName, branch);
  }

  private syncGit(d: { ahead: number; behind: number; upstream: string }): void {
    setText(this.branchSync, d.upstream ? `↑${d.ahead} ↓${d.behind}` : '');
    setTitle(this.branchSync, d.upstream ? `${d.upstream}: ${d.ahead} ${t('ahead')}, ${d.behind} ${t('behind')}` : '');
  }

  private syncSessions(): void {
    const s = this.store.sessions, on = s.working > 0 || s.needsInput > 0;
    setHidden(this.sessions, !on);
    setClass(this.sessions, 'is-attention', s.needsInput > 0);
    const text = [`${s.working} ${t('working')}`, s.needsInput > 0 ? `${s.needsInput} ${t('need input')}` : ''].filter(Boolean).join(' · ');
    setText(this.sessions, on ? text : '');
  }

  private syncActive(): void {
    this.setHint(this.store.active?.path ?? '');
  }

  private syncHint(): void {
    setClass(this.hint, 'is-error', !!this.errText);
    const text = this.errText || this.baseHint;
    setText(this.hint, text);
    setTitle(this.hint, text);
  }

  private syncJobs(): void {
    const all = this.store.jobs, active = all.filter((j) => !j.done);
    if (active.length) { if (!this.dismiss) this.dismiss = pendingClass(this.busy); }
    else { this.dismiss?.(); this.dismiss = null; }
    const total = all.length, finished = total - active.length;
    const sum = active.reduce((a, j) => a + Math.max(0, Math.min(1, j.progress)), 0);
    const pct = total ? Math.round(((finished + sum) / total) * 100) : 0;
    setStyleVar(this.bar, '--p', `${pct}%`);
    this.bar.setAttribute('aria-valuenow', String(pct));
    const lead = active[0];
    const part = total > 1 ? `${Math.min(finished + 1, total)} ${t('of')} ${total}` : '';
    const own = lead && lead.progress >= 0 ? `${Math.round(Math.min(1, lead.progress) * 100)}%` : '';
    const label = [part, own].filter(Boolean).join(' · ');
    if (this.stepsText.data !== label) this.stepsText.data = label;
    const names = active.map((j) => j.label).join(', ');
    const tip = t('Show the running jobs, each with its own Stop');
    setTitle(this.busy, names ? `${names}: ${tip}` : tip);
  }
}
