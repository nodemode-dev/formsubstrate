import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { indentUnit, syntaxHighlighting } from '@codemirror/language';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { git, type FileDiff } from '../../io/git';
import { detailOf, readFile, statusOf, writeFile } from '../../io/workspace';
import { sessionsClient } from '../../io/sessions';
import { confirmAction } from '../dialogs';
import { delayedIndicator, el, q, setClass, setDisabled, setHidden, setText, setTitle } from '../dom';
import { baseName, languageFor } from '../editor/languages';
import { editorHighlight, editorTheme } from '../editor/theme';
import { wordWrap } from '../editor/wrap';
import { onLanguage, t } from '../i18n';
import { icon } from '../icons';
import { toast } from '../toast';
import type { EditorPrefs, ViewDoc } from './views';

export const GIT_CHANGED = 'subform:git-changed';

export type DiffMode = 'split' | 'unified';

export interface DiffTarget { path: string; staged: boolean; session: string | null }

let lastMode: DiffMode = 'split';

const COLLAPSE = { margin: 3, minSize: 6 };
const RELOAD_MS = 120;

const dominantEol = (text: string): string => {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
};

const statusIn = (err: unknown): number => {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' && s > 0 ? s : statusOf(err);
};

export const diffId = (x: DiffTarget): string => `diff:${x.session ?? 'workspace'}:${x.staged ? 'staged' : 'work'}:${x.path}`;

export class DiffTab implements ViewDoc {
  readonly root = el<HTMLElement>(`<div class="cv-diff">
<div class="cv-diff-bar">
<span class="cv-diff-file"></span>
<span class="cv-diff-badge cv-note"></span>
<div class="cv-diff-tools">
<div class="cv-seg" role="group">
<button class="cv-seg-btn" type="button" data-mode="split">${icon('viewGrid', 14)}<span class="cv-diff-split-t"></span></button>
<button class="cv-seg-btn" type="button" data-mode="unified">${icon('viewList', 14)}<span class="cv-diff-unified-t"></span></button>
</div>
<button class="cv-wb-tool cv-diff-refresh" type="button">${icon('refresh', 14)}</button>
<button class="cv-btn cv-diff-save" type="button">${icon('save', 14)}<span class="cv-diff-save-t"></span></button>
</div>
</div>
<div class="cv-diff-body">
<div class="cv-diff-pane cv-diff-split" hidden></div>
<div class="cv-diff-pane cv-diff-unified" hidden></div>
<p class="cv-diff-note cv-note" hidden></p>
<p class="cv-diff-loading cv-note" hidden></p>
<p class="cv-diff-stale" hidden></p>
</div>
</div>`);
  private readonly fileEl = q(this.root, '.cv-diff-file');
  private readonly badge = q(this.root, '.cv-diff-badge');
  private readonly stale = q(this.root, '.cv-diff-stale');
  private readonly tools = q(this.root, '.cv-diff-tools');
  private readonly modeBtns = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.cv-seg-btn'));
  private readonly refreshBtn = q<HTMLButtonElement>(this.root, '.cv-diff-refresh');
  private readonly saveBtn = q<HTMLButtonElement>(this.root, '.cv-diff-save');
  private readonly splitHost = q(this.root, '.cv-diff-split');
  private readonly uniHost = q(this.root, '.cv-diff-unified');
  private readonly note = q(this.root, '.cv-diff-note');
  private readonly loading = q(this.root, '.cv-diff-loading');
  private readonly lang = new Compartment();
  private readonly opts = new Compartment();
  private readonly wrap = new Compartment();
  private langExt: Extension = [];
  private prefs: EditorPrefs;
  private diff: FileDiff | null = null;
  private mode: DiffMode = lastMode;
  private split: MergeView | null = null;
  private uni: EditorView | null = null;
  private saved: Text | null = null;
  private eol = '\n';
  private mtime: number | null = null;
  private dirty = false;
  private seq = 0;
  private timer = 0;
  private pending = false;
  private disposed = false;
  private readonly onChanged = (): void => this.queueReload();

  constructor(private readonly target: DiffTarget, prefs: EditorPrefs, private readonly modified: (dirty: boolean) => void) {
    this.prefs = prefs;
    const resolved = languageFor(target.path);
    this.langExt = resolved.now;
    void resolved.later.then((ext) => {
      if (!ext || this.disposed) return;
      this.langExt = ext;
      this.each((v) => v.dispatch({ effects: this.lang.reconfigure(ext) }));
    });
    this.root.style.setProperty('--cv-editor-fs', `${prefs.fontSize}px`);
    for (const b of this.modeBtns) b.addEventListener('click', () => this.setMode(b.dataset.mode === 'unified' ? 'unified' : 'split'));
    this.refreshBtn.addEventListener('click', () => { void this.load(); });
    this.saveBtn.addEventListener('click', () => { void this.save(); });
    window.addEventListener(GIT_CHANGED, this.onChanged);
    onLanguage(() => this.paint());
    this.paint();
    void this.load();
  }

  get editable(): boolean {
    return !this.target.staged && !this.target.session && !!this.diff && !this.diff.binary && !this.diff.tooLarge;
  }

  activate(): void {
    if (this.pending) { this.pending = false; void this.load(); }
    this.each((v) => v.requestMeasure());
  }

  setOptions(o: EditorPrefs): void {
    this.prefs = o;
    this.root.style.setProperty('--cv-editor-fs', `${o.fontSize}px`);
    this.each((v) => v.dispatch({ effects: [this.opts.reconfigure(this.optionsExt()), this.wrap.reconfigure(this.wrapExt())] }));
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.timer);
    window.removeEventListener(GIT_CHANGED, this.onChanged);
    this.destroyViews();
  }

  async save(): Promise<boolean> {
    const view = this.modifiedView();
    if (!view || !this.editable) return false;
    const doc = view.state.doc;
    const text = doc.sliceString(0, doc.length, this.eol);
    const write = async (expected: number | null): Promise<boolean> => {
      const r = await writeFile(this.target.path, text, expected);
      this.mtime = r.mtime;
      this.saved = doc;
      this.syncDirty(this.modifiedView()?.state.doc ?? doc);
      toast(`${t('Saved')} ${baseName(this.target.path)}`, 'info');
      window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: { session: null } }));
      return true;
    };
    try {
      return await write(this.mtime);
    } catch (err) {
      if (statusIn(err) !== 409) { toast(`${t('Save failed')}: ${baseName(this.target.path)}: ${detailOf(err)}`, 'error'); return false; }
      const overwrite = await confirmAction(t('Save conflict'), `${baseName(this.target.path)} ${t('changed on disk since the diff was opened. Overwrite the disk copy with your text?')}`, t('Overwrite'), true, t('Cancel'));
      if (!overwrite) return false;
      try { return await write(null); } catch (e) {
        toast(`${t('Save failed')}: ${baseName(this.target.path)}: ${detailOf(e)}`, 'error');
        return false;
      }
    }
  }

  private each(fn: (v: EditorView) => void): void {
    if (this.split) { fn(this.split.a); fn(this.split.b); }
    if (this.uni) fn(this.uni);
  }

  private modifiedView(): EditorView | null {
    return this.mode === 'split' ? (this.split?.b ?? null) : this.uni;
  }

  private optionsExt(): Extension {
    return [EditorState.tabSize.of(this.prefs.tabSize), indentUnit.of(' '.repeat(this.prefs.tabSize))];
  }

  private wrapExt(): Extension {
    return this.prefs.wordWrap ? wordWrap : [];
  }

  private phrases(): Extension {
    return EditorState.phrases.of({ '$ unchanged lines': `$ ${t('unchanged lines')}`, 'Collapsed lines': t('Collapsed lines') });
  }

  private base(): Extension[] {
    return [lineNumbers(), drawSelection(), syntaxHighlighting(editorHighlight), editorTheme, this.phrases(), this.lang.of(this.langExt), this.opts.of(this.optionsExt()), this.wrap.of(this.wrapExt())];
  }

  private readOnlyExt(): Extension[] {
    return [...this.base(), EditorState.readOnly.of(true)];
  }

  private editExt(): Extension[] {
    return [
      ...this.base(),
      history(),
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { void this.save(); return true; } }, ...historyKeymap, ...defaultKeymap]),
      EditorView.updateListener.of((u) => { if (u.docChanged) this.syncDirty(u.state.doc); }),
    ];
  }

  private syncDirty(doc: Text): void {
    const dirty = !!this.saved && !doc.eq(this.saved);
    if (dirty === this.dirty) return;
    this.dirty = dirty;
    this.modified(dirty);
    this.paint();
  }

  private destroyViews(): void {
    this.split?.destroy();
    this.split = null;
    this.uni?.destroy();
    this.uni = null;
  }

  private build(d: FileDiff, initial: string | Text, settle = false): void {
    const mine = this.editable ? this.editExt() : this.readOnlyExt();
    if (this.mode === 'split') {
      this.split = new MergeView({
        a: { doc: d.original, extensions: this.readOnlyExt() },
        b: { doc: initial, extensions: mine },
        parent: this.splitHost,
        orientation: 'a-b',
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: COLLAPSE,
      });
    } else {
      this.uni = new EditorView({
        parent: this.uniHost,
        doc: initial,
        extensions: [mine, unifiedMergeView({ original: d.original, mergeControls: false, gutter: true, highlightChanges: true, syntaxHighlightDeletions: true, collapseUnchanged: COLLAPSE })],
      });
    }
    setHidden(this.splitHost, this.mode !== 'split');
    setHidden(this.uniHost, this.mode !== 'unified');
    if (settle) this.settle();
  }

  private settle(): void {
    const host = this.mode === 'split' ? this.splitHost : this.uniHost;
    const view = this.modifiedView();
    setClass(host, 'is-measuring', true);
    const done = (): void => { requestAnimationFrame(() => setClass(host, 'is-measuring', false)); };
    if (view) view.requestMeasure({ read: () => null, write: done });
    else done();
  }

  setMode(mode: DiffMode): void {
    lastMode = mode;
    if (mode === this.mode) return;
    const d = this.diff;
    const live = this.modifiedView()?.state.doc;
    this.mode = mode;
    if (d && live && !d.binary && !d.tooLarge) {
      const old = [this.split, this.uni];
      this.split = null;
      this.uni = null;
      this.build(d, live);
      for (const v of old) v?.destroy();
    }
    this.paint();
  }

  private queueReload(): void {
    if (this.disposed) return;
    if (this.root.hidden) { this.pending = true; return; }
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.load(); }, RELOAD_MS);
  }

  private async load(): Promise<void> {
    const mine = ++this.seq;
    const stop = delayedIndicator(() => { setText(this.loading, t('Loading diff')); setHidden(this.loading, false); }, () => setHidden(this.loading, true));
    try {
      const d = await git.diff(this.target.path, this.target.staged, this.target.session);
      if (mine !== this.seq || this.disposed) return;
      const wantsMtime = !this.target.staged && !this.target.session && !d.binary && !d.tooLarge && d.modified !== '';
      const file = wantsMtime ? await readFile(this.target.path).then((f) => f.mtime).catch(() => null) : null;
      if (mine !== this.seq || this.disposed) return;
      this.apply(d, file);
    } catch (err) {
      if (mine !== this.seq || this.disposed) return;
      this.failed(detailOf(err));
    } finally {
      stop();
    }
  }

  private failed(text: string): void {
    this.diff = null;
    this.destroyViews();
    setHidden(this.splitHost, true);
    setHidden(this.uniHost, true);
    setText(this.note, text);
    setHidden(this.note, false);
    this.paint();
  }

  private apply(d: FileDiff, mtime: number | null): void {
    const prev = this.diff;
    this.diff = d;
    if (d.binary || d.tooLarge) {
      this.destroyViews();
      this.saved = null;
      setHidden(this.splitHost, true);
      setHidden(this.uniHost, true);
      setText(this.note, d.binary ? t('Binary file: there is no text diff to show.') : t('This file is too large to diff here.'));
      setHidden(this.note, false);
      this.paint();
      return;
    }
    setHidden(this.note, true);
    const view = this.modifiedView();
    const live = view ? view.state.doc.toString() : null;
    const fresh = d.modified.replace(/\r\n/g, '\n');
    const same = !!prev && !!view && prev.original === d.original && live === fresh;
    if (same) { if (mtime !== null) this.mtime = mtime; this.paint(); return; }
    if (view && this.dirty) {
      setHidden(this.stale, false);
      this.paint();
      return;
    }
    if (mtime !== null) this.mtime = mtime;
    setHidden(this.stale, true);
    if (view && prev && prev.original === d.original && live !== null) {
      this.eol = dominantEol(d.modified);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: fresh } });
      this.saved = view.state.doc;
      this.dirty = false;
      this.modified(false);
      this.paint();
      return;
    }
    this.eol = dominantEol(d.modified);
    this.destroyViews();
    this.build(d, d.modified, !view);
    this.saved = this.modifiedView()?.state.doc ?? null;
    this.dirty = false;
    this.modified(false);
    this.paint();
  }

  private paint(): void {
    const d = this.diff;
    setText(this.fileEl, this.target.path);
    setTitle(this.fileEl, this.target.path);
    const where = this.target.session ? (sessionsClient.get(this.target.session)?.title ?? this.target.session) : t('Workspace');
    const state = this.target.staged ? t('Staged against HEAD') : t('Working tree against the index');
    const edit = this.target.staged ? '' : this.target.session ? ` · ${t('read only here')}` : '';
    setText(this.badge, `${where} · ${state}${edit}`);
    setText(this.stale, t('Changed since opened: save or undo your edits to refresh.'));
    setText(q(this.root, '.cv-diff-split-t'), t('Side by side'));
    setText(q(this.root, '.cv-diff-unified-t'), t('Unified'));
    setText(q(this.saveBtn, '.cv-diff-save-t'), t('Save'));
    setTitle(this.refreshBtn, t('Refresh'));
    if (this.refreshBtn.getAttribute('aria-label') !== t('Refresh')) this.refreshBtn.setAttribute('aria-label', t('Refresh'));
    for (const b of this.modeBtns) {
      const on = b.dataset.mode === this.mode;
      setClass(b, 'is-on', on);
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
      setDisabled(b, !d || d.binary || d.tooLarge);
    }
    setClass(this.saveBtn, 'is-off', !this.editable);
    setDisabled(this.saveBtn, !this.dirty);
    setClass(this.tools, 'is-plain', !!d && (d.binary || d.tooLarge));
  }
}
