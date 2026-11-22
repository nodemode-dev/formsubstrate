import { createLaunchFile, launchFile, type LaunchEntry, type LaunchListing } from '../../io/debug';
import { patchList, setClass, setDisabled, setText, setTitle } from '../../ui/dom';
import { t } from '../../ui/i18n';

const STORE_KEY = 'formsubstrate.debug.launch';
const WORKSPACES_KEPT = 30;
const OWN_FILE = '.formsubstrate/launch.json';
const CURRENT = '';

export function recallFor<T>(key: string, workspace: string, fallback: T): T {
  if (!workspace) return fallback;
  try {
    const all: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    const value = all && typeof all === 'object' ? (all as Record<string, unknown>)[workspace] : undefined;
    return value === undefined ? fallback : (value as T);
  } catch {
    return fallback;
  }
}

export function keepFor(key: string, workspace: string, value: unknown): void {
  if (!workspace) return;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    const all: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    delete all[workspace];
    all[workspace] = value;
    const names = Object.keys(all);
    for (const name of names.slice(0, Math.max(0, names.length - WORKSPACES_KEPT))) delete all[name];
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    return;
  }
}

interface Choice { value: string; entry: LaunchEntry | null }

export class LaunchPicker {
  private listing: LaunchListing | null = null;
  private failed = '';
  private workspace = '';
  private wanted = CURRENT;
  private seq = 0;

  constructor(
    private readonly select: HTMLSelectElement,
    private readonly note: HTMLElement,
    private readonly button: HTMLButtonElement,
    private readonly opened: (path: string) => void,
    private readonly changed: () => void,
    private readonly report: (text: string) => void,
  ) {
    select.addEventListener('change', () => {
      this.wanted = select.value;
      keepFor(STORE_KEY, this.workspace, this.wanted ? this.entryOf(this.wanted)?.name ?? '' : '');
      this.paint();
      this.changed();
    });
    button.addEventListener('click', () => { void this.openFile(); });
  }

  private idOf(entry: LaunchEntry): string { return `c${entry.index}`; }

  private entryOf(value: string): LaunchEntry | undefined {
    return this.listing?.configurations.find((c) => this.idOf(c) === value);
  }

  selected(): LaunchEntry | null {
    const entry = this.wanted ? this.entryOf(this.wanted) : undefined;
    return entry && entry.runnable ? entry : null;
  }

  setDisabled(off: boolean): void {
    setDisabled(this.select, off);
  }

  async refresh(workspace: string): Promise<void> {
    const seq = ++this.seq;
    const moved = workspace !== this.workspace;
    this.workspace = workspace;
    if (!workspace) {
      this.listing = null;
      this.failed = '';
      this.wanted = CURRENT;
      this.paint();
      return;
    }
    let listing: LaunchListing | null = null;
    let failed = '';
    try { listing = await launchFile(); } catch (err) { failed = err instanceof Error ? err.message : String(err); }
    if (seq !== this.seq) return;
    const before = this.wanted ? this.entryOf(this.wanted)?.name ?? '' : '';
    this.listing = listing;
    this.failed = failed;
    const name = moved ? recallFor<string>(STORE_KEY, workspace, '') : before;
    const again = name ? listing?.configurations.find((c) => c.name === name && c.runnable) : undefined;
    this.wanted = again ? this.idOf(again) : CURRENT;
    this.paint();
    this.changed();
  }

  private noteText(): string {
    const l = this.listing;
    if (this.failed) return this.failed;
    if (!l || !l.root) return '';
    if (!l.exists) return t('No launch file. Add Configuration writes .formsubstrate/launch.json.');
    if (!l.trusted) return t('This workspace is not trusted, so its launch file was not read. Trust it in Preferences to use it.');
    if (l.problem) return `${l.source ?? ''}: ${l.problem}`;
    const entry = this.wanted ? this.entryOf(this.wanted) : undefined;
    if (entry?.ignored.length) return `${t('Ignored fields')}: ${entry.ignored.join(', ')}`;
    if (l.fallback) return t('Read from .vscode/launch.json because there is no .formsubstrate/launch.json.');
    return l.source ?? '';
  }

  paint(): void {
    const l = this.listing;
    const choices: Choice[] = [{ value: CURRENT, entry: null }, ...(l?.configurations ?? []).map((entry) => ({ value: this.idOf(entry), entry }))];
    const fill = (node: HTMLElement, c: Choice): void => {
      const option = node as HTMLOptionElement;
      if (option.getAttribute('value') !== c.value) option.setAttribute('value', c.value);
      setText(option, c.entry ? c.entry.name || `${c.entry.type} ${c.entry.index + 1}` : t('Current File'));
      const off = !!c.entry && !c.entry.runnable;
      if (option.disabled !== off) option.disabled = off;
      setTitle(option, c.entry?.problem ?? '');
    };
    patchList(this.select, choices, {
      key: (c) => `o:${c.value}`,
      create: (c) => { const option = document.createElement('option'); fill(option, c); return option; },
      update: fill,
    });
    if (this.select.value !== this.wanted) this.select.value = this.wanted;
    const note = this.noteText();
    setText(this.note, note);
    setTitle(this.note, note);
    setClass(this.note, 'is-missing', !!this.failed || !!l?.problem);
    const label = l?.exists ? t('Open the launch file') : t('Add Configuration');
    setTitle(this.button, label);
    if (this.button.getAttribute('aria-label') !== label) this.button.setAttribute('aria-label', label);
    setDisabled(this.button, !this.workspace);
    const pick = t('Launch configuration');
    if (this.select.getAttribute('aria-label') !== pick) this.select.setAttribute('aria-label', pick);
  }

  async openFile(): Promise<void> {
    if (!this.workspace) return;
    const source = this.listing?.exists ? this.listing.source : null;
    if (source) {
      this.opened(source);
      return;
    }
    try {
      const made = await createLaunchFile();
      this.opened(made.path || OWN_FILE);
    } catch (err) {
      this.report(err instanceof Error ? err.message : String(err));
    }
    await this.refresh(this.workspace);
  }
}
