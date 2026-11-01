import { create, type AppKind, type CloneJob, type CreateOptions } from '../io/create';
import { detailOf } from '../io/workspace';
import { Dialog } from './dialogs';
import { el, q, setClass, setDisabled, setText } from './dom';
import { enhanceSelect } from './dropdown';
import { t } from './i18n';
import { icon } from './icons';
import { openFolderAt } from './open-folder';
import { pickPath } from './path-picker';
import { toast } from './toast';
import { workspace as store } from './workspace-store';

const NAME_RE = /^form[a-z0-9]{1,28}$/;
const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const URL_RE = /^(https:\/\/[^\s/@]+(@[^\s/]+)?\/\S+|ssh:\/\/\S+\/\S+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+)$/;
const POLL_MS = 400;
const CHECK_MS = 300;

let lastDest = '';

function folderOf(url: string): string {
  const parts = url.trim().replace(/\/+$/, '').split(/[/:]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return last.replace(/\.git$/, '');
}

class PathField {
  readonly root = el('<div class="cv-na-pick"><input class="cv-input" type="text" readonly spellcheck="false" tabindex="-1"><button class="cv-btn cv-btn-ghost" type="button"></button></div>');
  readonly input = q<HTMLInputElement>(this.root, 'input');
  private readonly button = q<HTMLButtonElement>(this.root, 'button');

  constructor(onChange: (path: string) => void) {
    this.input.placeholder = t('Choose a folder');
    this.button.innerHTML = `${icon('folderOpen', 14)}<span></span>`;
    setText(q(this.button, 'span'), t('Browse...'));
    this.button.addEventListener('click', () => {
      void pickPath('folder').then((path) => {
        if (!path) return;
        this.set(path);
        onChange(path);
      }).catch((e: unknown) => toast(detailOf(e), 'error'));
    });
  }

  get value(): string { return this.input.value; }
  set(path: string): void { if (this.input.value !== path) this.input.value = path; this.input.title = path; }
  setBusy(busy: boolean): void { setDisabled(this.button, busy); }
}

export async function followCloneJob(job: CloneJob, onUpdate: (j: CloneJob) => void): Promise<CloneJob> {
  const label = `${t('Clone')} ${job.name}`;
  store.upsertJob({ id: job.id, label, progress: job.progress, done: false, cancel: () => { void create.cancel(job.id).catch(() => undefined); } });
  let current = job;
  try {
    while (current.state === 'running') {
      await new Promise<void>((resolve) => { window.setTimeout(resolve, POLL_MS); });
      current = await create.job(job.id);
      onUpdate(current);
      store.upsertJob({ id: job.id, label, progress: current.progress, done: false, cancel: () => { void create.cancel(job.id).catch(() => undefined); } });
    }
  } finally {
    store.finishJob(job.id);
  }
  return current;
}

export class CloneDialog extends Dialog {
  private readonly url = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" maxlength="2048" data-f="url">');
  private readonly dest = new PathField((p) => { lastDest = p; this.sync(); });
  private readonly folder = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" maxlength="100" data-f="folder">');
  private readonly bar = el('<div class="cv-na-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>');
  private readonly fill = q(this.bar, 'i');
  private readonly status = el('<p class="cv-note cv-na-status"></p>');
  private readonly go: HTMLButtonElement;
  private readonly stop: HTMLButtonElement;
  private busy = false;
  private job: CloneJob | null = null;
  private folderEdited = false;

  constructor() {
    super('Clone Repository', 500);
    q<HTMLElement>(this.scrim, '.cv-dialog').classList.add('cv-newapp');
    this.url.placeholder = 'https://github.com/owner/repo.git';
    this.folder.placeholder = t('Same as the repository');
    this.field('Address', this.url);
    this.field('Into folder', this.dest.root);
    this.field('Folder name', this.folder);
    this.body.append(this.bar, this.status);
    this.stop = this.button('Cancel', 'ghost', () => this.cancel());
    this.go = this.button('Clone', 'primary', () => { void this.run(); });
    this.url.addEventListener('input', () => { if (!this.folderEdited) this.folder.value = folderOf(this.url.value); this.sync(); });
    this.folder.addEventListener('input', () => { this.folderEdited = this.folder.value.length > 0; this.sync(); });
    for (const f of [this.url, this.folder]) f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !this.go.disabled) { e.preventDefault(); void this.run(); } });
    this.sync();
  }

  show(): void {
    if (this.isOpen) return;
    if (!this.busy) {
      this.url.value = '';
      this.folder.value = '';
      this.folderEdited = false;
      this.dest.set(lastDest || (store.workspace?.path ? parent(store.workspace.path) : ''));
      this.progress(0);
      this.say('');
    }
    this.sync();
    this.open(this.url);
  }

  private say(text: string, error = false): void {
    setText(this.status, text);
    setClass(this.status, 'is-error', error);
  }

  private progress(share: number): void {
    const pct = Math.round(Math.max(0, Math.min(1, share)) * 100);
    const style = `scaleX(${pct / 100})`;
    if (this.fill.style.transform !== style) this.fill.style.transform = style;
    this.bar.setAttribute('aria-valuenow', String(pct));
  }

  private valid(): boolean {
    const name = this.folder.value.trim() || folderOf(this.url.value);
    return URL_RE.test(this.url.value.trim()) && this.dest.value !== '' && FOLDER_RE.test(name);
  }

  private sync(): void {
    setDisabled(this.go, this.busy || !this.valid());
    setDisabled(this.url, this.busy);
    setDisabled(this.folder, this.busy);
    this.dest.setBusy(this.busy);
    setText(this.stop, this.busy ? t('Stop') : t('Cancel'));
    this.stop.dataset.shown = this.stop.textContent ?? '';
    this.stop.dataset.en = this.busy ? 'Stop' : 'Cancel';
  }

  private cancel(): void {
    if (this.busy && this.job) {
      this.say(t('Stopping...'));
      void create.cancel(this.job.id).catch(() => undefined);
      return;
    }
    this.close();
  }

  private async run(): Promise<void> {
    if (this.busy || !this.valid()) return;
    this.busy = true;
    this.sync();
    this.say(t('Starting...'));
    this.progress(0);
    try {
      const started = await create.clone(this.url.value.trim(), this.dest.value, this.folder.value.trim());
      this.job = started;
      lastDest = this.dest.value;
      const done = await followCloneJob(started, (j) => {
        this.progress(j.progress);
        this.say(j.message);
      });
      if (done.state === 'done') {
        this.progress(1);
        this.busy = false;
        this.job = null;
        this.close();
        toast(`${t('Cloned')} ${done.name}`, 'info');
        await openFolderAt(done.path);
        return;
      }
      this.say(done.state === 'cancelled' ? t('Clone stopped.') : done.error, done.state !== 'cancelled');
      this.progress(0);
    } catch (e) {
      this.say(detailOf(e), true);
      this.progress(0);
    } finally {
      this.busy = false;
      this.job = null;
      this.sync();
    }
  }
}

function parent(path: string): string {
  const flat = path.replace(/[\\/]+$/, '');
  const at = Math.max(flat.lastIndexOf('/'), flat.lastIndexOf('\\'));
  return at > 0 ? flat.slice(0, at) : '';
}

export class NewAppDialog extends Dialog {
  private readonly name = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" maxlength="32" data-f="name">');
  private readonly kind = el<HTMLSelectElement>('<select class="cv-input" data-f="kind"></select>');
  private readonly dest = new PathField((p) => { lastDest = p; void this.refresh(); });
  private readonly port = el<HTMLInputElement>('<input class="cv-input" type="text" inputmode="numeric" spellcheck="false" autocomplete="off" maxlength="4" data-f="port">');
  private readonly hint = el('<p class="cv-note cv-na-status"></p>');
  private readonly create: HTMLButtonElement;
  private busy = false;
  private portEdited = false;
  private portOk = false;
  private nameProblem = '';
  private portProblem = '';
  private timer = 0;
  private seq = 0;
  private opts: CreateOptions | null = null;

  constructor() {
    super('New Form App', 500);
    q<HTMLElement>(this.scrim, '.cv-dialog').classList.add('cv-newapp');
    this.name.placeholder = 'formexample';
    for (const [value, label] of [['rust', 'Rust core, cli and Tauri (like formMCP)'], ['python', 'Python engine and Tauri (like formvis)']] as const) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = t(label);
      this.kind.append(o);
    }
    this.field('Name', this.name);
    this.field('Kind', this.kind);
    enhanceSelect(this.kind);
    this.field('Create in', this.dest.root);
    this.field('First port', this.port);
    this.body.append(this.hint);
    this.button('Cancel', 'ghost', () => this.close());
    this.create = this.button('Create app', 'primary', () => { void this.send(); });
    this.name.addEventListener('input', () => { this.checkName(); this.sync(); });
    this.port.addEventListener('input', () => { this.portEdited = true; this.queueCheck(); this.sync(); });
    this.kind.addEventListener('change', () => this.sync());
    this.name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !this.create.disabled) { e.preventDefault(); void this.send(); } });
    this.sync();
  }

  show(): void {
    if (this.isOpen) return;
    this.name.value = '';
    this.kind.value = 'rust';
    this.port.value = '';
    this.portEdited = false;
    this.portOk = false;
    this.nameProblem = '';
    this.portProblem = '';
    this.dest.set(lastDest || (store.workspace?.path ? parent(store.workspace.path) : ''));
    this.say('');
    this.sync();
    this.open(this.name);
    void this.refresh();
  }

  private say(text: string, error = false): void {
    setText(this.hint, text);
    setClass(this.hint, 'is-error', error);
  }

  private checkName(): void {
    const v = this.name.value;
    this.nameProblem = v === '' || NAME_RE.test(v) ? '' : t('Lowercase letters and digits, starting with form.');
  }

  private async refresh(): Promise<void> {
    const seq = ++this.seq;
    try {
      const opts = await create.options(this.dest.value || undefined);
      if (seq !== this.seq) return;
      this.opts = opts;
      if (!this.portEdited && opts.block !== null) {
        const text = String(opts.block);
        if (this.port.value !== text) this.port.value = text;
      }
      await this.check(seq);
    } catch (e) {
      if (seq === this.seq) this.say(detailOf(e), true);
    }
  }

  private queueCheck(): void {
    window.clearTimeout(this.timer);
    this.portOk = false;
    this.timer = window.setTimeout(() => { void this.check(++this.seq); }, CHECK_MS);
  }

  private async check(seq: number): Promise<void> {
    const base = Number(this.port.value);
    if (!/^\d{4}$/.test(this.port.value) || !Number.isInteger(base)) {
      this.portOk = false;
      this.portProblem = this.port.value ? t('Four digits, a multiple of 10, from 5600 to 5990.') : '';
      this.sync();
      return;
    }
    try {
      const r = await create.port(base, this.dest.value || undefined);
      if (seq !== this.seq) return;
      this.portOk = r.ok;
      this.portProblem = r.ok ? '' : r.problem;
    } catch (e) {
      if (seq !== this.seq) return;
      this.portOk = false;
      this.portProblem = detailOf(e);
    }
    this.sync();
  }

  private ready(): boolean {
    return NAME_RE.test(this.name.value) && this.dest.value !== '' && this.portOk && !this.busy;
  }

  private sync(): void {
    setDisabled(this.create, !this.ready());
    for (const f of [this.name, this.port, this.kind]) setDisabled(f, this.busy);
    this.dest.setBusy(this.busy);
    if (this.busy) return;
    const base = Number(this.port.value);
    const notes = this.opts
      ? `${t('Ports')} ${this.port.value || '-'} ${t('to')} ${Number.isFinite(base) && this.port.value ? base + 9 : '-'} · ${t('first commit by')} ${this.opts.identity.name}${this.opts.formslot ? ` · ${t('formslot plugin installed')}` : ` · ${t('formslot not found, plugin skipped')}`}`
      : '';
    const problem = this.nameProblem || this.portProblem;
    this.say(problem || notes, !!problem);
  }

  private async send(): Promise<void> {
    if (!this.ready()) return;
    this.busy = true;
    this.sync();
    this.say(t('Creating the repository...'));
    try {
      const result = await create.app({ name: this.name.value, kind: this.kind.value === 'python' ? 'python' as AppKind : 'rust', dest: this.dest.value, port: Number(this.port.value) });
      lastDest = this.dest.value;
      this.busy = false;
      this.close();
      toast(`${t('Created')} ${result.name}`, 'info');
      await openFolderAt(result.path);
    } catch (e) {
      this.busy = false;
      this.sync();
      this.say(detailOf(e), true);
    }
  }
}
