import { adoptSavedKeys, commitKeys, KEYS_EVENT, keysLoaded } from '../io/keybindings';
import { comboOf, formatKeys, type Commands } from './commands';
import { confirmAction } from './dialogs';
import { el, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from './dom';
import { onLanguage, t } from './i18n';
import { icon } from './icons';
import { toast } from './toast';

interface KeyItem { id: string; label: string; keys: string[]; shown: string; changed: boolean; hidden: boolean }

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn']);
const UNUSABLE_KEYS = new Set(['Dead', 'Process', 'Unidentified', '', ' ']);
const JOIN = '  ·  ';
const ROW =
  '<div class="cv-prefs-keyrow cv-keys-row"><span class="cv-prefs-keyname"></span><span class="cv-prefs-keycombo" data-no-i18n></span><span class="cv-keys-acts">' +
  '<button class="cv-btn cv-keys-change" type="button" data-act="change"></button>' +
  `<button class="cv-icon-btn" type="button" data-act="remove">${icon('remove', 14)}</button>` +
  `<button class="cv-icon-btn" type="button" data-act="reset">${icon('undo', 14)}</button></span></div>`;

export class KeysPage {
  readonly el = el('<div class="cv-keys"></div>');
  private readonly search = el<HTMLInputElement>('<input class="cv-input" type="search" spellcheck="false" autocomplete="off">');
  private readonly resetAll = el<HTMLButtonElement>('<button class="cv-btn" type="button"></button>');
  private readonly status = el('<p class="cv-note cv-prefs-status" role="status"></p>');
  private readonly list = el('<div class="cv-prefs-keys"></div>');
  private readonly none = el('<p class="cv-note" hidden></p>');
  private capturing: string | null = null;
  private note = '';
  private bad = false;

  constructor(private readonly commands: Commands) {
    const bar = el('<div class="cv-keys-bar"></div>');
    bar.append(this.search, this.resetAll);
    this.el.append(bar, this.status, this.list, this.none);
    this.search.addEventListener('input', () => this.sync());
    this.resetAll.addEventListener('click', () => { void this.resetEvery(); });
    this.list.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button[data-act]') : null;
      const id = b?.closest<HTMLElement>('.cv-keys-row')?.dataset.key;
      if (!b || !id) return;
      if (b.dataset.act === 'change') { if (this.capturing === id) this.endCapture(''); else void this.beginCapture(id); }
      else if (b.dataset.act === 'remove') { void this.write(() => this.commands.setKeys(id, []), id); }
      else if (b.dataset.act === 'reset') { void this.write(() => this.commands.resetKey(id), id); }
    });
    window.addEventListener(KEYS_EVENT, () => this.sync());
    onLanguage(() => this.sync());
    this.sync();
  }

  private say(text: string, bad = false): void {
    this.note = text;
    this.bad = bad;
    setText(this.status, text);
    setClass(this.status, 'is-error', bad);
  }

  private async ready(): Promise<boolean> {
    if (await adoptSavedKeys(this.commands, 0)) return true;
    this.say(t('Shortcuts cannot be changed while the engine is offline.'), true);
    return false;
  }

  private async write(change: () => void, id = ''): Promise<void> {
    this.endCapture('');
    if (!keysLoaded() && !(await this.ready())) return;
    change();
    this.say('');
    this.sync();
    const row = id ? Array.from(this.list.children).find((n) => (n as HTMLElement).dataset.key === id) : null;
    (row?.querySelector<HTMLElement>('[data-act="change"]') ?? this.search).focus({ preventScroll: true });
    if (!(await commitKeys(this.commands))) {
      this.say(t('The shortcuts could not be saved.'), true);
      toast(t('The shortcuts could not be saved.'), 'error');
    }
  }

  private async resetEvery(): Promise<void> {
    if (!(await confirmAction('Reset All Shortcuts', t('Every shortcut goes back to its default.'), 'Reset All', true))) return;
    await this.write(() => this.commands.resetKeys());
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const id = this.capturing;
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    if (MODIFIER_KEYS.has(e.key)) return;
    const combo = comboOf(e);
    if (combo === 'Escape') { this.endCapture(''); return; }
    const mods = combo.split('+').slice(0, -1), key = combo.endsWith('++') ? '+' : combo.split('+').pop() ?? '';
    if (UNUSABLE_KEYS.has(key)) return;
    if (!mods.includes('Mod') && !mods.includes('Alt') && !/^F\d{1,2}$/.test(key)) {
      this.say(t('A shortcut needs Ctrl, Cmd or Alt, or a function key. Press another, or Escape to cancel.'), true);
      return;
    }
    this.endCapture('');
    void this.take(id, combo);
  };

  private readonly onPointer = (e: PointerEvent): void => {
    const b = e.target instanceof Element ? e.target.closest('button[data-act="change"]') : null;
    if (!b || b.closest<HTMLElement>('.cv-keys-row')?.dataset.key !== this.capturing) this.endCapture('');
  };

  private async beginCapture(id: string): Promise<void> {
    this.endCapture('');
    if (!keysLoaded() && !(await this.ready())) return;
    this.capturing = id;
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('pointerdown', this.onPointer, true);
    this.say(t('Press the new shortcut, or Escape to cancel.'));
    this.sync();
  }

  private endCapture(note: string): void {
    if (!this.capturing) return;
    this.capturing = null;
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('pointerdown', this.onPointer, true);
    this.say(note);
    this.sync();
  }

  private async take(id: string, combo: string): Promise<void> {
    const cmd = this.commands.get(id), other = this.commands.forCombo(combo);
    if (!cmd) return;
    if (other && other.id !== id) {
      const name = t(this.commands.label(other).replace(/\.\.\.$/, ''));
      if (!(await confirmAction('Shortcut in Use', `${formatKeys(combo)}: ${t('this shortcut belongs to')} ${name}. ${t('Take it for this command?')}`, 'Take Shortcut'))) return;
    }
    const rest = (cmd.keys ?? []).slice(1).filter((k) => k !== combo);
    await this.write(() => this.commands.setKeys(id, [combo, ...rest]), id);
  }

  sync(): void {
    const c = this.commands, needle = this.search.value.trim().toLowerCase();
    const changed = c.overrides();
    const items: KeyItem[] = c.all().map((cmd) => {
      const label = t(c.label(cmd).replace(/\.\.\.$/, '')), keys = cmd.keys ?? [], shown = keys.map(formatKeys).join(JOIN);
      const hit = !needle || label.toLowerCase().includes(needle) || shown.toLowerCase().includes(needle) || cmd.id.includes(needle);
      return { id: cmd.id, label, keys, shown, changed: cmd.id in changed, hidden: !hit || !label };
    });
    patchList(this.list, items, {
      key: (i) => i.id,
      create: (i) => { const node = el(ROW); this.fill(node, i); return node; },
      update: (node, i) => this.fill(node, i),
    });
    const hint = t('Search shortcuts');
    if (this.search.placeholder !== hint) { this.search.placeholder = hint; this.search.setAttribute('aria-label', hint); }
    setText(this.resetAll, t('Reset All'));
    setDisabled(this.resetAll, !Object.keys(changed).length);
    setText(this.none, t('No command matches.'));
    setHidden(this.none, items.some((i) => !i.hidden));
    setText(this.status, this.note);
    setClass(this.status, 'is-error', this.bad);
  }

  private fill(node: HTMLElement, i: KeyItem): void {
    const on = this.capturing === i.id;
    const change = q<HTMLButtonElement>(node, '[data-act="change"]'), remove = q<HTMLButtonElement>(node, '[data-act="remove"]'), reset = q<HTMLButtonElement>(node, '[data-act="reset"]');
    setHidden(node, i.hidden);
    setClass(node, 'is-changed', i.changed);
    setClass(node, 'is-capturing', on);
    setText(q(node, '.cv-prefs-keyname'), i.label);
    setText(q(node, '.cv-prefs-keycombo'), on ? '...' : i.shown);
    setText(change, t(on ? 'Cancel' : 'Change'));
    setDisabled(remove, !i.keys.length);
    setDisabled(reset, !i.changed);
    setTitle(remove, t('Remove the shortcut'));
    setTitle(reset, t('Reset to the default'));
    if (remove.getAttribute('aria-label') !== remove.title) remove.setAttribute('aria-label', remove.title);
    if (reset.getAttribute('aria-label') !== reset.title) reset.setAttribute('aria-label', reset.title);
  }
}
