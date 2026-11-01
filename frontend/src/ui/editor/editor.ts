import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, type ViewUpdate } from '@codemirror/view';
import { EditorState, Compartment, type StateEffect, type Extension, type Text, type TransactionSpec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, selectAll, undo } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, openSearchPanel, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { el, q, setHidden, setStyleVar, setText } from '../dom';
import { t } from '../i18n';
import { confirmAction } from '../dialogs';
import { baseName, languageFor } from './languages';
import { editorHighlight, editorTheme } from './theme';
import { wordWrap } from './wrap';
import { breakpointExtension } from './breakpoints';

export interface EditorDeps {
  load(path: string): Promise<{ text: string; mtime: number }>;
  save(path: string, text: string, expectedMtime: number | null): Promise<{ mtime: number }>;
  onDirty(path: string, dirty: boolean): void;
  onStatus(text: string): void;
}

type ScrollSnapshot = ReturnType<EditorView['scrollSnapshot']>;

interface EditorOptions { fontSize: number; tabSize: number; wordWrap: boolean }

interface Doc {
  path: string;
  state: EditorState;
  saved: Text;
  mtime: number | null;
  eol: string;
  dirty: boolean;
  scroll: ScrollSnapshot | null;
  optsRev: number;
  lang: Compartment;
  opts: Compartment;
  wrap: Compartment;
  extra: Compartment;
  dbg: Compartment;
}

const BINARY_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'mp3', 'wav', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov', 'mkv', 'zip', 'gz', 'tar', 'pdf', 'woff', 'woff2', 'ttf', 'otf', 'exe', 'dll', 'so', 'dylib', 'wasm', 'bin']);

const dominantEol = (text: string): string => {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
};

const searchPhrases = (): Record<string, string> => ({
  Find: t('Find'),
  Replace: t('Replace'),
  next: t('next'),
  previous: t('previous'),
  all: t('all'),
  'match case': t('match case'),
  regexp: t('regexp'),
  'by word': t('by word'),
  replace: t('replace'),
  'replace all': t('replace all'),
  close: t('close'),
  'Go to line': t('Go to line'),
  go: t('go'),
});

export class EditorHost {
  extensionsFor: (path: string) => Extension[] = () => [];
  onClosed: (path: string) => void = () => undefined;

  private readonly root: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly mount: HTMLElement;
  private readonly view: EditorView;
  private readonly docs = new Map<string, Doc>();
  private readonly loading = new Map<string, Promise<Doc | null>>();
  private current: Doc | null = null;
  private showSeq = 0;
  private optsRev = 0;
  private options: EditorOptions = { fontSize: 13, tabSize: 4, wordWrap: true };
  private lastPos = '';

  constructor(host: HTMLElement, private readonly deps: EditorDeps) {
    this.root = el<HTMLElement>(`<div class="cv-editor"><div class="cv-editor-mount"></div><div class="cv-editor-empty"><span class="cv-editor-empty-text"></span></div></div>`);
    host.append(this.root);
    this.mount = q<HTMLElement>(this.root, '.cv-editor-mount');
    this.empty = q<HTMLElement>(this.root, '.cv-editor-empty');
    setText(q(this.empty, '.cv-editor-empty-text'), t('No file open'));
    setStyleVar(this.root, '--cv-editor-fs', `${this.options.fontSize}px`);
    this.view = new EditorView({ parent: this.mount, state: this.blankState() });
    setHidden(this.mount, true);
  }

  private blankState(): EditorState {
    return EditorState.create({ doc: '', extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false), editorTheme] });
  }

  private optionsExt(): Extension {
    return [EditorState.tabSize.of(this.options.tabSize), indentUnit.of(' '.repeat(this.options.tabSize))];
  }

  private wrapExt(): Extension {
    return this.options.wordWrap ? wordWrap : [];
  }

  private buildState(d: Doc, text: string, lang: Extension): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        d.dbg.of(breakpointExtension(d.path)),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        dropCursor(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightSelectionMatches(),
        EditorState.phrases.of(searchPhrases()),
        d.wrap.of(this.wrapExt()),
        d.opts.of(this.optionsExt()),
        d.lang.of(lang),
        d.extra.of(this.extensionsFor(d.path)),
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { void this.save(d.path); return true; } },
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
          ...defaultKeymap,
        ]),
        syntaxHighlighting(editorHighlight),
        editorTheme,
        EditorView.updateListener.of((u) => this.onUpdate(d, u)),
      ],
    });
  }

  private onUpdate(d: Doc, u: ViewUpdate): void {
    if (this.current !== d) return;
    if (u.docChanged) this.syncDirty(d, u.state.doc);
    if (u.docChanged || u.selectionSet) this.reportPosition(u.state);
  }

  private syncDirty(d: Doc, doc: Text): void {
    const dirty = !doc.eq(d.saved);
    if (dirty === d.dirty) return;
    d.dirty = dirty;
    this.deps.onDirty(d.path, dirty);
  }

  private reportPosition(state: EditorState): void {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const text = `${t('Ln')} ${line.number}, ${t('Col')} ${head - line.from + 1}`;
    if (text === this.lastPos) return;
    this.lastPos = text;
    this.deps.onStatus(text);
  }

  private liveState(d: Doc): EditorState {
    return this.current === d ? this.view.state : d.state;
  }

  private dispatchTo(d: Doc, effects: StateEffect<unknown>[]): void {
    if (this.current === d) this.view.dispatch({ effects });
    else d.state = d.state.update({ effects }).state;
  }

  private syncOptions(d: Doc): void {
    if (d.optsRev === this.optsRev) return;
    d.optsRev = this.optsRev;
    this.dispatchTo(d, [d.opts.reconfigure(this.optionsExt()), d.wrap.reconfigure(this.wrapExt())]);
  }

  private docText(d: Doc): string {
    const doc = this.liveState(d).doc;
    return doc.sliceString(0, doc.length, d.eol);
  }

  private async create(path: string): Promise<Doc | null> {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    if (BINARY_EXT.has(ext)) {
      this.deps.onStatus(`${baseName(path)}: ${t('binary files cannot be edited here')}`);
      return null;
    }
    let loaded: { text: string; mtime: number };
    try { loaded = await this.deps.load(path); } catch (e) {
      this.deps.onStatus(`${t('Cannot open')} ${baseName(path)}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    const d: Doc = {
      path, state: this.blankState(), saved: this.blankState().doc, mtime: loaded.mtime, eol: dominantEol(loaded.text),
      dirty: false, scroll: null, optsRev: this.optsRev,
      lang: new Compartment(), opts: new Compartment(), wrap: new Compartment(), extra: new Compartment(), dbg: new Compartment(),
    };
    const resolved = languageFor(path);
    d.state = this.buildState(d, loaded.text, resolved.now);
    d.saved = d.state.doc;
    this.docs.set(path, d);
    void resolved.later.then((lang) => {
      if (lang && this.docs.get(path) === d) this.dispatchTo(d, [d.lang.reconfigure(lang)]);
    });
    return d;
  }

  private ensure(path: string): Promise<Doc | null> {
    const have = this.docs.get(path);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(path);
    if (!p) {
      p = this.create(path).finally(() => { this.loading.delete(path); });
      this.loading.set(path, p);
    }
    return p;
  }

  private swapTo(d: Doc): void {
    if (this.current === d) return;
    const prev = this.current;
    if (prev) {
      prev.state = this.view.state;
      prev.scroll = this.view.scrollSnapshot();
    }
    this.current = d;
    this.syncOptions(d);
    this.view.setState(d.state);
    if (d.scroll) this.view.dispatch({ effects: d.scroll });
    setHidden(this.mount, false);
    setHidden(this.empty, true);
    this.lastPos = '';
    this.reportPosition(this.view.state);
  }

  private showEmpty(): void {
    this.current = null;
    this.view.setState(this.blankState());
    setHidden(this.mount, true);
    setHidden(this.empty, false);
  }

  async open(path: string, line?: number, col?: number): Promise<boolean> {
    const seq = ++this.showSeq;
    const d = await this.ensure(path);
    if (!d || seq !== this.showSeq) return false;
    this.swapTo(d);
    if (line !== undefined) this.placeCursor(line, col);
    return true;
  }

  show(path: string): void {
    const d = this.docs.get(path);
    if (d) {
      this.showSeq++;
      this.swapTo(d);
      return;
    }
    void this.open(path);
  }

  close(path: string): void {
    const d = this.docs.get(path);
    if (!d) return;
    this.docs.delete(path);
    if (this.current === d) this.showEmpty();
    this.onClosed(path);
  }

  runCommand(command: (view: EditorView) => boolean): boolean {
    if (!this.current) return false;
    this.view.focus();
    return command(this.view);
  }

  transact(path: string, spec: TransactionSpec): void {
    const d = this.docs.get(path);
    if (!d) return;
    if (this.current === d) this.view.dispatch(spec);
    else {
      d.state = d.state.update(spec).state;
      this.syncDirty(d, d.state.doc);
    }
  }

  private placeCursor(line: number, col?: number): void {
    const doc = this.view.state.doc;
    const ln = doc.line(Math.max(1, Math.min(Math.floor(line), doc.lines)));
    const at = Math.min(ln.from + Math.max(0, Math.floor(col ?? 1) - 1), ln.to);
    this.view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
    this.view.focus();
  }

  async revealLine(path: string, line: number, col?: number): Promise<void> {
    const d = this.docs.get(path);
    if (d && this.current === d) { this.placeCursor(line, col); return; }
    await this.open(path, line, col);
  }

  isDirty(path: string): boolean {
    return this.docs.get(path)?.dirty ?? false;
  }

  dirtyPaths(): string[] {
    return [...this.docs.values()].filter((d) => d.dirty).map((d) => d.path);
  }

  async save(path?: string): Promise<boolean> {
    const d = path === undefined ? this.current : this.docs.get(path);
    if (!d) return false;
    const snapshot = this.liveState(d).doc;
    const text = snapshot.sliceString(0, snapshot.length, d.eol);
    try {
      const r = await this.deps.save(d.path, text, d.mtime);
      return this.commitSave(d, snapshot, r.mtime);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.startsWith('409')) {
        this.deps.onStatus(`${t('Save failed')}: ${baseName(d.path)}: ${msg}`);
        return false;
      }
      return this.resolveConflict(d, snapshot, text);
    }
  }

  private commitSave(d: Doc, snapshot: Text, mtime: number): boolean {
    d.saved = snapshot;
    d.mtime = mtime;
    this.syncDirty(d, this.liveState(d).doc);
    this.deps.onStatus(`${t('Saved')} ${baseName(d.path)}`);
    return true;
  }

  private async resolveConflict(d: Doc, snapshot: Text, text: string): Promise<boolean> {
    const overwrite = await confirmAction(
      t('Save conflict'),
      `${baseName(d.path)} ${t('changed on disk since it was opened. Overwrite the disk copy with your text, or reload the disk copy (your text stays in undo history).')}`,
      t('Overwrite'), true, t('Reload'));
    if (overwrite) {
      try {
        const r = await this.deps.save(d.path, text, null);
        return this.commitSave(d, snapshot, r.mtime);
      } catch (e) {
        this.deps.onStatus(`${t('Save failed')}: ${baseName(d.path)}: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    }
    await this.reloadFromDisk(d);
    return false;
  }

  private async reloadFromDisk(d: Doc): Promise<void> {
    let fresh: { text: string; mtime: number };
    try { fresh = await this.deps.load(d.path); } catch (e) {
      this.deps.onStatus(`${t('Cannot open')} ${baseName(d.path)}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const doc = this.liveState(d).doc;
    const change = { from: 0, to: doc.length, insert: fresh.text };
    if (this.current === d) this.view.dispatch({ changes: change, userEvent: 'input.reload' });
    else d.state = d.state.update({ changes: change, userEvent: 'input.reload' }).state;
    d.eol = dominantEol(fresh.text);
    d.saved = this.liveState(d).doc;
    d.mtime = fresh.mtime;
    this.syncDirty(d, d.saved);
    this.deps.onStatus(`${t('Reloaded')} ${baseName(d.path)}`);
  }

  async saveAll(): Promise<number> {
    let n = 0;
    for (const path of this.dirtyPaths()) if (await this.save(path)) n++;
    return n;
  }

  setOptions(o: { fontSize?: number; tabSize?: number; wordWrap?: boolean }): void {
    const next = { ...this.options };
    if (o.fontSize !== undefined && Number.isFinite(o.fontSize)) next.fontSize = Math.min(32, Math.max(8, o.fontSize));
    if (o.tabSize !== undefined && Number.isFinite(o.tabSize)) next.tabSize = Math.min(8, Math.max(1, Math.round(o.tabSize)));
    if (o.wordWrap !== undefined) next.wordWrap = o.wordWrap;
    const layoutChanged = next.tabSize !== this.options.tabSize || next.wordWrap !== this.options.wordWrap;
    const sizeChanged = next.fontSize !== this.options.fontSize;
    this.options = next;
    if (sizeChanged) {
      setStyleVar(this.root, '--cv-editor-fs', `${next.fontSize}px`);
      this.view.requestMeasure();
    }
    if (!layoutChanged) return;
    this.optsRev++;
    if (this.current) this.syncOptions(this.current);
  }

  refreshExtensions(path: string): void {
    const d = this.docs.get(path);
    if (d) this.dispatchTo(d, [d.extra.reconfigure(this.extensionsFor(path))]);
  }

  focus(): void {
    if (this.current) this.view.focus();
  }

  get hasDoc(): boolean { return this.current !== null; }

  edit(action: string): void {
    if (!this.current) return;
    const view = this.view;
    view.focus();
    if (action === 'undo') undo(view);
    else if (action === 'redo') redo(view);
    else if (action === 'select-all') selectAll(view);
    else if (action === 'copy' || action === 'cut') document.execCommand(action);
    else if (action === 'paste') {
      navigator.clipboard.readText().then((text) => {
        if (this.current && text) view.dispatch({ ...view.state.replaceSelection(text), userEvent: 'input.paste', scrollIntoView: true });
      }, () => { this.deps.onStatus(t('Paste was blocked; use the keyboard shortcut')); });
    }
  }

  find(): void {
    if (!this.current) return;
    this.view.focus();
    openSearchPanel(this.view);
  }

  selectNext(): void {
    if (!this.current) return;
    this.view.focus();
    selectNextOccurrence(this.view);
  }

  selectAllOccurrences(): void {
    if (!this.current) return;
    this.view.focus();
    selectSelectionMatches(this.view);
  }
}
