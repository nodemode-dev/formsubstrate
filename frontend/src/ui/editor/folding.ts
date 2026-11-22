import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { StreamLanguage, codeFolding, foldGutter, foldKeymap, foldService, language } from '@codemirror/language';
import { icon } from '../icons';
import { t } from '../i18n';

const INDENT_SCAN_LINES = 20000;

function indentWidth(text: string, tab: number): number {
  let n = 0;
  for (const c of text) {
    if (c === ' ') n++;
    else if (c === '\t') n += tab - (n % tab);
    else return n;
  }
  return -1;
}

const indentFolding = foldService.of((state, lineStart, lineEnd) => {
  const lang = state.facet(language);
  if (lang && !(lang instanceof StreamLanguage)) return null;
  const doc = state.doc, tab = state.tabSize;
  const first = doc.lineAt(lineStart);
  const base = indentWidth(first.text, tab);
  if (base < 0) return null;
  let last = first.number;
  const stop = Math.min(doc.lines, first.number + INDENT_SCAN_LINES);
  for (let n = first.number + 1; n <= stop; n++) {
    const w = indentWidth(doc.line(n).text, tab);
    if (w < 0) continue;
    if (w <= base) break;
    last = n;
  }
  if (last === first.number) return null;
  return { from: lineEnd, to: doc.line(last).to };
});

function marker(open: boolean): HTMLElement {
  const node = document.createElement('span');
  node.className = open ? 'cv-fold cv-fold-open' : 'cv-fold cv-fold-closed';
  node.title = t(open ? 'Fold line' : 'Unfold line');
  node.innerHTML = icon(open ? 'chevronDown' : 'chevronRight', 14);
  return node;
}

const foldTheme = EditorView.theme({
  '.cm-foldGutter .cm-gutterElement': { padding: '0 var(--space-1) 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  '.cm-foldGutter .cv-fold': { display: 'inline-flex', width: 'var(--space-3h)', height: 'var(--space-3h)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 'var(--radius-xs)' },
  '.cm-foldGutter .cv-fold:hover': { color: 'var(--text-primary)', backgroundColor: 'var(--bg-hover)' },
  '.cm-foldGutter .cv-fold-open': { opacity: '0', transition: 'opacity 120ms ease' },
  '.cm-gutters:hover .cm-foldGutter .cv-fold-open': { opacity: '1' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-hover)', color: 'var(--text-muted)', border: '1px solid var(--line-1)', borderRadius: 'var(--radius-sm)', padding: '0 var(--space-1)', margin: '0 var(--space-0)', fontFamily: 'var(--font-code)', cursor: 'pointer' },
  '.cm-foldPlaceholder:hover': { color: 'var(--text-primary)', borderColor: 'var(--accent-line)' },
});

export const folding = (): Extension => [
  indentFolding,
  codeFolding(),
  foldGutter({ markerDOM: marker }),
  keymap.of(foldKeymap),
  foldTheme,
  EditorState.phrases.of({ 'Fold line': t('Fold line'), 'Unfold line': t('Unfold line'), 'folded code': t('folded code'), unfold: t('unfold') }),
];
