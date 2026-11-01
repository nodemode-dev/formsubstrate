import type { NewSessionBody, Session, SessionMode } from '../io/sessions';
import { detailOf } from '../io/workspace';
import { Dialog } from './dialogs';
import { el, setClass, setDisabled, setText } from './dom';
import { enhanceSelect } from './dropdown';
import { t } from './i18n';

export class NewSessionDialog extends Dialog {
  private readonly name = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" maxlength="120" data-f="title">');
  private readonly mode = el<HTMLSelectElement>('<select class="cv-input" data-f="mode"></select>');
  private readonly prompt = el<HTMLTextAreaElement>('<textarea class="cv-input cv-ns-prompt" rows="4" spellcheck="false" data-f="prompt"></textarea>');
  private readonly base = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" data-f="base">');
  private readonly promptRow: HTMLElement;
  private readonly problem = el('<p class="cv-note cv-ns-problem"></p>');
  private readonly create: HTMLButtonElement;
  private busy = false;

  constructor(private readonly submit: (body: NewSessionBody) => Promise<Session>, private readonly done: (s: Session) => void, private readonly warm: () => void) {
    super('New Agent Session', 460);
    for (const [value, label] of [['interactive', 'Interactive: a Claude Code terminal'], ['headless', 'Headless: run a prompt and stream']] as const) {
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
    this.field('Base branch', this.base);
    this.body.append(this.problem);
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
    setText(this.problem, '');
    this.sync();
    this.open(this.name);
  }

  get modeValue(): SessionMode { return this.mode.value === 'headless' ? 'headless' : 'interactive'; }

  private sync(): void {
    const headless = this.modeValue === 'headless';
    this.prompt.disabled = !headless;
    setClass(this.promptRow, 'is-off', !headless);
    const ready = this.name.value.trim().length > 0 && (!headless || this.prompt.value.trim().length > 0) && !this.busy;
    setDisabled(this.create, !ready);
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    const mode = this.modeValue;
    const body: NewSessionBody = { title: this.name.value.trim(), mode };
    if (mode === 'headless') body.prompt = this.prompt.value.trim();
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

