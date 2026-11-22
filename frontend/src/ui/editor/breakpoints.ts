import { Facet, RangeSet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { Commands } from '../commands';
import { el, q, setClass } from '../dom';
import { t } from '../i18n';
import { PopupMenu } from '../menu';
import { workspace } from '../workspace-store';

export interface DebugLocation { path: string; line: number }
export interface BreakpointDetail { enabled: boolean; condition: string; hitCondition: string; logMessage: string }
export interface Breakpoint extends BreakpointDetail { line: number }
export interface BreakpointSupport { condition: boolean; hit: boolean; log: boolean }
export type BreakpointMode = 'condition' | 'hit' | 'log';
type Shape = 'plain' | 'conditional' | 'log';

const STORE_KEY = 'formsubstrate.breakpoints';
const WORKSPACES_KEPT = 30;
const FILES_KEPT = 200;
const LINES_KEPT = 500;
const TEXT_MAX = 2000;
const PLAIN: BreakpointDetail = { enabled: true, condition: '', hitCondition: '', logMessage: '' };
const ALL_MODES: readonly BreakpointMode[] = ['condition', 'hit', 'log'];
const MODE_LABEL: Record<BreakpointMode, string> = { condition: 'Expression', hit: 'Hit Count', log: 'Log Message' };
const MODE_HINT: Record<BreakpointMode, string> = {
  condition: 'Break when the expression is true. Enter applies, Escape cancels.',
  hit: 'Break on a hit count, such as 3 or >= 5. Enter applies, Escape cancels.',
  log: 'Message to log without stopping; {expressions} in braces are evaluated.',
};
const MODE_FIELD: Record<BreakpointMode, 'condition' | 'hitCondition' | 'logMessage'> = { condition: 'condition', hit: 'hitCondition', log: 'logMessage' };
const SHAPES: Record<Shape, string> = {
  plain: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle class="cv-bp-fill" cx="8" cy="8" r="5.25" fill="currentColor" stroke="currentColor" stroke-width="1.5"/></svg>',
  conditional: '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="cv-bp-fill" fill-rule="evenodd" fill="currentColor" stroke="currentColor" stroke-width="1.5" d="M8 2.75a5.25 5.25 0 1 0 0 10.5a5.25 5.25 0 0 0 0-10.5zM5.5 6h5v1.25h-5zM5.5 8.75h5V10h-5z"/></svg>',
  log: '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="cv-bp-fill" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M8 2.5 13.5 8 8 13.5 2.5 8z"/></svg>',
};

const shapeOf = (b: BreakpointDetail): Shape => (b.logMessage ? 'log' : b.condition || b.hitCondition ? 'conditional' : 'plain');
const sameDetail = (a: BreakpointDetail, b: BreakpointDetail): boolean => a.enabled === b.enabled && a.condition === b.condition && a.hitCondition === b.hitCondition && a.logMessage === b.logMessage;

function describe(b: BreakpointDetail): string {
  const parts: string[] = [];
  if (!b.enabled) parts.push(t('Disabled'));
  if (b.condition) parts.push(`${t('Expression')}: ${b.condition}`);
  if (b.hitCondition) parts.push(`${t('Hit Count')}: ${b.hitCondition}`);
  if (b.logMessage) parts.push(`${t('Log Message')}: ${b.logMessage}`);
  return parts.join('\n');
}

class Mark extends GutterMarker {
  constructor(readonly detail: BreakpointDetail) { super(); }

  eq(other: GutterMarker): boolean { return other instanceof Mark && sameDetail(other.detail, this.detail); }

  toDOM(): Node {
    const node = document.createElement('span');
    node.className = this.detail.enabled ? 'cv-bp-dot' : 'cv-bp-dot is-off';
    node.dataset.shape = shapeOf(this.detail);
    node.innerHTML = SHAPES[shapeOf(this.detail)];
    const title = describe(this.detail);
    if (title) node.title = title;
    return node;
  }
}

const spacer = new Mark(PLAIN);
const lineDeco = Decoration.line({ class: 'cv-debug-line' });
const toggleEffect = StateEffect.define<number>();
const setEffect = StateEffect.define<{ pos: number; detail: BreakpointDetail | null }>();
const refreshEffect = StateEffect.define<null>();
const pathFacet = Facet.define<string, string>({ combine: (values) => values[0] ?? '' });

const stored = new Map<string, Breakpoint[]>();
const watchers = new Set<(path: string) => void>();
let loadedFor: string | null = null;
let support: BreakpointSupport = { condition: true, hit: true, log: true };
let location: DebugLocation | null = null;
let pendingReveal = false;
let current: { path: string; view: EditorView } | null = null;

const textOf = (v: unknown): string => (typeof v === 'string' ? v.slice(0, TEXT_MAX) : '');

function readAll(): Record<string, Record<string, unknown>> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Record<string, unknown>>) : {};
  } catch {
    return {};
  }
}

function ensure(): void {
  const ws = workspace.workspace?.path ?? '';
  if (ws === loadedFor) return;
  loadedFor = ws;
  stored.clear();
  if (!ws) return;
  const files = readAll()[ws];
  if (!files || typeof files !== 'object') return;
  for (const [path, list] of Object.entries(files).slice(0, FILES_KEPT)) {
    if (!Array.isArray(list)) continue;
    const out: Breakpoint[] = [];
    for (const item of list.slice(0, LINES_KEPT) as Array<Record<string, unknown> | null>) {
      const line = Number(item?.line);
      if (!item || !Number.isInteger(line) || line < 1 || out.some((b) => b.line === line)) continue;
      out.push({ line, enabled: item.enabled !== false, condition: textOf(item.condition), hitCondition: textOf(item.hitCondition), logMessage: textOf(item.logMessage) });
    }
    if (out.length) stored.set(path, out.sort((a, b) => a.line - b.line));
  }
}

function persist(): void {
  if (!loadedFor) return;
  try {
    const all = readAll();
    delete all[loadedFor];
    if (stored.size) all[loadedFor] = Object.fromEntries([...stored.entries()].slice(0, FILES_KEPT));
    const names = Object.keys(all);
    for (const name of names.slice(0, Math.max(0, names.length - WORKSPACES_KEPT))) delete all[name];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    return;
  }
}

export function breakpointsOf(path: string): Breakpoint[] {
  ensure();
  return (stored.get(path) ?? []).map((b) => ({ ...b }));
}

export function breakpointPaths(): string[] {
  ensure();
  return [...stored.entries()].filter(([, list]) => list.length > 0).map(([path]) => path);
}

export function clearBreakpoints(): void {
  loadedFor = null;
  stored.clear();
}

export function setBreakpointSupport(next: BreakpointSupport | null): void {
  support = next ?? { condition: true, hit: true, log: true };
}

export function onBreakpoints(fn: (path: string) => void): () => void {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}

function commit(path: string, list: Breakpoint[]): void {
  ensure();
  const next = list.filter((b, i) => list.findIndex((x) => x.line === b.line) === i).sort((a, b) => a.line - b.line);
  const prev = stored.get(path) ?? [];
  if (next.length === prev.length && next.every((b, i) => b.line === prev[i].line && sameDetail(b, prev[i]))) return;
  if (next.length) stored.set(path, next); else stored.delete(path);
  persist();
  for (const fn of Array.from(watchers)) fn(path);
}

function listOf(state: EditorState, set: RangeSet<Mark>): Breakpoint[] {
  const out: Breakpoint[] = [];
  const cur = set.iter();
  while (cur.value) {
    out.push({ line: state.doc.lineAt(cur.from).number, ...cur.value.detail });
    cur.next();
  }
  return out;
}

function detailAt(state: EditorState, pos: number): BreakpointDetail | null {
  let found: BreakpointDetail | null = null;
  state.field(markerField).between(pos, pos, (_from, _to, mark) => { found = mark.detail; });
  return found;
}

const markerField = StateField.define<RangeSet<Mark>>({
  create(state) {
    ensure();
    const list = stored.get(state.facet(pathFacet)) ?? [];
    const marks = list.filter((b) => b.line >= 1 && b.line <= state.doc.lines).map((b) => new Mark({ enabled: b.enabled, condition: b.condition, hitCondition: b.hitCondition, logMessage: b.logMessage }).range(state.doc.line(b.line).from));
    return RangeSet.of(marks, true);
  },
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(toggleEffect)) {
        const pos = e.value;
        let present = false;
        next.between(pos, pos, () => { present = true; });
        next = present ? next.update({ filter: (from) => from !== pos }) : next.update({ add: [new Mark(PLAIN).range(pos)] });
      } else if (e.is(setEffect)) {
        const { pos, detail } = e.value;
        next = next.update({ filter: (from) => from !== pos, add: detail ? [new Mark(detail).range(pos)] : [] });
      }
    }
    return next;
  },
});

interface Editing { id: number; pos: number; mode: BreakpointMode }

let editSeq = 0;
const editEffect = StateEffect.define<Editing | null>();

function closeEdit(view: EditorView, detail?: BreakpointDetail | null): void {
  const edit = view.state.field(editField);
  if (!edit) return;
  const effects: StateEffect<unknown>[] = [editEffect.of(null)];
  if (detail !== undefined) effects.push(setEffect.of({ pos: edit.pos, detail }));
  view.dispatch({ effects });
  view.focus();
}

class EditWidget extends WidgetType {
  constructor(readonly edit: Editing) { super(); }

  eq(other: WidgetType): boolean { return other instanceof EditWidget && other.edit.id === this.edit.id; }

  toDOM(view: EditorView): HTMLElement {
    const box = el('<div class="cv-bp-edit"><div class="cv-bp-modes" role="tablist"></div><input class="cv-input cv-bp-input" type="text" spellcheck="false" autocomplete="off" maxlength="2000"></div>');
    const input = q<HTMLInputElement>(box, '.cv-bp-input');
    const tabs = q(box, '.cv-bp-modes');
    const had = detailAt(view.state, this.edit.pos);
    const values: Record<BreakpointMode, string> = { condition: had?.condition ?? '', hit: had?.hitCondition ?? '', log: had?.logMessage ?? '' };
    const modes = ALL_MODES.filter((m) => support[m]);
    let mode: BreakpointMode = modes.includes(this.edit.mode) ? this.edit.mode : modes[0] ?? 'condition';
    const show = (): void => {
      input.value = values[mode];
      input.placeholder = t(MODE_HINT[mode]);
      input.setAttribute('aria-label', t(MODE_LABEL[mode]));
      for (const b of Array.from(tabs.children)) {
        const on = (b as HTMLElement).dataset.mode === mode;
        setClass(b, 'is-current', on);
        b.setAttribute('aria-selected', String(on));
      }
    };
    for (const m of modes) {
      const b = el<HTMLButtonElement>('<button class="cv-bp-mode" type="button" role="tab"></button>');
      b.dataset.mode = m;
      b.textContent = t(MODE_LABEL[m]);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { values[mode] = input.value; mode = m; show(); input.focus(); });
      tabs.append(b);
    }
    input.addEventListener('input', () => { values[mode] = input.value; });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); closeEdit(view); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      values[mode] = input.value;
      const next: BreakpointDetail = { enabled: had?.enabled ?? true, condition: values.condition.trim(), hitCondition: values.hit.trim(), logMessage: values.log.trim() };
      if (!had && shapeOf(next) === 'plain') closeEdit(view);
      else closeEdit(view, next);
    });
    show();
    requestAnimationFrame(() => { if (box.isConnected) input.focus(); });
    return box;
  }

  ignoreEvent(): boolean { return true; }
}

const editField: StateField<Editing | null> = StateField.define<Editing | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(editEffect)) return e.value;
    if (value && tr.docChanged) return { ...value, pos: tr.newDoc.lineAt(tr.changes.mapPos(value.pos)).from };
    return value;
  },
  provide: (field) => EditorView.decorations.compute([field], (state) => {
    const edit = state.field(field);
    if (!edit) return Decoration.none;
    const at = state.doc.lineAt(Math.min(edit.pos, state.doc.length)).to;
    return Decoration.set([Decoration.widget({ widget: new EditWidget(edit), block: true, side: 1 }).range(at)]);
  }),
});

function openEdit(view: EditorView, pos: number, mode: BreakpointMode): void {
  view.dispatch({ effects: editEffect.of({ id: ++editSeq, pos, mode }) });
}

let menu: PopupMenu | null = null;
let menuAt: { view: EditorView; pos: number } | null = null;

function menuDetail(): BreakpointDetail | null {
  return menuAt ? detailAt(menuAt.view.state, menuAt.pos) : null;
}

function buildMenu(): PopupMenu {
  const cmds = new Commands();
  const act = (fn: (view: EditorView, pos: number, had: BreakpointDetail | null) => void) => (): void => {
    if (menuAt) fn(menuAt.view, menuAt.pos, menuDetail());
  };
  cmds.add(
    { id: 'bp-add', label: 'Add Breakpoint', run: act((view, pos) => view.dispatch({ effects: setEffect.of({ pos, detail: PLAIN }) })) },
    { id: 'bp-add-condition', label: 'Add Conditional Breakpoint', run: act((view, pos) => openEdit(view, pos, 'condition')) },
    { id: 'bp-add-log', label: 'Add Logpoint', run: act((view, pos) => openEdit(view, pos, 'log')) },
    { id: 'bp-edit-condition', label: 'Edit Condition', run: act((view, pos, had) => openEdit(view, pos, had && !had.condition && had.hitCondition ? 'hit' : 'condition')) },
    { id: 'bp-edit-log', label: 'Edit Log Message', run: act((view, pos) => openEdit(view, pos, 'log')) },
    { id: 'bp-remove', label: 'Remove Breakpoint', run: act((view, pos) => view.dispatch({ effects: setEffect.of({ pos, detail: null }) })) },
    { id: 'bp-enable', label: () => (menuDetail()?.enabled === false ? 'Enable Breakpoint' : 'Disable Breakpoint'), run: act((view, pos, had) => { if (had) view.dispatch({ effects: setEffect.of({ pos, detail: { ...had, enabled: !had.enabled } }) }); }) },
  );
  return new PopupMenu(cmds, null, true);
}

function showMenu(view: EditorView, pos: number, x: number, y: number): void {
  menu ??= buildMenu();
  menuAt = { view, pos };
  const conditional = support.condition || support.hit;
  const items = detailAt(view.state, pos)
    ? [...(conditional ? ['bp-edit-condition'] : []), ...(support.log ? ['bp-edit-log'] : []), '-', 'bp-remove', 'bp-enable']
    : ['bp-add', ...(conditional ? ['bp-add-condition'] : []), ...(support.log ? ['bp-add-log'] : [])];
  menu.setItems(items[0] === '-' ? items.slice(1) : items);
  menu.openAt(x, y);
}

function buildLine(state: EditorState, path: string): DecorationSet {
  if (!location || location.path !== path || location.line < 1 || location.line > state.doc.lines) return Decoration.none;
  return Decoration.set([lineDeco.range(state.doc.line(location.line).from)]);
}

class Locator {
  decorations: DecorationSet;
  private dead = false;

  constructor(private readonly view: EditorView) {
    const path = view.state.facet(pathFacet);
    current = { path, view };
    this.decorations = buildLine(view.state, path);
    if (pendingReveal && location && location.path === path && this.decorations !== Decoration.none) {
      pendingReveal = false;
      queueMicrotask(() => { if (!this.dead) this.reveal(); });
    }
  }

  update(u: ViewUpdate): void {
    const path = u.state.facet(pathFacet);
    if (u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)))) this.decorations = buildLine(u.state, path);
    else if (u.docChanged) this.decorations = this.decorations.map(u.changes);
  }

  reveal(): void {
    const path = this.view.state.facet(pathFacet);
    if (!location || location.path !== path || location.line > this.view.state.doc.lines) return;
    const at = this.view.state.doc.line(Math.max(1, location.line)).from;
    this.view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'center' }) });
  }

  destroy(): void {
    this.dead = true;
    if (current && current.view === this.view && current.path === this.view.state.facet(pathFacet)) current = null;
  }
}

const locator = ViewPlugin.fromClass(Locator, { decorations: (p) => p.decorations });

const syncListener = EditorView.updateListener.of((u) => {
  const before = u.startState.field(markerField, false);
  const after = u.state.field(markerField, false);
  if (!after || before === after) return;
  commit(u.state.facet(pathFacet), listOf(u.state, after));
});

export function breakpointExtension(path: string): Extension {
  return [
    pathFacet.of(path),
    markerField,
    editField,
    gutter({
      class: 'cv-bp-gutter',
      renderEmptyElements: true,
      markers: (view) => view.state.field(markerField),
      initialSpacer: () => spacer,
      domEventHandlers: {
        mousedown(view, block, event) {
          const e = event as MouseEvent;
          if (e.button !== 0 || e.ctrlKey) return false;
          view.dispatch({ effects: toggleEffect.of(view.state.doc.lineAt(block.from).from) });
          return true;
        },
        contextmenu(view, block, event) {
          const e = event as MouseEvent;
          e.preventDefault();
          e.stopPropagation();
          showMenu(view, view.state.doc.lineAt(block.from).from, e.clientX, e.clientY);
          return true;
        },
      },
    }),
    locator,
    syncListener,
  ];
}

export function toggleBreakpointAtCursor(): boolean {
  if (!current) return false;
  const { view } = current;
  const at = view.state.doc.lineAt(view.state.selection.main.head).from;
  view.dispatch({ effects: toggleEffect.of(at) });
  return true;
}

export function editBreakpointAtCursor(mode: BreakpointMode): boolean {
  if (!current) return false;
  const { view } = current;
  openEdit(view, view.state.doc.lineAt(view.state.selection.main.head).from, mode);
  return true;
}

export function setDebugLocation(next: DebugLocation | null): void {
  location = next;
  pendingReveal = next !== null;
  if (!current) return;
  const { view, path } = current;
  view.dispatch({ effects: refreshEffect.of(null) });
  if (next && next.path === path) {
    pendingReveal = false;
    const doc = view.state.doc;
    if (next.line >= 1 && next.line <= doc.lines) view.dispatch({ effects: EditorView.scrollIntoView(doc.line(next.line).from, { y: 'center' }) });
  }
}

export function activeBreakpointPath(): string | null {
  return current?.path ?? null;
}
