import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, type ViewUpdate } from '@codemirror/view';
import { EditorState, Compartment, type ChangeSpec, type StateEffect, type Extension, type Text, type TransactionSpec } from '@codemirror/state';
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
import { bracketColors } from './brackets';
import { multiCursor } from './cursors';
import { folding } from './folding';
import { lsp } from './lsp';
import { EDITOR_PREFS_EVENT, loadPrefs } from '../prefs';
import { toast } from '../toast';

export interface EditorDeps {
  load(path: string): Promise<{ text: string; mtime: number }>;
  save(path: string, text: string, expectedMtime: number | null): Promise<{ mtime: number }>;
  onDirty(path: string, dirty: boolean): void;
  onStatus(text: string): void;
}

type ScrollSnapshot = ReturnType<EditorView['scrollSnapshot']>;

interface EditorOptions { fontSize: number; tabSize: number; wordWrap: boolean; bracketColors: boolean }

interface SaveOptions { autoSave: boolean; delay: number; formatOnSave: boolean }

const FORMAT_ON_SAVE_MS = 1500;

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
  feat: Compartment;
  conflict: boolean;
  queue: Promise<unknown>;
}

const BINARY_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'mp3', 'wav', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov', 'mkv', 'zip', 'gz', 'tar', 'pdf', 'woff', 'woff2', 'ttf', 'otf', 'exe', 'dll', 'so', 'dylib', 'wasm', 'bin']);

const dominantEol = (text: string): string => {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
};

type Differ = typeof import('@codemirror/merge').diff;
let differ: Promise<Differ | null> | null = null;
const loadDiffer = (): Promise<Differ | null> => (differ ??= import('@codemirror/merge').then((m) => m.diff, () => null));
const DIFF_LIMITS = { scanLimit: 2000, timeout: 200 };

const reloadChanges = (diff: Differ | null, before: string, after: string): ChangeSpec[] => {
  if (before === after) return [];
  if (!diff) return [{ from: 0, to: before.length, insert: after }];
  return diff(before, after, DIFF_LIMITS).map((c) => ({ from: c.fromA, to: c.toA, insert: after.slice(c.fromB, c.toB) }));
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
  onChanged: (path: string) => void = () => undefined;

  private readonly root: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly mount: HTMLElement;
  private readonly view: EditorView;
  private readonly docs = new Map<string, Doc>();
  private readonly loading = new Map<string, Promise<Doc | null>>();
  private current: Doc | null = null;
  private showSeq = 0;
  private optsRev = 0;
  private options: EditorOptions = { fontSize: 13, tabSize: 4, wordWrap: true, bracketColors: true };
  private saving: SaveOptions = { autoSave: false, delay: 1000, formatOnSave: false };
  private autoTimer = 0;
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
    this.applyEditorPrefs();
    document.addEventListener(EDITOR_PREFS_EVENT, () => this.applyEditorPrefs());
    window.addEventListener('blur', () => this.flushAutoSave());
  }

  private applyEditorPrefs(): void {
    const p = loadPrefs();
    this.saving = { autoSave: p.editorAutoSave, delay: p.editorAutoSaveDelay, formatOnSave: p.editorFormatOnSave };
    if (!this.saving.autoSave) this.cancelAutoSave();
    else if (this.current) this.scheduleAutoSave(this.current);
    if (p.editorBracketColors === this.options.bracketColors) return;
    this.options = { ...this.options, bracketColors: p.editorBracketColors };
    this.optsRev++;
    if (this.current) this.syncOptions(this.current);
  }

  private featExt(): Extension {
    return this.options.bracketColors ? bracketColors : [];
  }

  private cancelAutoSave(): void {
    if (this.autoTimer) window.clearTimeout(this.autoTimer);
    this.autoTimer = 0;
  }

  private scheduleAutoSave(d: Doc): void {
    this.cancelAutoSave();
    if (!this.saving.autoSave || !d.dirty || d.conflict) return;
    const path = d.path;
    this.autoTimer = window.setTimeout(() => { this.autoTimer = 0; void this.save(path, true); }, this.saving.delay);
  }

  private flushAutoSave(): void {
    if (!this.saving.autoSave) return;
    this.cancelAutoSave();
    for (const path of this.dirtyPaths()) void this.save(path, true);
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
        folding(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        multiCursor,
        d.feat.of(this.featExt()),
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
    if (u.docChanged) { this.syncDirty(d, u.state.doc); this.onChanged(d.path); this.scheduleAutoSave(d); }
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
    this.dispatchTo(d, [d.opts.reconfigure(this.optionsExt()), d.wrap.reconfigure(this.wrapExt()), d.feat.reconfigure(this.featExt())]);
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
      feat: new Compartment(), conflict: false, queue: Promise.resolve(),
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

  textOf(path: string): string | null {
    const d = this.docs.get(path);
    return d ? this.liveState(d).doc.toString() : null;
  }

  dirtyPaths(): string[] {
    return [...this.docs.values()].filter((d) => d.dirty).map((d) => d.path);
  }

  save(path?: string, auto = false): Promise<boolean> {
    const d = path === undefined ? this.current : this.docs.get(path);
    if (!d) return Promise.resolve(false);
    if (!auto && this.current === d) this.cancelAutoSave();
    const run = d.queue.then(() => this.saveNow(d, auto));
    d.queue = run.catch(() => false);
    return run;
  }

  private async saveNow(d: Doc, auto: boolean): Promise<boolean> {
    if (auto && (!d.dirty || d.conflict || d.mtime === null || this.docs.get(d.path) !== d)) return false;
    const skipped = !auto && this.saving.formatOnSave && this.current === d && lsp.supports(d.path) && !(await lsp.formatForSave(this.view, FORMAT_ON_SAVE_MS));
    const snapshot = this.liveState(d).doc;
    const text = snapshot.sliceString(0, snapshot.length, d.eol);
    let ok: boolean;
    try {
      const r = await this.deps.save(d.path, text, d.mtime);
      ok = this.commitSave(d, snapshot, r.mtime);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.startsWith('409')) {
        this.deps.onStatus(`${t('Save failed')}: ${baseName(d.path)}: ${msg}`);
        return false;
      }
      if (auto) {
        d.conflict = true;
        this.deps.onStatus(`${t('Auto save paused')}: ${baseName(d.path)} ${t('changed on disk')}`);
        return false;
      }
      ok = await this.resolveConflict(d, snapshot, text);
    }
    if (ok && skipped) toast(t('Formatting was skipped; the file was saved as it was'), 'info', { key: 'format-on-save-skipped' });
    return ok;
  }

  private commitSave(d: Doc, snapshot: Text, mtime: number): boolean {
    d.saved = snapshot;
    d.mtime = mtime;
    d.conflict = false;
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

  async reload(path: string): Promise<boolean> {
    const d = this.docs.get(path);
    if (!d || d.dirty) return false;
    return this.reloadFromDisk(d, true);
  }

  private async reloadFromDisk(d: Doc, clean = false): Promise<boolean> {
    const differ = loadDiffer();
    let fresh: { text: string; mtime: number };
    try { fresh = await this.deps.load(d.path); } catch (e) {
      this.deps.onStatus(`${t('Cannot open')} ${baseName(d.path)}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    const diff = await differ;
    if (this.docs.get(d.path) !== d || (clean && d.dirty)) return false;
    const state = this.liveState(d);
    const next = state.toText(fresh.text);
    const changes = reloadChanges(diff, state.doc.toString(), next.toString());
    d.saved = next;
    d.eol = dominantEol(fresh.text);
    d.mtime = fresh.mtime;
    d.conflict = false;
    if (changes.length) {
      const spec = { changes, userEvent: 'input.reload' };
      if (this.current === d) this.view.dispatch(spec);
      else {
        const tr = d.state.update(spec);
        d.state = tr.state;
        if (d.scroll) d.scroll = d.scroll.map(tr.changes) ?? null;
      }
    }
    this.syncDirty(d, this.liveState(d).doc);
    if (!clean) this.deps.onStatus(`${t('Reloaded')} ${baseName(d.path)}`);
    return true;
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
