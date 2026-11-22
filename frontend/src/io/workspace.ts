import { request } from './api';
import { owner } from './window-token';
import type { WorkspaceInfo } from '../ui/workspace-store';

interface WorkspaceReply { root: string; name: string; isFormRepo: boolean; branch: string; localTools?: string[] }

export interface RecentWorkspace { path: string; name: string; opened: string; formRepo?: boolean; branch?: string | null; changed?: number; missing?: boolean }
export interface BrowseEntry { name: string; path: string; kind: EntryKind }
export interface BrowseListing { path: string; parent: string | null; home: string; roots: string[]; entries: BrowseEntry[]; truncated: boolean }
export type EntryKind = 'file' | 'dir';
export interface DirEntry { name: string; path: string; kind: EntryKind; size: number; mtime: number }
export interface DirListing { path: string; entries: DirEntry[] }
export interface WorkspaceFiles { files: string[]; truncated: boolean }
export interface FileContent { path: string; text: string; size: number; mtime: number }
export interface FileSaved { path: string; size: number; mtime: number }
export interface SearchHit { path: string; line: number; col: number; text: string }
export interface SearchResult { hits: SearchHit[]; truncated: boolean; engine: string; stopped?: boolean }
export interface SearchOptions { q: string; regex?: boolean; caseSensitive?: boolean; glob?: string; limit?: number; signal?: AbortSignal }

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

const info = (r: WorkspaceReply): WorkspaceInfo => ({ path: r.root, name: r.name, isFormRepo: r.isFormRepo, branch: r.branch, localTools: r.localTools ?? [] });

export function browseDir(path: string, files: boolean, hidden: boolean): Promise<BrowseListing> {
  const p = new URLSearchParams({ path, files: String(files), hidden: String(hidden) });
  return request<BrowseListing>(`/api/workspace/browse?${p.toString()}`);
}

export function statusOf(err: unknown): number {
  const m = err instanceof Error ? /^(\d{3})\b/.exec(err.message) : null;
  return m ? Number(m[1]) : 0;
}

export function detailOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\d{3}\s*/, '');
}

export async function currentWorkspace(): Promise<WorkspaceInfo | null> {
  try {
    return info(await request<WorkspaceReply>('/api/workspace'));
  } catch (err) {
    if (statusOf(err) === 404) return null;
    throw err;
  }
}

export async function openWorkspace(path: string): Promise<WorkspaceInfo> {
  return info(await owner<WorkspaceReply>('/api/workspace/open', json({ path })));
}

export async function recentWorkspaces(): Promise<RecentWorkspace[]> {
  return (await request<{ recent: RecentWorkspace[] }>('/api/workspace/recent')).recent;
}

export async function forgetRecent(path: string): Promise<void> {
  await owner<unknown>('/api/workspace/recent', { method: 'DELETE', body: JSON.stringify({ path }) });
}

export function listDir(path: string): Promise<DirListing> {
  return request<DirListing>(`/api/workspace/tree?path=${encodeURIComponent(path)}`);
}

export function listFiles(hide: string[], signal?: AbortSignal): Promise<WorkspaceFiles> {
  const p = new URLSearchParams();
  for (const name of hide) p.append('hide', name);
  return request<WorkspaceFiles>(`/api/workspace/files?${p.toString()}`, { signal });
}

export function readFile(path: string): Promise<FileContent> {
  return request<FileContent>(`/api/workspace/file?path=${encodeURIComponent(path)}`);
}

export function writeFile(path: string, text: string, expectedMtime: number | null, create = false): Promise<FileSaved> {
  return owner<FileSaved>('/api/workspace/file', { method: 'PUT', body: JSON.stringify({ path, text, expectedMtime, create }) });
}

export async function makeDir(path: string): Promise<void> {
  await owner<unknown>('/api/workspace/mkdir', json({ path }));
}

export async function renamePath(from: string, to: string): Promise<void> {
  await owner<unknown>('/api/workspace/rename', json({ from, to }));
}

export async function deletePath(path: string): Promise<void> {
  await owner<unknown>('/api/workspace/delete', json({ path }));
}

export function searchWorkspace(opts: SearchOptions): Promise<SearchResult> {
  const p = new URLSearchParams({ q: opts.q });
  if (opts.regex) p.set('regex', 'true');
  p.set('case', opts.caseSensitive ? 'true' : 'false');
  if (opts.glob) p.set('glob', opts.glob);
  if (opts.limit) p.set('limit', String(opts.limit));
  return request<SearchResult>(`/api/workspace/search?${p.toString()}`, { signal: opts.signal });
}

export interface ReplaceQuery { q: string; regex: boolean; caseSensitive: boolean; glob: string; replace: string }
export interface ReplaceHit { line: number; col: number; before: string; after: string; count: number }
export interface ReplaceFile { path: string; hash: string; size: number; mtime: number; hits: ReplaceHit[]; before?: string; after?: string }
export interface ReplacePreview { files: ReplaceFile[]; hits: number; truncated: boolean; stopped: boolean; engine: string }
export interface ReplaceTarget { path: string; hash: string; lines?: number[] }
export interface ReplaceOutcome { path: string; status: 'written' | 'refused' | 'skipped'; reason?: string; count?: number; size?: number; mtime?: number; hash?: string }
export interface ReplaceReply { results: ReplaceOutcome[]; written: number; engine: string }

const replaceBody = (r: ReplaceQuery): Record<string, unknown> => ({ q: r.q, regex: r.regex, case: r.caseSensitive, glob: r.glob, replace: r.replace });

export function previewReplace(r: ReplaceQuery, opts: { limit?: number; paths?: string[]; full?: boolean; signal?: AbortSignal } = {}): Promise<ReplacePreview> {
  return owner<ReplacePreview>('/api/workspace/replace/preview', { method: 'POST', body: JSON.stringify({ ...replaceBody(r), limit: opts.limit, paths: opts.paths, full: opts.full }), signal: opts.signal });
}

export function replaceInFiles(r: ReplaceQuery, files: ReplaceTarget[]): Promise<ReplaceReply> {
  return owner<ReplaceReply>('/api/workspace/replace', json({ ...replaceBody(r), files }));
}
