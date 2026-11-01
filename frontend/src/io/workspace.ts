import { request } from './api';
import type { WorkspaceInfo } from '../ui/workspace-store';

interface WorkspaceReply { root: string; name: string; isFormRepo: boolean; branch: string }

export interface RecentWorkspace { path: string; name: string; opened: string; formRepo?: boolean }
export type EntryKind = 'file' | 'dir';
export interface DirEntry { name: string; path: string; kind: EntryKind; size: number; mtime: number }
export interface DirListing { path: string; entries: DirEntry[] }
export interface FileContent { path: string; text: string; size: number; mtime: number }
export interface FileSaved { path: string; size: number; mtime: number }
export interface SearchHit { path: string; line: number; col: number; text: string }
export interface SearchResult { hits: SearchHit[]; truncated: boolean; engine: string }
export interface SearchOptions { q: string; regex?: boolean; caseSensitive?: boolean; glob?: string; limit?: number; signal?: AbortSignal }

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

const info = (r: WorkspaceReply): WorkspaceInfo => ({ path: r.root, name: r.name, isFormRepo: r.isFormRepo, branch: r.branch });

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
  return info(await request<WorkspaceReply>('/api/workspace/open', json({ path })));
}

export async function recentWorkspaces(): Promise<RecentWorkspace[]> {
  return (await request<{ recent: RecentWorkspace[] }>('/api/workspace/recent')).recent;
}

export async function forgetRecent(path: string): Promise<void> {
  await request<unknown>('/api/workspace/recent', { method: 'DELETE', body: JSON.stringify({ path }) });
}

export function listDir(path: string): Promise<DirListing> {
  return request<DirListing>(`/api/workspace/tree?path=${encodeURIComponent(path)}`);
}

export function readFile(path: string): Promise<FileContent> {
  return request<FileContent>(`/api/workspace/file?path=${encodeURIComponent(path)}`);
}

export function writeFile(path: string, text: string, expectedMtime: number | null, create = false): Promise<FileSaved> {
  return request<FileSaved>('/api/workspace/file', { method: 'PUT', body: JSON.stringify({ path, text, expectedMtime, create }) });
}

export async function makeDir(path: string): Promise<void> {
  await request<unknown>('/api/workspace/mkdir', json({ path }));
}

export async function renamePath(from: string, to: string): Promise<void> {
  await request<unknown>('/api/workspace/rename', json({ from, to }));
}

export async function deletePath(path: string): Promise<void> {
  await request<unknown>('/api/workspace/delete', json({ path }));
}

export function searchWorkspace(opts: SearchOptions): Promise<SearchResult> {
  const p = new URLSearchParams({ q: opts.q });
  if (opts.regex) p.set('regex', 'true');
  p.set('case', opts.caseSensitive ? 'true' : 'false');
  if (opts.glob) p.set('glob', opts.glob);
  if (opts.limit) p.set('limit', String(opts.limit));
  return request<SearchResult>(`/api/workspace/search?${p.toString()}`, { signal: opts.signal });
}
