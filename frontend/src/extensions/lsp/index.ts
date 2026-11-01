import { findReferences, formatDocument, jumpToDefinition, renameSymbol } from '@codemirror/lsp-client';
import type { LspServerInfo } from '../../io/lsp';
import { Dialog } from '../../ui/dialogs';
import { el, patchList, q, setClass, setHidden, setText, setTitle } from '../../ui/dom';
import { lsp, type LspStatus, type OutlineItem, type Problem } from '../../ui/editor/lsp';
import { onLanguage, t, tn } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { FOCUS_EVENT } from '../../ui/workbench';
import { register, type ExtensionContext, type Shell } from '../registry';

export const LSP_STATUS_EVENT = 'subform:lsp-status';

export interface LspStatusDetail {
  text: string;
  title: string;
  state: string;
  errors: number;
  warnings: number;
}

const OUTLINE_DEBOUNCE_MS = 350;
const PROBLEMS_CAP = 500;

const KINDS: Record<number, string> = {
  1: 'F', 2: 'M', 3: 'N', 4: 'P', 5: 'C', 6: 'm', 7: 'p', 8: 'f', 9: 'c', 10: 'E', 11: 'I', 12: 'fn', 13: 'v', 14: 'k', 15: 's', 16: '#', 17: 'b', 18: '[]', 19: '{}', 20: 'K', 21: '0', 22: 'e', 23: 'S', 24: 'ev', 25: '+', 26: 'T',
};

const SEVERITY_ICON: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'info' };

const LANG_NAME: Record<string, string> = { typescript: 'TypeScript', python: 'Python' };

const STATE_WORD: Record<string, string> = { starting: 'starting', ready: 'ready', unavailable: 'not installed', stopped: 'stopped' };

const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

function emptyReason(path: string | null, st: LspStatus | null): string {
  if (!path) return t('Open a TypeScript or Python file');
  if (!st) return t('No language server for this file type');
  if (st.state === 'starting') return t('The language server is starting');
  if (st.state === 'unavailable') return t('No language server was found. Open Language Servers for how to install one.');
  if (st.state === 'stopped') return t('The language server stopped');
  return t('No symbols');
}

const OUTLINE_ROW = '<button class="cv-lsp-row" type="button"><span class="cv-lsp-kind"></span><span class="cv-lsp-name"></span><span class="cv-lsp-detail"></span></button>';
const PROBLEM_ROW = '<button class="cv-lsp-row cv-lsp-prob" type="button"><span class="cv-lsp-sev"></span><span class="cv-lsp-text"><span class="cv-lsp-msg"></span><span class="cv-lsp-where"></span></span></button>';

function fillOutline(node: HTMLElement, it: OutlineItem): HTMLElement {
  node.style.setProperty('--depth', String(it.depth));
  node.dataset.line = String(it.line);
  node.dataset.col = String(it.col);
  setText(q(node, '.cv-lsp-kind'), KINDS[it.kind] ?? '?');
  setText(q(node, '.cv-lsp-name'), it.name);
  setText(q(node, '.cv-lsp-detail'), it.detail);
  setTitle(node, it.detail ? `${it.name} ${it.detail}` : it.name);
  return node;
}

function fillProblem(node: HTMLElement, p: Problem): HTMLElement {
  const sev = q(node, '.cv-lsp-sev');
  if (!sev.firstChild) {
    node.dataset.sev = String(p.severity);
    sev.append(el(icon(SEVERITY_ICON[p.severity] ?? 'info', 14)));
  }
  node.dataset.path = p.path;
  node.dataset.line = String(p.line);
  node.dataset.col = String(p.col);
  setText(q(node, '.cv-lsp-msg'), p.message);
  setText(q(node, '.cv-lsp-where'), `${p.path}:${p.line}:${p.col}${p.source ? ` · ${p.source}` : ''}`);
  setTitle(node, p.message);
  return node;
}

class OutlinePanel {
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly name: HTMLElement;
  private timer = 0;
  private serial = 0;
  private path: string | null = null;

  constructor(host: HTMLElement, private readonly ctx: ExtensionContext, private readonly shell: Shell) {
    host.append(el(
      '<div class="cv-lsp">' +
      '<div class="cv-lsp-head"><span class="cv-lsp-file"></span></div>' +
      '<div class="cv-lsp-list" role="list"></div>' +
      '<p class="cv-lsp-empty cv-note"></p></div>'));
    this.list = q(host, '.cv-lsp-list');
    this.empty = q(host, '.cv-lsp-empty');
    this.name = q(host, '.cv-lsp-file');
    this.list.addEventListener('click', (e) => {
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-lsp-row') : null;
      if (!row || !this.path) return;
      this.shell.revealLine(this.path, Number(row.dataset.line), Number(row.dataset.col));
    });
    ctx.store.on('active', () => this.schedule(0));
    ctx.store.on('docs', () => this.schedule(0));
    lsp.on('state', () => this.schedule(0));
    lsp.on('changed', (path) => { if (path === this.path) this.schedule(OUTLINE_DEBOUNCE_MS); });
    onLanguage(() => this.schedule(0));
    host.addEventListener(FOCUS_EVENT, () => this.list.querySelector<HTMLElement>('.cv-lsp-row')?.focus());
    this.host = host;
    new IntersectionObserver((entries) => {
      const shown = entries.some((e) => e.isIntersecting);
      if (shown && !this.shown) this.schedule(0);
      this.shown = shown;
    }).observe(host);
    this.schedule(0);
  }

  private host: HTMLElement;
  private shown = false;

  private schedule(delay: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.refresh(); }, delay);
  }

  private async refresh(): Promise<void> {
    if (!this.host.getClientRects().length) return;
    const path = this.ctx.store.active?.path ?? null;
    const mine = ++this.serial;
    this.path = path && lsp.supports(path) ? path : null;
    setText(this.name, this.path ? baseOf(this.path) : '');
    const found = this.path ? await lsp.symbols(this.path) : null;
    if (mine !== this.serial) return;
    const items = (found ?? []).map((it, i) => ({ it, key: String(i) }));
    patchList(this.list, items, {
      key: (x) => x.key,
      create: (x) => fillOutline(el<HTMLElement>(OUTLINE_ROW), x.it),
      update: (node, x) => { fillOutline(node, x.it); },
    });
    setHidden(this.empty, items.length > 0);
    if (!items.length) setText(this.empty, emptyReason(this.path, lsp.statusFor(this.path)));
  }
}

class ProblemsPanel {
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly summary: HTMLElement;

  constructor(host: HTMLElement, private readonly shell: Shell) {
    host.append(el(
      '<div class="cv-lsp">' +
      '<div class="cv-lsp-head"><span class="cv-lsp-file"></span></div>' +
      '<div class="cv-lsp-list" role="list"></div>' +
      '<p class="cv-lsp-empty cv-note"></p></div>'));
    this.list = q(host, '.cv-lsp-list');
    this.empty = q(host, '.cv-lsp-empty');
    this.summary = q(host, '.cv-lsp-file');
    this.list.addEventListener('click', (e) => {
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-lsp-row') : null;
      if (!row) return;
      this.shell.revealLine(row.dataset.path ?? '', Number(row.dataset.line), Number(row.dataset.col));
    });
    lsp.on('diagnostics', () => this.sync());
    onLanguage(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const all = lsp.problems();
    const seen = new Map<string, number>();
    const rows = all.slice(0, PROBLEMS_CAP).map((p) => {
      const base = `${p.path}:${p.line}:${p.col}:${p.message}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { p, key: `${p.severity}:${base}#${n}` };
    });
    patchList(this.list, rows, {
      key: (x) => x.key,
      create: (x) => fillProblem(el<HTMLElement>(PROBLEM_ROW), x.p),
      update: (node, x) => { fillProblem(node, x.p); },
    });
    const errors = all.filter((p) => p.severity === 1).length;
    const warnings = all.filter((p) => p.severity === 2).length;
    setText(this.summary, all.length ? `${tn(errors, '{n} error', '{n} errors')} · ${tn(warnings, '{n} warning', '{n} warnings')}` : '');
    setHidden(this.empty, all.length > 0);
    setText(this.empty, t('No problems in the open files'));
  }
}

class ServersDialog extends Dialog {
  private readonly blocks = new Map<string, { head: HTMLElement; state: HTMLElement; detail: HTMLElement; notes: HTMLElement; install: HTMLElement; lines: HTMLElement[] }>();

  constructor() {
    super('Language Servers', 560);
    for (const lang of ['typescript', 'python']) {
      const block = el<HTMLElement>(
        '<section class="cv-lsp-srv"><div class="cv-lsp-srv-head"><span class="cv-lsp-srv-name"></span><span class="cv-lsp-srv-state"></span></div>' +
        '<p class="cv-note cv-lsp-srv-detail"></p><p class="cv-note cv-lsp-srv-notes"></p>' +
        '<div class="cv-lsp-srv-install"><span class="cv-note cv-lsp-srv-how"></span><code></code><code></code><code></code></div></section>');
      this.body.append(block);
      this.blocks.set(lang, {
        head: q(block, '.cv-lsp-srv-name'),
        state: q(block, '.cv-lsp-srv-state'),
        detail: q(block, '.cv-lsp-srv-detail'),
        notes: q(block, '.cv-lsp-srv-notes'),
        install: q(block, '.cv-lsp-srv-install'),
        lines: Array.from(block.querySelectorAll<HTMLElement>('code')),
      });
    }
    this.foot.append(this.button('Close', 'primary', () => this.close()));
  }

  async show(): Promise<void> {
    this.open();
    let servers: LspServerInfo[] = [];
    try { servers = (await lsp.servers()).servers; } catch { servers = []; }
    for (const info of servers) this.paint(info);
  }

  private paint(info: LspServerInfo): void {
    const b = this.blocks.get(info.lang);
    if (!b) return;
    const live = lsp.statusFor(info.lang === 'python' ? 'x.py' : 'x.ts');
    const word = !info.found ? 'not installed' : live && live.state !== 'starting' ? STATE_WORD[live.state] : 'found';
    setText(b.head, LANG_NAME[info.lang] ?? info.label);
    setText(b.state, t(word));
    setClass(b.state, 'is-bad', !info.found);
    const act = info.active;
    setText(b.detail, act ? `${act.name}${act.version ? ` ${act.version}` : ''} · ${act.path}` : t('No usable language server was found.'));
    setText(b.notes, [...info.notes, ...info.candidates.filter((c) => c.found && !c.usable && c.note).map((c) => `${c.name}: ${c.note}`)].join(' '));
    setHidden(b.notes, !b.notes.textContent);
    setHidden(b.install, info.found);
    setText(q(b.install, '.cv-lsp-srv-how'), t('Install one of these:'));
    b.lines.forEach((line, i) => {
      setText(line, info.install[i] ?? '');
      setTitle(line, info.install[i] ?? '');
      setHidden(line, !info.install[i]);
    });
  }
}

function describe(st: LspStatus | null): { text: string; title: string; state: string } {
  if (!st) return { text: '', title: '', state: 'idle' };
  const name = LANG_NAME[st.lang] ?? st.lang;
  const text = `${name} · ${t(STATE_WORD[st.state] ?? st.state)}`;
  const server = st.name ? `${st.name}${st.version ? ` ${st.version}` : ''}` : '';
  const title = st.state === 'unavailable' ? `${st.error}${st.install.length ? `\n${st.install.join('\n')}` : ''}` : st.state === 'stopped' ? st.error : server;
  return { text, title, state: st.state };
}

register({
  id: 'lsp',
  name: 'Language intelligence',
  description: 'Hover, diagnostics, definitions, references, rename, outline and problems through the language servers found on this computer.',
  required: true,
  setup(ctx, shell) {
    let servers: ServersDialog | null = null;
    const outlineSection = shell.sidebarSection({
      id: 'outline',
      title: 'Outline',
      icon: 'code',
      render: (host) => { new OutlinePanel(host, ctx, shell); },
    });
    const outlineRight = shell.rightSection?.({
      id: 'outline-right',
      title: 'Outline',
      icon: 'code',
      render: (host) => { new OutlinePanel(host, ctx, shell); },
    });
    const problemsSection = shell.sidebarSection({
      id: 'problems',
      title: 'Problems',
      icon: 'warning',
      render: (host) => { new ProblemsPanel(host, shell); },
    });

    const onCode = (): boolean => {
      const path = ctx.store.active?.path;
      return !!path && lsp.supports(path);
    };
    ctx.commands.add(
      { id: 'lsp-definition', label: 'Go to Definition', keys: ['F12'], enabled: onCode, run: () => { lsp.run(jumpToDefinition); } },
      { id: 'lsp-references', label: 'Find All References', keys: ['Shift+F12'], enabled: onCode, run: () => { lsp.run(findReferences); } },
      { id: 'lsp-rename', label: 'Rename Symbol', keys: ['F2'], enabled: onCode, run: () => { lsp.run(renameSymbol); } },
      { id: 'lsp-format', label: 'Format Document', keys: ['Shift+Alt+F'], enabled: onCode, run: () => { lsp.run(formatDocument); } },
      { id: 'lsp-outline', label: 'Show Outline', run: () => (outlineRight ?? outlineSection).reveal() },
      { id: 'lsp-outline-left', label: 'Show Outline in the Sidebar', run: () => outlineSection.reveal() },
      { id: 'lsp-problems', label: 'Show Problems', run: () => problemsSection.reveal() },
      { id: 'lsp-servers', label: 'Language Servers...', run: () => { servers ??= new ServersDialog(); void servers.show(); } },
      { id: 'lsp-restart', label: 'Restart Language Servers', enabled: () => ctx.store.docs.length > 0, run: () => lsp.restart(ctx.store.docs.map((d) => d.path)) },
    );

    let last = '';
    const publish = (): void => {
      const d = describe(lsp.statusFor(ctx.store.active?.path ?? null));
      const probs = lsp.problems();
      const errors = probs.filter((p) => p.severity === 1).length;
      const warnings = probs.filter((p) => p.severity === 2).length;
      const detail: LspStatusDetail = { ...d, errors, warnings };
      const key = JSON.stringify(detail);
      if (key === last) return;
      last = key;
      window.dispatchEvent(new CustomEvent<LspStatusDetail>(LSP_STATUS_EVENT, { detail }));
    };
    window.addEventListener('subform:lsp-servers', () => { ctx.commands.run('lsp-servers'); });
    lsp.on('state', publish);
    lsp.on('diagnostics', publish);
    ctx.store.on('active', publish);
    ctx.store.on('docs', publish);
    onLanguage(() => { last = ''; publish(); });
    publish();
  },
});
