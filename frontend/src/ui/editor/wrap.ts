import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

const MAX_INDENT = 80;
const WIDTH_SHARE = 0.4;
const decos = new Map<number, Decoration>();

function indentOf(text: string, tab: number): number {
  let n = 0;
  for (const c of text) {
    if (c === ' ') n++;
    else if (c === '\t') n += tab - (n % tab);
    else break;
    if (n >= MAX_INDENT) return MAX_INDENT;
  }
  return n;
}

function decoFor(n: number): Decoration {
  let d = decos.get(n);
  if (!d) {
    d = Decoration.line({ class: 'cv-wrap-line', attributes: { style: `--cv-wrap-indent: ${n}ch` } });
    decos.set(n, d);
  }
  return d;
}

function build(view: EditorView): DecorationSet {
  const out = new RangeSetBuilder<Decoration>();
  const tab = view.state.tabSize;
  const room = Math.floor((view.contentDOM.clientWidth * WIDTH_SHARE) / Math.max(1, view.defaultCharacterWidth));
  const cap = room > 0 ? room : MAX_INDENT;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const n = Math.min(indentOf(line.text, tab), cap);
      if (n > 0 && n < line.length + tab) out.add(line.from, line.from, decoFor(n));
      pos = line.to + 1;
    }
  }
  return out.finish();
}

const hangingIndent = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || u.geometryChanged || u.startState.tabSize !== u.state.tabSize) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export const wordWrap: Extension = [EditorView.lineWrapping, hangingIndent];
