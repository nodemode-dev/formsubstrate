import { AGENT_MODES, AGENT_PROGRAMS, agents, type AgentInfo, type AgentProgram } from '../io/agents';
import type { NewSessionBody, Session, SessionMode } from '../io/sessions';
import { detailOf } from '../io/workspace';
import { Dialog } from './dialogs';
import { el, q, setClass, setDisabled, setText, setTitle } from './dom';
import { enhanceSelect } from './dropdown';
import { t } from './i18n';
import { PERMISSION_MODES, PERMISSION_MODE_NOTES, loadPrefs, type AgentPermissionMode } from './prefs';

const AGENT_NOTES: Record<AgentProgram, string> = {
  claude: 'Claude Code gets the session MCP servers and the gate cards.',
  codex: 'Codex gets the session MCP servers. Gate cards need Claude Code, so its writes are not gated.',
  cursor: 'Cursor is started plainly in the worktree: it does not get the session MCP servers, and gate cards need Claude Code.',
  antigravity: 'Antigravity is started plainly in the worktree: it does not get the session MCP servers, and gate cards need Claude Code.',
};

const AGENT_MODE_NOTES: Record<Exclude<AgentProgram, 'claude'>, Partial<Record<AgentPermissionMode, string>>> = {
  codex: {
    acceptEdits: 'Codex may write inside the worktree (its workspace-write sandbox).',
    default: 'Codex runs with its own default, a read-only sandbox.',
    plan: 'Codex runs in its read-only sandbox; nothing is changed.',
  },
  cursor: {
    default: 'Cursor proposes changes and does not apply them. It has no mode that accepts edits only.',
    plan: 'Cursor plans and reads only; nothing is changed.',
  },
  antigravity: {
    acceptEdits: 'Antigravity runs in its accept-edits mode.',
    plan: 'Antigravity runs in its plan mode; nothing is changed.',
  },
};

export class NewSessionDialog extends Dialog {
  private readonly agentRows = new Map<AgentProgram, { row: HTMLElement; radio: HTMLInputElement; info: HTMLElement }>();
  private readonly agentNote = el('<p class="cv-note cv-ns-agentnote"></p>');
  private readonly name = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" maxlength="120" data-f="title">');
  private readonly mode = el<HTMLSelectElement>('<select class="cv-input" data-f="mode"></select>');
  private readonly prompt = el<HTMLTextAreaElement>('<textarea class="cv-input cv-ns-prompt" rows="4" spellcheck="false" data-f="prompt"></textarea>');
  private readonly base = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" data-f="base">');
  private readonly perm = el<HTMLSelectElement>('<select class="cv-input" data-f="permissionMode"></select>');
  private readonly permNote = el('<p class="cv-note cv-ns-permnote"></p>');
  private readonly permRow: HTMLElement;
  private readonly promptRow: HTMLElement;
  private readonly problem = el('<p class="cv-note cv-ns-problem"></p>');
  private readonly create: HTMLButtonElement;
  private busy = false;

  constructor(private readonly submit: (body: NewSessionBody) => Promise<Session>, private readonly done: (s: Session) => void, private readonly warm: () => void) {
    super('New Agent Session', 460);
    const agentField = el('<div class="cv-field cv-ns-agentfield"><span></span><div class="cv-ns-agents" role="radiogroup"></div></div>');
    setText(q(agentField, 'span'), 'Agent');
    const group = q(agentField, '.cv-ns-agents');
    group.setAttribute('aria-label', t('Agent'));
    for (const [program, title] of AGENT_PROGRAMS) {
      const row = el(`<label class="cv-ns-agent"><input type="radio" name="cv-ns-agent"><span class="cv-ns-agent-name" data-no-i18n></span><span class="cv-ns-agent-info" data-no-i18n></span></label>`);
      const radio = q<HTMLInputElement>(row, 'input');
      radio.value = program;
      radio.checked = program === 'claude';
      radio.disabled = program !== 'claude';
      setText(q(row, '.cv-ns-agent-name'), title);
      radio.addEventListener('change', () => this.sync());
      this.agentRows.set(program, { row, radio, info: q(row, '.cv-ns-agent-info') });
      group.append(row);
    }
    this.body.append(agentField, this.agentNote);
    for (const [value, label] of [['interactive', 'Interactive: the agent in a terminal'], ['headless', 'Headless: run a prompt and stream']] as const) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = t(label);
      this.mode.append(o);
    }
    this.name.placeholder = t('What this agent works on');
    this.prompt.placeholder = t('What the agent should do');
    this.base.placeholder = t('HEAD (the current commit)');
    this.field('Title', this.name);
    this.field('Mode', this.mode);
    enhanceSelect(this.mode);
    this.promptRow = this.field('Prompt', this.prompt);
    for (const [value, label] of PERMISSION_MODES) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = t(label);
      this.perm.append(o);
    }
    this.permRow = this.field('Permission mode', this.perm);
    enhanceSelect(this.perm);
    this.body.append(this.permNote);
    this.field('Base branch', this.base);
    this.body.append(this.problem);
    this.perm.addEventListener('change', () => this.sync());
    this.button('Cancel', 'ghost', () => this.close());
    this.create = this.button('Start session', 'primary', () => { void this.send(); });
    this.mode.addEventListener('change', () => this.sync());
    this.name.addEventListener('input', () => this.sync());
    this.prompt.addEventListener('input', () => this.sync());
    this.name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !this.create.disabled) { e.preventDefault(); void this.send(); } });
    this.sync();
  }

  show(base = ''): void {
    if (this.isOpen) return;
    this.name.value = '';
    this.prompt.value = '';
    this.base.value = base;
    this.mode.value = 'interactive';
    this.perm.value = loadPrefs().agentPermissionMode;
    setText(this.problem, '');
    this.paintAgents(agents.cached());
    this.sync();
    this.open(this.name);
    void agents.list().then((list) => { this.paintAgents(list); this.sync(); }).catch(() => { this.paintAgents([]); this.sync(); });
  }

  private get agentValue(): AgentProgram {
    for (const [program, parts] of this.agentRows) if (parts.radio.checked && !parts.radio.disabled) return program;
    return 'claude';
  }

  private paintAgents(list: readonly AgentInfo[]): void {
    for (const [program, parts] of this.agentRows) {
      const info = list.find((a) => a.program === program);
      const found = !!info?.path;
      const text = !info ? t('Looking for it') : found ? [info.path, info.version, info.finding === 'broken' ? `${t('does not start')}: ${info.error}` : ''].filter(Boolean).join('  ') : `${t('Not found. Install it with:')} ${info.install}`;
      setText(parts.info, text);
      setTitle(parts.info, text);
      setClass(parts.row, 'is-off', !!info && !found);
      const off = info ? !found : program !== 'claude';
      if (parts.radio.disabled !== off) parts.radio.disabled = off;
      if (off && parts.radio.checked) { parts.radio.checked = false; const first = this.agentRows.get('claude'); if (first) first.radio.checked = true; }
    }
  }

  get modeValue(): SessionMode { return this.mode.value === 'headless' ? 'headless' : 'interactive'; }

  private get permValue(): AgentPermissionMode {
    const v = this.perm.value;
    return v === 'default' || v === 'plan' ? v : 'acceptEdits';
  }

  private sync(): void {
    const headless = this.modeValue === 'headless';
    const program = this.agentValue, modes = AGENT_MODES[program];
    for (const o of Array.from(this.perm.options)) { const hide = !modes.includes(o.value as AgentPermissionMode); if (o.hidden !== hide) o.hidden = hide; }
    const want = modes.includes(this.permValue) ? this.permValue : modes[0];
    if (this.perm.value !== want) this.perm.value = want;
    setText(this.agentNote, t(AGENT_NOTES[program]));
    this.prompt.disabled = !headless;
    setClass(this.promptRow, 'is-off', !headless);
    this.perm.disabled = !headless;
    setClass(this.permRow, 'is-off', !headless);
    setClass(this.permNote, 'is-off', !headless);
    const modeNote = program === 'claude' ? PERMISSION_MODE_NOTES[this.permValue] : AGENT_MODE_NOTES[program][this.permValue] ?? '';
    setText(this.permNote, t(headless ? modeNote : 'Interactive sessions ask in the terminal.'));
    const ready = this.name.value.trim().length > 0 && (!headless || this.prompt.value.trim().length > 0) && !this.busy;
    setDisabled(this.create, !ready);
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    const mode = this.modeValue;
    const body: NewSessionBody = { title: this.name.value.trim(), mode, agent: this.agentValue };
    if (mode === 'headless') { body.prompt = this.prompt.value.trim(); body.permissionMode = this.permValue; }
    const base = this.base.value.trim();
    if (base) body.base = base;
    this.busy = true;
    this.sync();
    this.warm();
    setText(this.problem, '');
    try {
      const s = await this.submit(body);
      this.close();
      this.done(s);
    } catch (err) {
      setText(this.problem, detailOf(err));
    } finally {
      this.busy = false;
      this.sync();
    }
  }
}

