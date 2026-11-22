import { listDir, listFiles, statusOf } from '../../io/workspace';
import { t } from '../i18n';
import { loadPrefs } from '../prefs';
import { workspace } from '../workspace-store';
import { fuzzyScore } from './fuzzy';

export const FILE_PAGE = 50;
export const FILE_ROWS_MAX = 500;
const MAX_FILES = 20000;
const MAX_DIRS = 5000;
const MAX_DEPTH = 32;
const PARALLEL = 6;
const RECENT_MAX = 50;

interface FileEntry { path: string; name: string; dir: string; lower: string; lowerName: string; lowerStem: string }

export interface FileRow { path: string; name: string; dir: string; score: number }

export interface FileQuery { text: string; line: number; col: number }

export interface FileView { rows: FileRow[]; note: string }

const recent: string[] = [];
let recentRoot = '';

function remember(): void {
  const root = workspace.workspace?.path ?? '';
  if (root !== recentRoot) { recent.length = 0; recentRoot = root; }
  const path = workspace.active?.path;
  if (!path) return;
  const at = recent.indexOf(path);
  if (at >= 0) recent.splice(at, 1);
  recent.unshift(path);
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
}

workspace.on('active', remember);
workspace.on('workspace', remember);

function entryOf(path: string): FileEntry {
  const cut = path.lastIndexOf('/'), name = path.slice(cut + 1), lowerName = name.toLowerCase(), dot = lowerName.lastIndexOf('.');
  return { path, name, dir: cut > 0 ? path.slice(0, cut) : '', lower: path.toLowerCase(), lowerName, lowerStem: dot > 0 ? lowerName.slice(0, dot) : lowerName };
}

function recentPaths(): string[] {
  const out = recent.slice();
  for (const d of workspace.docs) if (!out.includes(d.path)) out.push(d.path);
  return out;
}

export function parseFileQuery(raw: string): FileQuery {
  const text = raw.trim().replace(/\\/g, '/');
  const m = /^(.*?):(\d+)(?::(\d+))?:?$/.exec(text);
  const base = m && m[1] ? m[1] : text;
  return { text: base.replace(/\s+/g, '').toLowerCase(), line: m && m[1] ? Number(m[2]) : 0, col: m && m[1] && m[3] ? Number(m[3]) : 0 };
}

function inOrder(q: string, text: string): boolean {
  let j = 0;
  for (let i = 0; i < q.length; i++) {
    j = text.indexOf(q[i], j);
    if (j < 0) return false;
    j++;
  }
  return true;
}

function scoreOf(f: FileEntry, q: string, slash: boolean): number | null {
  if (!inOrder(q, f.lower)) return null;
  if (!slash && inOrder(q, f.lowerName)) {
    const own = fuzzyScore(q, f.name);
    if (own !== null) return 1000 + own + (f.lowerName.startsWith(q) ? 20 : 0) + (f.lowerStem === q || f.lowerName === q ? 40 : 0);
  }
  return fuzzyScore(q, f.path);
}

let cache: { root: string; files: FileEntry[] } | null = null;

export class FileIndex {
  private files: FileEntry[];
  private readonly fresh: FileEntry[] = [];
  private readonly root: string;
  private readonly stale: boolean;
  private live = true;
  private readonly abort = new AbortController();
  private lastQuery = '';
  private lastSize = -1;
  private lastSource: FileEntry[] | null = null;
  private lastPool: FileEntry[] = [];
  done = false;
  truncated = false;
  failed = false;

  constructor(private readonly changed: () => void) {
    this.root = workspace.workspace?.path ?? '';
    const old = cache && cache.root === this.root ? cache.files : null;
    this.stale = !!old;
    this.files = old ?? this.fresh;
    void this.run().then(() => {
      if (!this.live) return;
      if (!this.failed) { this.files = this.fresh; cache = { root: this.root, files: this.fresh }; }
      this.done = true;
      this.changed();
    });
  }

  get ready(): boolean { return this.done || this.failed || this.stale; }

  stop(): void { this.live = false; this.abort.abort(); }

  private async run(): Promise<void> {
    const hide = loadPrefs().hiddenFolders;
    try {
      const res = await listFiles(hide, this.abort.signal);
      if (!this.live) return;
      for (const path of res.files) this.fresh.push(entryOf(path));
      this.truncated = res.truncated;
    } catch (err) {
      if (!this.live) return;
      if (statusOf(err) === 404) await this.walk(new Set(hide));
      else this.failed = true;
    }
  }

  private walk(hide: Set<string>): Promise<void> {
    const queue: { dir: string; depth: number }[] = [{ dir: '', depth: 0 }];
    let dirs = 1, busy = 0, first = true;
    return new Promise<void>((resolve) => {
      const pump = (): void => {
        while (this.live && busy < PARALLEL && queue.length && this.fresh.length < MAX_FILES) {
          const next = queue.shift() as { dir: string; depth: number };
          const root = first;
          first = false;
          busy++;
          listDir(next.dir).then((res) => {
            if (!this.live) return;
            for (const e of res.entries) {
              if (e.kind === 'dir') {
                if (hide.has(e.name)) continue;
                if (next.depth >= MAX_DEPTH || dirs >= MAX_DIRS) { this.truncated = true; continue; }
                dirs++;
                queue.push({ dir: e.path, depth: next.depth + 1 });
              } else if (this.fresh.length < MAX_FILES) this.fresh.push(entryOf(e.path));
              else this.truncated = true;
            }
            if (!this.stale) this.changed();
          }, () => { if (root) this.failed = true; }).finally(() => { busy--; pump(); });
        }
        if (!busy) {
          if (queue.length) this.truncated = true;
          resolve();
        }
      };
      pump();
    });
  }

  search(query: FileQuery): FileView {
    if (!workspace.workspace) return { rows: [], note: t('Open a folder to search its files') };
    const q = query.text;
    if (!q) {
      const rows = recentPaths().map((p, i): FileRow => { const f = entryOf(p); return { path: f.path, name: f.name, dir: f.dir, score: -i }; });
      return { rows, note: rows.length ? '' : t('Type a file name') };
    }
    const pool = this.lastSource === this.files && this.lastSize === this.files.length && this.lastQuery && q.startsWith(this.lastQuery) ? this.lastPool : this.files;
    const slash = q.includes('/'), mine = new Set(recentPaths()), hits: { f: FileEntry; s: number }[] = [], kept: FileEntry[] = [];
    for (const f of pool) {
      const s = scoreOf(f, q, slash);
      if (s === null) continue;
      kept.push(f);
      hits.push({ f, s: s + (mine.has(f.path) ? 8 : 0) });
    }
    this.lastQuery = q;
    this.lastSize = this.files.length;
    this.lastSource = this.files;
    this.lastPool = kept;
    hits.sort((a, b) => b.s - a.s || a.f.path.length - b.f.path.length || a.f.path.localeCompare(b.f.path));
    const rows = hits.slice(0, FILE_ROWS_MAX).map((h): FileRow => ({ path: h.f.path, name: h.f.name, dir: h.f.dir, score: h.s }));
    if (rows.length) return { rows, note: '' };
    if (this.failed && !this.stale) return { rows, note: t('Files could not be listed') };
    if (!this.done && !this.stale) return { rows, note: t('Listing files...') };
    return { rows, note: t('No file matches') };
  }
}
