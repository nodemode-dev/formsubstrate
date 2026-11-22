import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { languageFor } from '../../ui/editor/languages';
import { editorHighlight, editorTheme } from '../../ui/editor/theme';
import { setClass } from '../../ui/dom';
import { t } from '../../ui/i18n';

const COLLAPSE = { margin: 3, minSize: 6 };

export interface MountedDiff { destroy(): void }

export function mountDiff(parent: HTMLElement, path: string, before: string, after: string): MountedDiff {
  const resolved = languageFor(path);
  const lang = new Compartment();
  setClass(parent, 'is-measuring', true);
  const view = new EditorView({
    parent,
    doc: after,
    extensions: [
      lineNumbers(),
      syntaxHighlighting(editorHighlight),
      editorTheme,
      EditorState.phrases.of({ '$ unchanged lines': `$ ${t('unchanged lines')}`, 'Collapsed lines': t('Collapsed lines') }),
      lang.of(resolved.now),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      unifiedMergeView({ original: before, mergeControls: false, gutter: true, highlightChanges: true, syntaxHighlightDeletions: true, collapseUnchanged: COLLAPSE }),
    ],
  });
  let live = true;
  view.requestMeasure({ read: () => null, write: () => { requestAnimationFrame(() => setClass(parent, 'is-measuring', false)); } });
  void resolved.later.then((ext) => { if (ext && live) view.dispatch({ effects: lang.reconfigure(ext) }); });
  return { destroy: () => { live = false; view.destroy(); } };
}
