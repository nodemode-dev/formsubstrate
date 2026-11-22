import { textToDoc } from '../../engine';
import { validateGraph } from '../../io/studio';
import { el, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from '../dom';
import { t } from '../i18n';
import { icon } from '../icons';
import { toast } from '../toast';
import type { EditorPrefs, ViewDoc } from '../review/views';
import { studio, STUDIO_FILE, type StudioAction } from './api';
import { DRAG_TYPE, StudioCanvas } from './canvas';
import { Inspector } from './inspector';
import { KIND_LIST } from './kinds';
import { newGraph, saveCurrent } from './studio-file';

export const STUDIO_ID = 'studio';

type Mode = 'canvas' | 'split' | 'code';

const MODE_KEY = 'formsubstrate.studio.mode';
const CODE_DELAY = 280;

function readMode(): Mode {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    return raw === 'split' || raw === 'code' ? raw : 'canvas';
  } catch {
    return 'canvas';
  }
}

export class StudioTab implements ViewDoc {
  readonly root: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly actions: HTMLElement;
  private readonly palette: HTMLElement;
  private readonly code: HTMLTextAreaElement;
  private readonly codeState: HTMLElement;
  private readonly footFile: HTMLElement;
  private readonly footCheck: HTMLElement;
  private readonly footCount: HTMLElement;
  private readonly canvas: StudioCanvas;
  private readonly inspector: Inspector;
  private readonly btn = new Map<string, HTMLButtonElement>();
  private readonly offs: Array<() => void> = [];
  private mode: Mode = readMode();
  private timer = 0;
  private frame = 0;
  private typing = false;

  constructor(private readonly onTitle: (title: string) => void, private readonly onDirty: (dirty: boolean) => void) {
    this.root = el(
      '<div class="cv-st">' +
      '<div class="cv-st-top">' +
      '<input class="cv-input cv-st-name" spellcheck="false" maxlength="80">' +
      '<div class="cv-st-group">' +
      `<button class="cv-st-tool" type="button" data-b="new">${icon('newFile', 16)}</button>` +
      `<button class="cv-st-tool" type="button" data-b="save">${icon('save', 16)}</button>` +
      `<button class="cv-st-tool" type="button" data-b="check">${icon('shield', 16)}</button></div>` +
      '<div class="cv-st-group">' +
      `<button class="cv-st-tool" type="button" data-b="undo">${icon('undo', 16)}</button>` +
      `<button class="cv-st-tool" type="button" data-b="redo">${icon('redo', 16)}</button>` +
      `<button class="cv-st-tool" type="button" data-b="layout">${icon('autoLayout', 16)}</button></div>` +
      '<div class="cv-st-actions"></div>' +
      '<div class="cv-st-seg" role="group">' +
      `<button class="cv-st-segbtn" type="button" data-m="canvas">${icon('canvasView', 16)}</button>` +
      `<button class="cv-st-segbtn" type="button" data-m="split">${icon('previewSide', 16)}</button>` +
      `<button class="cv-st-segbtn" type="button" data-m="code">${icon('code', 16)}</button></div></div>` +
      '<div class="cv-st-main">' +
      '<div class="cv-st-palette"><p class="cv-st-pal-h"></p><div class="cv-st-pal-list"></div><p class="cv-st-pal-tip cv-note"></p></div>' +
      '<div class="cv-st-center"></div>' +
      '<div class="cv-st-side"></div>' +
      '<div class="cv-st-codepane"><textarea class="cv-st-json" spellcheck="false" wrap="off"></textarea><p class="cv-st-code-state"></p></div></div>' +
      '<div class="cv-st-foot"><span class="cv-st-foot-file"></span><span class="cv-st-foot-check"></span><span class="cv-st-foot-count"></span></div>' +
      '</div>');
    this.name = q<HTMLInputElement>(this.root, '.cv-st-name');
    this.actions = q(this.root, '.cv-st-actions');
    this.palette = q(this.root, '.cv-st-pal-list');
    this.code = q<HTMLTextAreaElement>(this.root, '.cv-st-json');
    this.codeState = q(this.root, '.cv-st-code-state');
    this.footFile = q(this.root, '.cv-st-foot-file');
    this.footCheck = q(this.root, '.cv-st-foot-check');
    this.footCount = q(this.root, '.cv-st-foot-count');
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-b]'))) this.btn.set(b.dataset.b ?? '', b);
    this.canvas = new StudioCanvas(q(this.root, '.cv-st-center'));
    this.inspector = new Inspector(q(this.root, '.cv-st-side'));
    this.text();
    this.buildPalette();
    this.wire();
    this.offs.push(studio.engine.onChange((e) => this.onChange(e.origin)));
    this.offs.push(studio.engine.dirtyChanged.on((d) => this.onDirty(d)));
    this.offs.push(studio.onActions(() => this.syncActions()));
    const onFile = (): void => this.syncChrome();
    window.addEventListener(STUDIO_FILE, onFile);
    this.offs.push(() => window.removeEventListener(STUDIO_FILE, onFile));
    this.syncActions();
    this.onChange('system');
    this.applyMode();
  }

  private text(): void {
    const tips: Record<string, string> = { new: 'New graph', save: 'Save graph', check: 'Validate graph', undo: 'Undo', redo: 'Redo', layout: 'Auto layout' };
    for (const [id, b] of this.btn) {
      setTitle(b, t(tips[id] ?? id));
      b.setAttribute('aria-label', t(tips[id] ?? id));
    }
    const modes: Record<string, string> = { canvas: 'Canvas only', split: 'Canvas and JSON', code: 'JSON only' };
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-m]'))) {
      const label = t(modes[b.dataset.m ?? ''] ?? '');
      setTitle(b, label);
      b.setAttribute('aria-label', label);
    }
    this.name.placeholder = t('Graph name');
    this.name.setAttribute('aria-label', t('Graph name'));
    setText(q(this.root, '.cv-st-pal-h'), t('Nodes'));
    setText(q(this.root, '.cv-st-pal-tip'), t('Click to add, or drag onto the canvas.'));
    this.code.setAttribute('aria-label', t('Graph JSON'));
  }

  private buildPalette(): void {
    patchList(this.palette, [...KIND_LIST], {
      key: (k) => k.kind,
      create: (k) => {
        const n = el<HTMLElement>(`<button class="cv-st-pal-item" type="button" draggable="true" data-kind="${k.kind}"><span class="cv-st-pal-ico">${icon(k.icon, 16)}</span><span class="cv-st-pal-txt"><span class="cv-st-pal-name"></span><span class="cv-st-pal-help"></span></span></button>`);
        setText(q(n, '.cv-st-pal-name'), t(k.label));
        setText(q(n, '.cv-st-pal-help'), t(k.help));
        setTitle(n, t(k.help));
        n.addEventListener('click', () => this.canvas.addAtCenter(k.kind));
        n.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData(DRAG_TYPE, k.kind);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
        });
        return n;
      },
      update: () => undefined,
    });
  }

  private syncActions(): void {
    patchList<StudioAction>(this.actions, [...studio.actions], {
      key: (a) => a.id,
      create: (a) => {
        const n = el<HTMLButtonElement>(`<button class="cv-st-act" type="button">${icon(a.icon, 16)}<span></span></button>`);
        setText(q(n, 'span'), t(a.label));
        setTitle(n, t(a.title ?? a.label));
        setDisabled(n, a.enabled ? !a.enabled() : false);
        n.addEventListener('click', () => a.run());
        return n;
      },
      update: (n, a) => setDisabled(n as HTMLButtonElement, a.enabled ? !a.enabled() : false),
    });
  }

  private applyMode(): void {
    const center = q(this.root, '.cv-st-center'), side = q(this.root, '.cv-st-side'), pal = q(this.root, '.cv-st-palette'), pane = q(this.root, '.cv-st-codepane');
    setHidden(center, this.mode === 'code');
    setHidden(side, this.mode === 'code');
    setHidden(pal, this.mode !== 'canvas');
    setHidden(pane, this.mode === 'canvas');
    setClass(pane, 'is-wide', this.mode === 'code');
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-m]'))) {
      const on = b.dataset.m === this.mode;
      setClass(b, 'is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    try { localStorage.setItem(MODE_KEY, this.mode); } catch { return; }
  }

  private setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.applyMode();
    this.canvas.requestFit();
  }

  private wire(): void {
    const on = (id: string, fn: () => void): void => { this.btn.get(id)?.addEventListener('click', fn); };
    on('new', () => { void newGraph().then((ok) => { if (ok) this.canvas.requestFit(); }); });
    on('save', () => { void this.save(); });
    on('check', () => { void this.check(); });
    on('undo', () => { studio.engine.undo(); });
    on('redo', () => { studio.engine.redo(); });
    on('layout', () => this.canvas.autoLayout());
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-m]'))) b.addEventListener('click', () => this.setMode((b.dataset.m ?? 'canvas') as Mode));
    this.name.addEventListener('change', () => {
      const next = this.name.value.trim();
      if (next) studio.engine.dispatch({ type: 'rename_doc', name: next }, 'canvas'); else this.name.value = studio.getDoc().name;
    });
    this.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.name.blur(); });
    this.code.addEventListener('input', () => {
      this.typing = true;
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.fromCode(), CODE_DELAY);
    });
    this.code.addEventListener('blur', () => {
      if (this.typing) { window.clearTimeout(this.timer); this.fromCode(); }
      this.typing = false;
      this.syncCode();
    });
    this.code.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const s = this.code.selectionStart, end = this.code.selectionEnd;
      this.code.setRangeText('  ', s, end, 'end');
      this.code.dispatchEvent(new Event('input'));
    });
  }

  private fromCode(): void {
    const text = this.code.value;
    const parsed = textToDoc(text);
    if (!parsed.ok) {
      setClass(this.codeState, 'is-error', true);
      setText(this.codeState, parsed.errors.slice(0, 2).join('  ·  '));
      return;
    }
    setClass(this.codeState, 'is-error', false);
    setText(this.codeState, t('In sync with the canvas.'));
    if (JSON.stringify(parsed.doc) === JSON.stringify(studio.getDoc())) return;
    studio.engine.loadFromText(text, 'code');
  }

  private syncCode(): void {
    if (document.activeElement === this.code && this.typing) return;
    const text = studio.toText();
    if (this.code.value !== text) this.code.value = text;
    setClass(this.codeState, 'is-error', false);
    setText(this.codeState, t('In sync with the canvas.'));
  }

  private onChange(origin: string): void {
    if (origin !== 'code') this.syncCode();
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.syncChrome(); });
  }

  private syncChrome(): void {
    const doc = studio.getDoc();
    if (document.activeElement !== this.name && this.name.value !== doc.name) this.name.value = doc.name;
    setDisabled(this.btn.get('undo') as HTMLButtonElement, !studio.engine.canUndo);
    setDisabled(this.btn.get('redo') as HTMLButtonElement, !studio.engine.canRedo);
    setText(this.footFile, studio.fileName ? `.formsubstrate/graphs/${studio.fileName}.json` : t('Not saved yet'));
    setText(this.footCount, `${doc.nodes.length} ${t('nodes')} · ${doc.edges.length} ${t('edges')}`);
    setText(this.footCheck, '');
    setClass(this.footCheck, 'is-error', false);
    this.syncActions();
    this.onTitle(`Studio: ${doc.name}`);
  }

  private async check(): Promise<void> {
    try {
      const r = await validateGraph(studio.getDoc());
      const bad = r.errors.length > 0;
      const text = bad ? r.errors[0] : r.warnings.length ? `${t('Valid')} · ${r.warnings[0]}` : t('Valid');
      setText(this.footCheck, text);
      setClass(this.footCheck, 'is-error', bad);
      setTitle(this.footCheck, [...r.errors, ...r.warnings].join('\n'));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  activate(): void {
    this.syncCode();
    this.syncChrome();
    this.canvas.activate();
    this.onDirty(studio.engine.dirty);
  }

  requestFit(): void {
    this.canvas.requestFit();
  }

  focusCanvas(): void {
    this.canvas.stage.focus({ preventScroll: true });
  }

  async save(): Promise<boolean> {
    window.clearTimeout(this.timer);
    if (this.typing) this.fromCode();
    return saveCurrent();
  }

  setOptions(_o: EditorPrefs): void {
    return;
  }

  dispose(): void {
    for (const off of this.offs) off();
    window.clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    this.canvas.dispose();
    this.inspector.dispose();
  }
}
