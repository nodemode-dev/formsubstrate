import { StateField, Transaction, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { onLanguage, t } from '../i18n';

export interface ConflictBlock { open: number; base: number; sep: number; close: number; end: number; ours: string; theirs: string }

export type ConflictSide = 'ours' | 'theirs' | 'both';

interface Conflicts { blocks: readonly ConflictBlock[]; deco: DecorationSet }

const OPEN = /^<{7}(?:[ \t]|$)/;
const BASE = /^\|{7}(?:[ \t]|$)/;
const SEP = /^={7}[ \t]*$/;
const CLOSE = /^>{7}(?:[ \t]|$)/;
const LOOSE = /^(?:<{7}|\|{7}|={7}|>{7})/;
const MARK_CHARS = new Set([60, 124, 61, 62]);

let lineHeight = 20;

const labelOf = (text: string): string => text.slice(7).trim();

function scan(doc: Text): ConflictBlock[] {
  const out: ConflictBlock[] = [];
  let open = -1, base = -1, sep = -1, ours = '', pos = 0;
  const it = doc.iterLines();
  for (let r = it.next(); !r.done; r = it.next()) {
    const line = r.value;
    const from = pos;
    pos += line.length + 1;
    if (!MARK_CHARS.has(line.charCodeAt(0))) continue;
    if (OPEN.test(line)) { open = from; base = -1; sep = -1; ours = labelOf(line); continue; }
    if (open < 0) continue;
    if (sep < 0 && base < 0 && BASE.test(line)) { base = from; continue; }
    if (sep < 0 && SEP.test(line)) { sep = from; continue; }
    if (sep >= 0 && CLOSE.test(line)) {
      out.push({ open, base, sep, close: from, end: from + line.length, ours, theirs: labelOf(line) });
      open = -1;
    }
  }
  return out;
}

const line = (cls: string): Decoration => Decoration.line({ class: cls });
const HEAD_OURS = line('cm-conflict-marker cm-conflict-current-marker');
const BODY_OURS = line('cm-conflict-current');
const HEAD_BASE = line('cm-conflict-marker cm-conflict-base-marker');
const BODY_BASE = line('cm-conflict-base');
const SEP_LINE = line('cm-conflict-marker cm-conflict-sep');
const BODY_THEIRS = line('cm-conflict-incoming');
const HEAD_THEIRS = line('cm-conflict-marker cm-conflict-incoming-marker');

const sideLabel = (text: string, name: string): string => (name ? `${text} (${name})` : text);

class ConflictActions extends WidgetType {
  constructor(readonly ours: string, readonly theirs: string) { super(); }

  eq(other: ConflictActions): boolean { return other.ours === this.ours && other.theirs === this.theirs; }

  get estimatedHeight(): number { return lineHeight; }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div');
    box.className = 'cm-conflict-actions';
    box.setAttribute('role', 'toolbar');
    const add = (side: ConflictSide): HTMLButtonElement => {
      if (box.childElementCount) {
        const dot = document.createElement('span');
        dot.className = 'cm-conflict-dot';
        dot.setAttribute('aria-hidden', 'true');
        dot.textContent = '|';
        box.append(dot);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cm-conflict-act';
      b.dataset.side = side;
      box.append(b);
      return b;
    };
    const ours = add('ours'), theirs = add('theirs'), both = add('both');
    const paint = (): void => {
      box.setAttribute('aria-label', t('Merge conflict'));
      ours.textContent = sideLabel(t('Accept Current Change'), this.ours);
      ours.title = t('Keep the current side and drop the incoming side');
      theirs.textContent = sideLabel(t('Accept Incoming Change'), this.theirs);
      theirs.title = t('Keep the incoming side and drop the current side');
      both.textContent = t('Accept Both Changes');
      both.title = t('Keep the current side, then the incoming side');
    };
    paint();
    unpaint.set(box, onLanguage(paint));
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      const side = e.target instanceof Element ? e.target.closest<HTMLElement>('.cm-conflict-act')?.dataset.side : undefined;
      if (side !== 'ours' && side !== 'theirs' && side !== 'both') return;
      acceptConflict(view, view.posAtDOM(box), side);
    });
    return box;
  }

  destroy(dom: HTMLElement): void {
    unpaint.get(dom)?.();
    unpaint.delete(dom);
  }

  ignoreEvent(): boolean { return true; }
}

const unpaint = new WeakMap<HTMLElement, () => void>();

function decorate(doc: Text, b: ConflictBlock, out: Range<Decoration>[]): void {
  out.push(Decoration.widget({ widget: new ConflictActions(b.ours, b.theirs), block: true, side: -1 }).range(b.open));
  const first = doc.lineAt(b.open).number;
  const mid = b.base >= 0 ? doc.lineAt(b.base).number : -1;
  const sep = doc.lineAt(b.sep).number;
  const last = doc.lineAt(b.close).number;
  for (let n = first; n <= last; n++) {
    const deco = n === first ? HEAD_OURS
      : n === mid ? HEAD_BASE
        : n === sep ? SEP_LINE
          : n === last ? HEAD_THEIRS
            : mid > 0 && n > mid && n < sep ? BODY_BASE
              : n < sep ? BODY_OURS : BODY_THEIRS;
    out.push(deco.range(doc.line(n).from));
  }
}

function build(doc: Text, blocks: readonly ConflictBlock[]): DecorationSet {
  const out: Range<Decoration>[] = [];
  for (const b of blocks) decorate(doc, b, out);
  return Decoration.set(out, true);
}

function touchesMarker(doc: Text, from: number, to: number): boolean {
  let n = doc.lineAt(from).number;
  const last = doc.lineAt(to).number;
  for (; n <= last; n++) if (LOOSE.test(doc.line(n).text)) return true;
  return false;
}

function update(value: Conflicts, tr: Transaction): Conflicts {
  if (!tr.docChanged) return value;
  const before = tr.startState.doc, doc = tr.newDoc;
  let marker = false, a = doc.length, b = 0;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (!marker && (touchesMarker(before, fromA, toA) || touchesMarker(doc, fromB, toB))) marker = true;
    a = Math.min(a, fromB);
    b = Math.max(b, toB);
  });
  if (marker) {
    const blocks = scan(doc);
    return { blocks, deco: build(doc, blocks) };
  }
  if (!value.blocks.length) return value;
  const lo = doc.lineAt(a).from, hi = doc.lineAt(b).to;
  const map = (p: number): number => (p < 0 ? p : tr.changes.mapPos(p));
  const blocks = value.blocks.map((x) => ({ ...x, open: map(x.open), base: map(x.base), sep: map(x.sep), close: map(x.close), end: map(x.end) }));
  const dirty = blocks.filter((x) => x.open <= hi && x.end >= lo);
  let deco = value.deco.map(tr.changes);
  if (dirty.length) {
    const from = dirty[0].open, to = dirty[dirty.length - 1].end;
    const add: Range<Decoration>[] = [];
    for (const x of dirty) decorate(doc, x, add);
    deco = deco.update({ filterFrom: from, filterTo: to, filter: (f) => f < from || f > to, add, sort: true });
  }
  return { blocks, deco };
}

export const conflictField = StateField.define<Conflicts>({
  create: (state) => {
    const blocks = scan(state.doc);
    return { blocks, deco: build(state.doc, blocks) };
  },
  update,
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export function conflictBlocks(view: EditorView): readonly ConflictBlock[] {
  return view.state.field(conflictField, false)?.blocks ?? [];
}

export function acceptConflict(view: EditorView, at: number, side: ConflictSide): boolean {
  const blocks = conflictBlocks(view);
  const b = blocks.find((x) => x.open === at) ?? blocks.find((x) => x.open <= at && at <= x.end);
  if (!b) return false;
  const doc = view.state.doc;
  const openLine = doc.lineAt(b.open), sepLine = doc.lineAt(b.sep), closeLine = doc.lineAt(b.close);
  const ours = doc.sliceString(openLine.to + 1, b.base >= 0 ? b.base : b.sep);
  const theirs = doc.sliceString(sepLine.to + 1, b.close);
  let insert = side === 'ours' ? ours : side === 'theirs' ? theirs : ours + theirs;
  let from = b.open, to = closeLine.to;
  if (to < doc.length) to += 1;
  else if (insert.endsWith('\n')) insert = insert.slice(0, -1);
  else if (!insert && from > 0) from -= 1;
  view.dispatch({
    changes: { from, to, insert },
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('conflict.accept')],
  });
  return true;
}

const heightTracker = ViewPlugin.define((view) => {
  lineHeight = view.defaultLineHeight || lineHeight;
  return { update: (u) => { lineHeight = u.view.defaultLineHeight || lineHeight; } };
});

export const conflicts: Extension = [conflictField, heightTracker];
