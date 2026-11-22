import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, GutterMarker, ViewPlugin, gutter, tooltips, type ViewUpdate } from '@codemirror/view';
import { forEachDiagnostic, type Diagnostic } from '@codemirror/lint';
import { LSPPlugin } from '@codemirror/lsp-client';
import { Commands } from '../commands';
import { t } from '../i18n';
import { PopupMenu, trimMenu, type MenuItem } from '../menu';
import { toast } from '../toast';
import { lsp, type ActionChoice } from './lsp';

const REST_MS = 300;
const BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.7 10.7c.7.6 1.2 1.4 1.2 2.3h5c0-.9.5-1.7 1.2-2.3A6 6 0 0 0 12 3z"/></svg>';

interface Bulb { line: number; choices: ActionChoice[] }

const setBulb = StateEffect.define<Bulb | null>();

const bulbField = StateField.define<Bulb | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setBulb)) return e.value;
    if (!value) return value;
    if (tr.docChanged) return null;
    if (tr.selection && tr.state.doc.lineAt(tr.state.selection.main.head).from !== value.line) return null;
    return value;
  },
});

class BulbMarker extends GutterMarker {
  eq(): boolean {
    return true;
  }

  toDOM(): Node {
    const node = document.createElement('span');
    node.className = 'cv-ca-bulb';
    node.title = t('Show fixes');
    node.innerHTML = BULB;
    return node;
  }
}

const bulbMarker = new BulbMarker();

const steer = (menu: PopupMenu, back: () => void): void => {
  document.addEventListener('keydown', (e) => {
    if (!menu.isOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const items = menu.items(), at = items.findIndex((n) => n === document.activeElement);
    const stop = (): void => { e.preventDefault(); e.stopPropagation(); };
    const go = (i: number): void => { if (items.length) items[(i + items.length) % items.length].focus(); };
    if (e.key === 'ArrowDown') { stop(); go(at + 1); }
    else if (e.key === 'ArrowUp') { stop(); go(at < 0 ? -1 : at - 1); }
    else if (e.key === 'Home') { stop(); go(0); }
    else if (e.key === 'End') { stop(); go(-1); }
    else if ((e.key === 'Enter' || e.key === ' ') && at >= 0) { stop(); items[at].click(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { stop(); menu.close(); back(); }
  }, true);
  window.addEventListener('blur', () => menu.close());
  window.addEventListener('resize', () => menu.close());
};

class ChoiceMenu {
  private readonly commands = new Commands();
  private readonly menu = new PopupMenu(this.commands, null, true);
  private choices: ActionChoice[] = [];
  private view: EditorView | null = null;
  private made = 0;

  constructor() {
    this.menu.panel.classList.add('cv-wb-context', 'cv-ca-menu');
    steer(this.menu, () => this.view?.focus());
  }

  open(view: EditorView, choices: ActionChoice[], x: number, y: number): void {
    this.view = view;
    this.choices = choices;
    for (; this.made < choices.length; this.made++) {
      const i = this.made;
      this.commands.add({
        id: `fix-${i}`,
        label: () => this.choices[i]?.title ?? '',
        verbatim: true,
        checked: () => this.choices[i]?.preferred === true,
        run: () => { this.pick(i); },
      });
    }
    this.menu.setItems(choices.map((_, i) => `fix-${i}`));
    this.menu.openAt(x, y);
    this.menu.items()[0]?.focus();
  }

  private pick(i: number): void {
    const choice = this.choices[i], view = this.view;
    if (!choice || !view) return;
    view.focus();
    void choice.apply();
  }
}

let choiceMenu: ChoiceMenu | null = null;
const showChoices = (view: EditorView, choices: ActionChoice[], x: number, y: number): void => {
  choiceMenu ??= new ChoiceMenu();
  choiceMenu.open(view, choices, x, y);
};

const bulbPlugin = ViewPlugin.fromClass(class {
  private timer = 0;
  private serial = 0;
  private pending: AbortController | null = null;
  private readonly off: () => void;

  constructor(private readonly view: EditorView) {
    this.off = lsp.on('diagnostics', () => this.schedule());
    this.schedule();
  }

  update(u: ViewUpdate): void {
    if (u.docChanged || u.selectionSet || u.focusChanged) this.schedule();
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.pending?.abort();
    this.pending = null;
    this.serial++;
    this.timer = window.setTimeout(() => { void this.ask(); }, REST_MS);
  }

  private async ask(): Promise<void> {
    const view = this.view;
    if (!view.hasFocus || lsp.actionKinds(view) === null) return;
    const mine = this.serial, sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head).from;
    const pending = new AbortController();
    this.pending = pending;
    const found = await lsp.codeActions(view, { from: sel.from, to: sel.to, only: sel.empty ? ['quickfix'] : undefined, auto: true, signal: pending.signal });
    if (mine !== this.serial) return;
    this.pending = null;
    const had = view.state.field(bulbField, false);
    if (had === undefined || (!found.length && !had)) return;
    view.dispatch({ effects: setBulb.of(found.length ? { line, choices: found } : null) });
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    this.pending?.abort();
    this.serial++;
    this.off();
  }
});

const bulbGutter = gutter({
  class: 'cv-ca-gutter',
  markers: (view) => {
    const bulb = view.state.field(bulbField, false);
    return bulb && bulb.line <= view.state.doc.length ? RangeSet.of(bulbMarker.range(bulb.line)) : RangeSet.empty;
  },
  initialSpacer: () => bulbMarker,
  domEventHandlers: {
    mousedown(view, line, event) {
      const bulb = view.state.field(bulbField, false);
      if (!bulb || bulb.line !== line.from || !(event.target instanceof Element)) return false;
      const mark = event.target.closest('.cv-ca-bulb');
      if (!mark) return false;
      event.preventDefault();
      const box = mark.getBoundingClientRect();
      showChoices(view, bulb.choices, box.left, box.bottom);
      return true;
    },
  },
});

export const actionBulb: Extension = [bulbField, bulbPlugin, bulbGutter];

const fixButton = (text: string, run: () => void): HTMLButtonElement => {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'cm-diagnosticAction cv-ca-fix';
  node.textContent = text;
  node.title = text;
  node.addEventListener('mousedown', (e) => { e.preventDefault(); run(); });
  return node;
};

async function fillFixes(view: EditorView, item: Diagnostic, raw: unknown, row: HTMLElement): Promise<void> {
  let from = item.from, to = item.to;
  forEachDiagnostic(view.state, (d, a, b) => { if (d === item) { from = a; to = b; } });
  const found = await lsp.codeActions(view, { from, to, only: ['quickfix'], auto: true, diagnostics: [raw] });
  if (!found.length) {
    row.textContent = t('No quick fixes');
    return;
  }
  row.append(fixButton(found[0].title, () => { view.focus(); void found[0].apply(); }));
  if (found.length < 2) return;
  const more = fixButton(t('More fixes...'), () => {
    const box = more.getBoundingClientRect();
    showChoices(view, found, box.left, box.bottom);
  });
  more.classList.add('cv-ca-more');
  row.append(more);
}

export function diagnosticBody(view: EditorView, item: Diagnostic, raw: unknown): Node {
  const box = document.createElement('span');
  box.className = 'cv-ca-diag';
  const message = document.createElement('span');
  message.className = 'cv-ca-msg';
  message.textContent = item.message;
  const row = document.createElement('span');
  row.className = 'cv-ca-fixes';
  box.append(message, row);
  void fillFixes(view, item, raw, row);
  return box;
}

async function ask(view: EditorView, only: string[] | undefined): Promise<void> {
  const doc = view.state.doc, sel = view.state.selection.main;
  const whole = !!only && sel.empty;
  const found = await lsp.codeActions(view, { from: whole ? 0 : sel.from, to: whole ? doc.length : sel.to, only, auto: false, diagnostics: only ? [] : undefined });
  if (view.state.doc !== doc || !view.state.selection.main.eq(sel)) return;
  if (!found.length) {
    toast(only ? t('The language server offers no source actions for this file') : t('No quick fixes or refactorings here'), 'info');
    return;
  }
  const at = view.coordsAtPos(sel.head), box = view.dom.getBoundingClientRect();
  showChoices(view, found, at ? at.left : box.left, at ? at.bottom : box.top);
}

async function runFirst(view: EditorView, kind: string): Promise<void> {
  const found = await lsp.codeActions(view, { from: 0, to: view.state.doc.length, only: [kind], auto: false, diagnostics: [] });
  if (found.length) void found[0].apply();
  else toast(t('The language server offers no source actions for this file'), 'info');
}

export const quickFix = (view: EditorView): boolean => { void ask(view, undefined); return true; };
export const sourceActions = (view: EditorView): boolean => { void ask(view, ['source']); return true; };
export const organizeImports = (view: EditorView): boolean => { void runFirst(view, 'source.organizeImports'); return true; };

let appCommands: Commands | null = null;
let contextMenu: PopupMenu | null = null;
let contextView: EditorView | null = null;

export function bindEditorMenu(commands: Commands): void {
  appCommands = commands;
}

const offers = (kinds: string[], kind: string): boolean => kinds.some((k) => k === kind || k.startsWith(`${kind}.`));

function contextItems(view: EditorView): MenuItem[] {
  const kinds = lsp.actionKinds(view);
  const items: MenuItem[] = [];
  if (kinds) {
    items.push('lsp-quick-fix');
    if (offers(kinds, 'source')) items.push('lsp-source-action');
    if (offers(kinds, 'source.organizeImports')) items.push('lsp-organize-imports');
    items.push('-');
  }
  if (LSPPlugin.get(view)) items.push('lsp-definition', 'lsp-references', 'lsp-rename', 'lsp-format', '-');
  items.push('cut', 'copy', 'paste', '-', 'select-all');
  return trimMenu(items);
}

const tooltipRoom = tooltips({ tooltipSpace: (view) => view.dom.getBoundingClientRect() });

const contextHandler = EditorView.domEventHandlers({
  contextmenu(e, view) {
    if (!appCommands || (e.target instanceof Element && e.target.closest('.cm-gutters, .cm-panels, .cm-tooltip'))) return false;
    e.preventDefault();
    const byKey = e.button !== 2 && !e.ctrlKey;
    let x = e.clientX, y = e.clientY;
    if (byKey) {
      const at = view.coordsAtPos(view.state.selection.main.head), box = view.dom.getBoundingClientRect();
      x = at ? at.left : box.left;
      y = at ? at.bottom : box.top;
    } else {
      const pos = view.posAtCoords({ x, y });
      if (pos !== null && !view.state.selection.ranges.some((r) => !r.empty && pos >= r.from && pos <= r.to)) view.dispatch({ selection: { anchor: pos } });
    }
    if (!contextMenu) {
      const menu = new PopupMenu(appCommands, null, true);
      menu.panel.classList.add('cv-wb-context');
      steer(menu, () => contextView?.focus());
      contextMenu = menu;
    }
    contextView = view;
    contextMenu.setItems(contextItems(view));
    contextMenu.openAt(x, y);
    if (byKey) contextMenu.items()[0]?.focus();
    return true;
  },
});

export const editorMenu: Extension = [contextHandler, tooltipRoom];
