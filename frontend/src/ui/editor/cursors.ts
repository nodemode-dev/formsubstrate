import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, rectangularSelection } from '@codemirror/view';

const columnKeys = (e: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean => e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;

const crosshair = ViewPlugin.fromClass(class {
  private on = false;
  private readonly sync: (e: KeyboardEvent | MouseEvent) => void;
  private readonly clear: () => void;

  constructor(private readonly view: EditorView) {
    this.sync = (e) => this.set(columnKeys(e));
    this.clear = () => this.set(false);
    window.addEventListener('keydown', this.sync, true);
    window.addEventListener('keyup', this.sync, true);
    view.dom.addEventListener('mousemove', this.sync);
    window.addEventListener('blur', this.clear);
  }

  private set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.view.contentDOM.classList.toggle('cv-crosshair', on);
  }

  destroy(): void {
    this.set(false);
    window.removeEventListener('keydown', this.sync, true);
    window.removeEventListener('keyup', this.sync, true);
    this.view.dom.removeEventListener('mousemove', this.sync);
    window.removeEventListener('blur', this.clear);
  }
});

const crosshairTheme = EditorView.theme({ '.cm-content.cv-crosshair': { cursor: 'crosshair' } });

export const multiCursor: Extension = [
  EditorState.allowMultipleSelections.of(true),
  EditorView.clickAddsSelectionRange.of((e) => e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey),
  rectangularSelection({ eventFilter: (e) => columnKeys(e) }),
  crosshair,
  crosshairTheme,
];
