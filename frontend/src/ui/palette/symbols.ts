import { formslot, formslotState, type SlotHit } from '../../io/formslot';
import { isAbort, symbolHub, type LspLang, type SymbolOutcome, type WarmFile } from '../../io/lsp';
import { workspaceTrusted } from '../../io/trust';
import { readFile, searchWorkspace } from '../../io/workspace';
import { lsp } from '../editor/lsp';
import { t } from '../i18n';
import { workspace } from '../workspace-store';
import { fuzzyScore } from './fuzzy';

export type SymbolScope = 'file' | 'workspace';

export interface SymbolRow {
  key: string;
  name: string;
  kind: string;
  where: string;
  badge: string;
  path: string;
  line: number;
  col: number;
  score: number;
}

export interface SymbolView {
  rows: SymbolRow[];
  note: string;
  again: boolean;
}

export const FILE_PREFIX = '@';
export const WORKSPACE_PREFIX = '#';
export const SYMBOL_ROWS = 100;

const KINDS: Record<number, string> = {
  1: 'F', 2: 'M', 3: 'N', 4: 'P', 5: 'C', 6: 'm', 7: 'p', 8: 'f', 9: 'c', 10: 'E', 11: 'I', 12: 'fn', 13: 'v', 14: 'k', 15: 's', 16: '#', 17: 'b', 18: '[]', 19: '{}', 20: 'K', 21: '0', 22: 'e', 23: 'S', 24: 'ev', 25: '+', 26: 'T',
};

const EXTS: Record<LspLang, { ext: RegExp; glob: string; id: (path: string) => string }> = {
  typescript: { ext: /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i, glob: '*.ts', id: (p) => (/\.tsx$/i.test(p) ? 'typescriptreact' : /\.jsx$/i.test(p) ? 'javascriptreact' : /\.(js|mjs|cjs)$/i.test(p) ? 'javascript' : 'typescript') },
  python: { ext: /\.pyi?$/i, glob: '*.py', id: () => 'python' },
};

export function scopeOf(raw: string): { scope: SymbolScope | null; query: string } {
  const head = raw.trimStart()[0];
  if (head === FILE_PREFIX) return { scope: 'file', query: raw.trimStart().slice(1).trim() };
  if (head === WORKSPACE_PREFIX) return { scope: 'workspace', query: raw.trimStart().slice(1).trim() };
  return { scope: null, query: raw.trim() };
}

const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const lostNote = (): string => (workspaceTrusted() ? t('No language server is running') : t('No language server is running. Trust this workspace to run the ones installed in it.'));

function ranked(rows: SymbolRow[], query: string, cap: number): SymbolRow[] {
  if (!query) return rows.slice(0, cap);
  const out: SymbolRow[] = [];
  for (const r of rows) {
    const own = fuzzyScore(query, r.name);
    const wide = own === null && r.where ? fuzzyScore(query, `${r.where} ${r.name}`) : null;
    if (own === null && wide === null) continue;
    out.push({ ...r, score: own ?? (wide as number) - 10 });
  }
  return out.sort((a, b) => b.score - a.score || a.line - b.line || a.name.localeCompare(b.name)).slice(0, cap);
}

export interface FileSymbols {
  path: string | null;
  rows: SymbolRow[];
  note: string;
}

export async function loadFileSymbols(): Promise<FileSymbols> {
  const path = workspace.active?.path ?? null;
  if (!workspace.workspace) return { path, rows: [], note: t('Open a folder to search its symbols') };
  if (!path) return { path, rows: [], note: t('Open a file to list its symbols') };
  const st = lsp.statusFor(path);
  if (!st) return { path, rows: [], note: t('No language server covers this file type') };
  if (st.state === 'starting') return { path, rows: [], note: t('The language server is starting') };
  if (st.state === 'unavailable' || st.state === 'stopped') return { path, rows: [], note: lostNote() };
  const items = await lsp.symbols(path);
  if (!items) return { path, rows: [], note: t('The language server is starting') };
  const stack: string[] = [];
  const rows = items.map((it, i): SymbolRow => {
    stack.length = it.depth;
    const where = stack.join('.');
    stack[it.depth] = it.name;
    return { key: `f:${i}:${it.line}:${it.col}:${it.name}`, name: it.name, kind: KINDS[it.kind] ?? '?', where, badge: '', path, line: it.line, col: it.col, score: 0 };
  });
  return { path, rows, note: rows.length ? '' : t('No symbols in this file') };
}

export function filterFileSymbols(all: FileSymbols, query: string): SymbolView {
  const rows = ranked(all.rows, query, SYMBOL_ROWS);
  return { rows, note: rows.length ? '' : all.rows.length ? t('No symbol matches') : all.note, again: false };
}

async function warmFile(lang: LspLang, signal: AbortSignal): Promise<WarmFile | null> {
  const spec = EXTS[lang];
  let path = workspace.docs.map((d) => d.path).find((p) => spec.ext.test(p)) ?? null;
  if (!path) {
    const found = await searchWorkspace({ q: '.', regex: true, glob: spec.glob, limit: 8, signal });
    path = found.hits.map((h) => h.path).find((p) => !/(^|\/)node_modules\//.test(p) && !/\.d\.ts$/.test(p)) ?? null;
  }
  if (!path) return null;
  const file = await readFile(path);
  return { path, text: file.text, languageId: spec.id(path) };
}

function lspRows(outcomes: SymbolOutcome[], query: string): SymbolRow[] {
  const seen = new Set<string>();
  const rows: SymbolRow[] = [];
  for (const o of outcomes) {
    for (const h of o.hits) {
      const key = `w:${h.path}:${h.line}:${h.col}:${h.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, name: h.name, kind: KINDS[h.kind] ?? '?', where: [h.container, `${baseOf(h.path)}:${h.line}`].filter(Boolean).join(' · '), badge: '', path: h.path, line: h.line, col: h.col, score: 0 });
    }
  }
  const out: SymbolRow[] = [];
  for (const r of rows) {
    const own = fuzzyScore(query, r.name);
    out.push({ ...r, score: own ?? -50 });
  }
  return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
}

function startOf(lines: unknown): number {
  if (Array.isArray(lines)) return Number(lines[0]) || 1;
  if (typeof lines === 'string') return Number.parseInt(lines, 10) || 1;
  return 1;
}

async function slotRows(query: string, taken: SymbolRow[]): Promise<SymbolRow[]> {
  const status = formslotState.status;
  if (!formslotState.isEnabled || formslotState.phase !== 'running' || !status?.workspaceCorpus) return [];
  let hits: SlotHit[];
  try { hits = (await formslot.find(query, 12)).hits; } catch { return []; }
  const out: SymbolRow[] = [];
  for (const h of hits) {
    if (h.kind === 'slot' || h.kind === 'memory' || !h.path) continue;
    const full = h.qualified || h.title || h.id;
    const name = full.split(/[.:#/]/).filter(Boolean).pop() ?? full;
    if (fuzzyScore(query, name) === null) continue;
    const line = startOf(h.lines);
    if (taken.some((r) => r.path === h.path && (r.line === line || r.name === name))) continue;
    out.push({ key: `s:${h.id}:${h.path}:${line}`, name, kind: h.unit_kind ? h.unit_kind.slice(0, 2) : '?', where: `${baseOf(h.path)}:${line}`, badge: t('slot'), path: h.path, line, col: 1, score: -100 });
  }
  return out;
}

export async function searchWorkspaceSymbols(query: string, signal: AbortSignal): Promise<SymbolView> {
  const root = workspace.workspace?.path ?? '';
  if (!root) return { rows: [], note: t('Open a folder to search its symbols'), again: false };
  if (!query) return { rows: [], note: t('Type a symbol name'), again: false };
  let outcomes: SymbolOutcome[];
  try {
    outcomes = await symbolHub.search(query, { root, signal, warm: (lang) => warmFile(lang, signal) });
  } catch (e) {
    if (isAbort(e)) throw e;
    return { rows: [], note: t('Symbols could not be searched'), again: false };
  }
  const first = lspRows(outcomes, query);
  const extra = await slotRows(query, first);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const rows = [...first, ...extra].slice(0, SYMBOL_ROWS);
  const states = outcomes.map((o) => o.state);
  if (rows.length) return { rows, note: '', again: states.includes('warming') };
  if (states.includes('warming')) return { rows, note: t('Indexing the workspace...'), again: true };
  if (states.includes('busy') && !states.includes('ok')) return { rows, note: t('Too many language servers are running'), again: false };
  if (states.every((s) => s === 'unavailable' || s === 'failed')) return { rows, note: lostNote(), again: false };
  return { rows, note: t('No symbol matches'), again: false };
}
