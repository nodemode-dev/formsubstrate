import { Facet, RangeSet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, ViewPlugin, gutter, type DecorationSet, type ViewUpdate } from '@codemirror/view';

export interface DebugLocation { path: string; line: number }

class Dot extends GutterMarker {
  toDOM(): Node {
    const node = document.createElement('span');
    node.className = 'cv-bp-dot';
    return node;
  }
}

const dot = new Dot();
const lineDeco = Decoration.line({ class: 'cv-debug-line' });
const toggleEffect = StateEffect.define<number>();
const refreshEffect = StateEffect.define<null>();
const pathFacet = Facet.define<string, string>({ combine: (values) => values[0] ?? '' });

const stored = new Map<string, number[]>();
const watchers = new Set<(path: string) => void>();
let location: DebugLocation | null = null;
let pendingReveal = false;
let current: { path: string; view: EditorView } | null = null;

export function breakpointsOf(path: string): number[] {
  return [...(stored.get(path) ?? [])];
}

export function breakpointPaths(): string[] {
  return [...stored.entries()].filter(([, lines]) => lines.length > 0).map(([path]) => path);
}

export function onBreakpoints(fn: (path: string) => void): () => void {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}

function commit(path: string, lines: number[]): void {
  const next = [...new Set(lines)].sort((a, b) => a - b);
  const prev = stored.get(path) ?? [];
  if (next.length === prev.length && next.every((n, i) => n === prev[i])) return;
  if (next.length) stored.set(path, next); else stored.delete(path);
  for (const fn of Array.from(watchers)) fn(path);
}

function linesOf(state: EditorState, set: RangeSet<GutterMarker>): number[] {
  const out: number[] = [];
  set.between(0, state.doc.length, (from) => { out.push(state.doc.lineAt(from).number); });
  return out;
}

const markerField = StateField.define<RangeSet<GutterMarker>>({
  create(state) {
    const lines = stored.get(state.facet(pathFacet)) ?? [];
    const marks = lines.filter((n) => n >= 1 && n <= state.doc.lines).map((n) => dot.range(state.doc.line(n).from));
    return RangeSet.of(marks, true);
  },
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(toggleEffect)) continue;
      const pos = e.value;
      let present = false;
      next.between(pos, pos, () => { present = true; });
      next = present ? next.update({ filter: (from) => from !== pos }) : next.update({ add: [dot.range(pos)] });
    }
    return next;
  },
});

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
  commit(u.state.facet(pathFacet), linesOf(u.state, after));
});

export function breakpointExtension(path: string): Extension {
  return [
    pathFacet.of(path),
    markerField,
    gutter({
      class: 'cv-bp-gutter',
      renderEmptyElements: true,
      markers: (view) => view.state.field(markerField),
      initialSpacer: () => dot,
      domEventHandlers: {
        mousedown(view, block) {
          view.dispatch({ effects: toggleEffect.of(view.state.doc.lineAt(block.from).from) });
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
