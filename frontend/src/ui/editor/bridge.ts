const EDITOR = '.cv-editor-host .cm-editor';
const KEEP = '.cv-menu, .cv-menubar, .cv-title-tools, .cv-search-pop';

let last = false;

function inEditor(node: EventTarget | null): boolean {
  return node instanceof Element && !!node.closest(EDITOR);
}

export function editorFocused(): boolean {
  return inEditor(document.activeElement);
}

export function editorWasFocused(): boolean {
  return last;
}

export function trackEditorFocus(): void {
  document.addEventListener('focusin', (e) => {
    if (inEditor(e.target)) { last = true; return; }
    if (e.target instanceof Element && e.target.closest(KEEP)) return;
    last = false;
  }, true);
}
