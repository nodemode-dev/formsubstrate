import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { indentUnit, syntaxHighlighting } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { owner } from '../io/window-token';
import type { Commands } from './commands';
import { el, q, setClass, setDisabled, setText, setTitle } from './dom';
import { languageFor } from './editor/languages';
import { editorHighlight, editorTheme } from './editor/theme';
import { wordWrap } from './editor/wrap';
import { t } from './i18n';
import { icon } from './icons';
import type { EditorPrefs, ViewDoc, Views } from './review/views';
import { toast } from './toast';
import type { WorkspaceStore } from './workspace-store';

export interface IdeLinkDeps {
  store: WorkspaceStore;
  commands: Commands;
  views: Views;
  open(path: string): Promise<void>;
  save(path: string): Promise<boolean>;
}

interface Position { line: number; character: number }
interface Selection { path: string; text: string; start: Position; end: Position }
interface OpenAsk { id: string; path: string; startText: string | null; endText: string | null; toLineEnd: boolean }
interface SaveAsk { id: string; path: string }
interface DiffAsk { id: string; tab: string; path: string; name: string; original: string; proposed: string }

const EVENTS_URL = '/api/ide/events';
const EDITOR = '.cv-editor-host .cm-editor';
const STATE_DEBOUNCE_MS = 200;
const SELECTION_CAP = 200_000;
const COLLAPSE = { margin: 3, minSize: 6 };

const tabId = (id: string): string => `ide-diff:${id}`;

const parse = <T>(e: Event): T | null => {
  try {
    const raw: unknown = JSON.parse((e as MessageEvent<string>).data);
    return raw && typeof raw === 'object' ? (raw as T) : null;
  } catch {
    return null;
  }
};

function liveView(): EditorView | null {
  const dom = document.querySelector<HTMLElement>(EDITOR);
  if (!dom || dom.getClientRects().length === 0) return null;
  return EditorView.findFromDOM(dom);
}

class ProposalTab implements ViewDoc {
  readonly root = el<HTMLElement>(`<div class="cv-diff">
<div class="cv-diff-bar">
<span class="cv-diff-file"></span>
<span class="cv-diff-badge cv-note"></span>
<div class="cv-diff-tools">
<button class="cv-btn cv-ide-reject" type="button">${icon('close', 14)}<span class="cv-ide-reject-t"></span></button>
<button class="cv-btn cv-btn-primary cv-ide-accept" type="button">${icon('check', 14)}<span class="cv-ide-accept-t"></span></button>
</div>
</div>
<div class="cv-diff-body">
<div class="cv-diff-pane cv-diff-unified is-measuring"></div>
</div>
</div>`);
  private readonly lang = new Compartment();
  private readonly opts = new Compartment();
  private readonly wrap = new Compartment();
  private readonly view: EditorView;
  private readonly acceptBtn = q<HTMLButtonElement>(this.root, '.cv-ide-accept');
  private readonly rejectBtn = q<HTMLButtonElement>(this.root, '.cv-ide-reject');
  private readonly pane = q<HTMLElement>(this.root, '.cv-diff-unified');
  private answered = false;
  private settled = false;

  constructor(private readonly ask: DiffAsk, prefs: EditorPrefs, private readonly done: (choice: 'accept' | 'reject') => void) {
    setText(q(this.root, '.cv-diff-file'), ask.path);
    setTitle(q(this.root, '.cv-diff-file'), ask.path);
    setText(q(this.root, '.cv-diff-badge'), t('Proposed by Claude Code'));
    setText(q(this.root, '.cv-ide-accept-t'), t('Accept'));
    setText(q(this.root, '.cv-ide-reject-t'), t('Reject'));
    this.root.style.setProperty('--cv-editor-fs', `${prefs.fontSize}px`);
    const resolved = languageFor(ask.path);
    this.view = new EditorView({
      parent: q(this.root, '.cv-diff-unified'),
      doc: ask.proposed,
      extensions: [
        lineNumbers(),
        syntaxHighlighting(editorHighlight),
        editorTheme,
        EditorState.phrases.of({ '$ unchanged lines': `$ ${t('unchanged lines')}`, 'Collapsed lines': t('Collapsed lines') }),
        this.lang.of(resolved.now),
        this.opts.of(this.optionsExt(prefs)),
        this.wrap.of(prefs.wordWrap ? wordWrap : []),
        EditorState.readOnly.of(true),
        unifiedMergeView({ original: ask.original, mergeControls: false, gutter: true, highlightChanges: true, syntaxHighlightDeletions: true, collapseUnchanged: COLLAPSE }),
      ],
    });
    void resolved.later.then((ext) => { if (ext && !this.answered) this.view.dispatch({ effects: this.lang.reconfigure(ext) }); });
    this.acceptBtn.addEventListener('click', () => this.finish('accept'));
    this.rejectBtn.addEventListener('click', () => this.finish('reject'));
  }

  private optionsExt(o: EditorPrefs): Extension {
    return [EditorState.tabSize.of(o.tabSize), indentUnit.of(' '.repeat(o.tabSize))];
  }

  private finish(choice: 'accept' | 'reject'): void {
    if (this.answered) return;
    this.answered = true;
    setDisabled(this.acceptBtn, true);
    setDisabled(this.rejectBtn, true);
    this.done(choice);
  }

  withdraw(): void {
    this.answered = true;
  }

  activate(): void {
    if (this.settled) { this.view.requestMeasure(); return; }
    this.settled = true;
    this.view.requestMeasure({ read: () => null, write: () => { requestAnimationFrame(() => setClass(this.pane, 'is-measuring', false)); } });
  }

  save(): Promise<boolean> {
    this.finish('accept');
    return Promise.resolve(true);
  }

  setOptions(o: EditorPrefs): void {
    this.root.style.setProperty('--cv-editor-fs', `${o.fontSize}px`);
    this.view.dispatch({ effects: [this.opts.reconfigure(this.optionsExt(o)), this.wrap.reconfigure(o.wordWrap ? wordWrap : [])] });
  }

  dispose(): void {
    if (!this.answered) { this.answered = true; this.done('reject'); }
    this.view.destroy();
  }
}

export function installIdeLink(deps: IdeLinkDeps): void {
  const { store, commands, views } = deps;
  const proposals = new Map<string, ProposalTab>();
  let timer = 0;
  let sent = '';
  let latest: Selection | null = null;

  const isFile = (id: string, path: string): boolean => id === path && !views.has(id);

  const readSelection = (): Selection | null => {
    const active = store.active;
    if (!active || !isFile(active.id, active.path)) return null;
    const view = liveView();
    if (!view) return null;
    const range = view.state.selection.main;
    const from = view.state.doc.lineAt(range.from), to = view.state.doc.lineAt(range.to);
    return {
      path: active.path,
      text: view.state.sliceDoc(range.from, Math.min(range.to, range.from + SELECTION_CAP)),
      start: { line: from.number - 1, character: range.from - from.from },
      end: { line: to.number - 1, character: range.to - to.from },
    };
  };

  const push = (): void => {
    timer = 0;
    const active = store.active;
    latest = store.workspace ? readSelection() : null;
    const body = JSON.stringify({
      workspace: store.workspace?.path ?? null,
      editors: store.docs.filter((d) => isFile(d.id, d.path)).map((d) => ({ path: d.path, dirty: d.modified })),
      active: active && isFile(active.id, active.path) ? active.path : null,
      selection: latest,
    });
    if (body === sent) return;
    sent = body;
    void owner('/api/ide/state', { method: 'POST', body }).catch(() => { if (sent === body) sent = ''; });
  };

  const queue = (): void => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(push, STATE_DEBOUNCE_MS);
  };

  const answer = (body: Record<string, unknown>): void => {
    void owner('/api/ide/reply', { method: 'POST', body: JSON.stringify(body) }).catch((err: unknown) => console.warn('answering Claude Code failed', err));
  };

  const select = (ask: OpenAsk): number => {
    const view = liveView();
    if (!view) return 0;
    if (ask.startText) {
      const text = view.state.doc.toString();
      const from = text.indexOf(ask.startText);
      if (from >= 0) {
        let to = from + ask.startText.length;
        if (ask.endText) {
          const at = text.indexOf(ask.endText, to);
          if (at >= 0) to = at + ask.endText.length;
        }
        if (ask.toLineEnd) to = view.state.doc.lineAt(to).to;
        view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
      }
    }
    return view.state.doc.lines;
  };

  const onOpen = async (ask: OpenAsk): Promise<void> => {
    try {
      await deps.open(ask.path);
      if (!store.docs.some((d) => d.id === ask.path)) { answer({ id: ask.id, ok: false, message: 'the file could not be opened in the editor' }); return; }
      answer({ id: ask.id, ok: true, lineCount: select(ask) });
      queue();
    } catch (err) {
      answer({ id: ask.id, ok: false, message: err instanceof Error ? err.message : 'the file could not be opened in the editor' });
    }
  };

  const onSave = async (ask: SaveAsk): Promise<void> => {
    try {
      answer({ id: ask.id, ok: await deps.save(ask.path) });
    } catch (err) {
      answer({ id: ask.id, ok: false, message: err instanceof Error ? err.message : 'the document was not saved' });
    }
  };

  const onDiff = (ask: DiffAsk): void => {
    const id = tabId(ask.id);
    if (proposals.has(ask.id)) return;
    const tab = new ProposalTab(ask, views.prefs, (choice) => {
      proposals.delete(ask.id);
      answer({ id: ask.id, choice });
      queueMicrotask(() => store.closeDoc(id));
    });
    proposals.set(ask.id, tab);
    views.open(id, { name: `${ask.name} (${t('proposed')})`, path: `${t('Proposed change')}: ${ask.path}` }, () => tab);
    views.show(id);
  };

  const onDiffClose = (id: string): void => {
    const tab = proposals.get(id);
    if (!tab) return;
    proposals.delete(id);
    tab.withdraw();
    store.closeDoc(tabId(id));
  };

  commands.add({
    id: 'ide-mention',
    label: 'Mention Selection in Claude Code',
    enabled: () => !!latest,
    run: () => {
      const sel = readSelection() ?? latest;
      if (!sel) return;
      void owner<{ sent: number }>('/api/ide/mention', { method: 'POST', body: JSON.stringify({ path: sel.path, lineStart: sel.start.line, lineEnd: sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line }) })
        .then((r) => { if (!r.sent) toast(t('Claude Code is not connected to Substrate'), 'info'); })
        .catch(() => toast(t('Claude Code is not connected to Substrate'), 'error'));
    },
  });

  store.on('workspace', queue);
  store.on('docs', queue);
  store.on('active', queue);
  document.addEventListener('selectionchange', () => { if (store.active && document.activeElement?.closest(EDITOR)) queue(); });

  if (typeof EventSource === 'undefined') return;
  const source = new EventSource(EVENTS_URL);
  source.addEventListener('open', () => { sent = ''; queue(); });
  source.addEventListener('open-file', (e) => { const ask = parse<OpenAsk>(e); if (ask && typeof ask.id === 'string' && typeof ask.path === 'string') void onOpen(ask); });
  source.addEventListener('save', (e) => { const ask = parse<SaveAsk>(e); if (ask && typeof ask.id === 'string' && typeof ask.path === 'string') void onSave(ask); });
  source.addEventListener('diff', (e) => { const ask = parse<DiffAsk>(e); if (ask && typeof ask.id === 'string' && typeof ask.proposed === 'string' && typeof ask.original === 'string') onDiff(ask); });
  source.addEventListener('diff-close', (e) => { const ask = parse<{ id: string }>(e); if (ask && typeof ask.id === 'string') onDiffClose(ask.id); });
}
