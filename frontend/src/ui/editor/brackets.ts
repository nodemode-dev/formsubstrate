import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

type Tree = ReturnType<typeof syntaxTree>;
type SyntaxNode = ReturnType<Tree['resolveInner']>;

const LEVELS = 3;
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
const marks = Array.from({ length: LEVELS }, (_, i) => Decoration.mark({ class: `cv-br cv-br-${i + 1}` }));

function opensAt(node: SyntaxNode, before: number): boolean {
  const first = node.firstChild;
  if (!first) return false;
  if (OPEN.has(first.name) && first.from <= before) return true;
  const second = first.nextSibling;
  return !!second && OPEN.has(second.name) && second.from <= before;
}

function depthAt(tree: Tree, pos: number): number {
  let node: SyntaxNode | null = tree.resolveInner(pos, 1);
  while (node && node.from >= pos) node = node.parent;
  let depth = 0;
  for (; node; node = node.parent) if (opensAt(node, pos - 1)) depth++;
  return depth;
}

function build(view: EditorView, tree: Tree): DecorationSet {
  const out = new RangeSetBuilder<Decoration>();
  if (tree.length === 0) return out.finish();
  for (const { from, to } of view.visibleRanges) {
    const end = Math.min(to, tree.length);
    if (end <= from) continue;
    let depth = depthAt(tree, from);
    tree.iterate({
      from,
      to: end,
      enter: (n) => {
        if (n.from < from || n.to - n.from !== 1) return;
        if (OPEN.has(n.name)) {
          depth++;
          out.add(n.from, n.to, marks[(depth - 1) % LEVELS]);
        } else if (CLOSE.has(n.name)) {
          if (depth > 0) out.add(n.from, n.to, marks[(depth - 1) % LEVELS]);
          depth = Math.max(0, depth - 1);
        }
      },
    });
  }
  return out.finish();
}

const bracketPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private tree: Tree;
    constructor(view: EditorView) {
      this.tree = syntaxTree(view.state);
      this.decorations = build(view, this.tree);
    }
    update(u: ViewUpdate): void {
      const tree = syntaxTree(u.state);
      if (!u.docChanged && !u.viewportChanged && tree === this.tree) return;
      this.tree = tree;
      this.decorations = build(u.view, tree);
    }
  },
  { decorations: (v) => v.decorations },
);

const bracketTheme = EditorView.theme({
  '.cv-br-1, .cv-br-1 > span': { color: 'var(--syn-bracket-1)' },
  '.cv-br-2, .cv-br-2 > span': { color: 'var(--syn-bracket-2)' },
  '.cv-br-3, .cv-br-3 > span': { color: 'var(--syn-bracket-3)' },
});

export const bracketColors: Extension = [bracketPlugin, bracketTheme];
