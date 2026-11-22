import { ApiError, request } from './api';
import { owner } from './window-token';

export interface GitFile { path: string; oldPath: string | null; index: string; worktree: string; staged: boolean; unstaged: boolean; kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' }
export interface GitStatus { root: string; session: string | null; branch: string | null; head: string | null; upstream: string | null; ahead: number; behind: number; files: GitFile[]; conflicted: boolean }
export interface HunkLine { t: ' ' | '+' | '-'; text: string }
export interface Hunk { id: string; header: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: HunkLine[] }
export interface FileDiff { path: string; oldPath: string | null; binary: boolean; staged: boolean; original: string; modified: string; hunks: Hunk[]; tooLarge: boolean; mtime: number | null }
export interface FlaggedCommit { sha: string; short: string; subject: string; author: string; committer: string; reasons: ('trailer' | 'identity')[] }
export interface FileReview { path: string; oldPath: string | null; kind: GitFile['kind']; binary: boolean; hunks: Hunk[]; added: number; removed: number }
export interface Review { root: string; session: string | null; files: FileReview[]; snapshots: number }
export interface Audit { author: string; committer: string; identityOk: boolean; trailers: number; signature: string }
export interface Commit { sha: string; short: string; subject: string; author: string; email: string; date: string; signature: string }
export interface Identity { name: string; email: string; sign: boolean; signingKey: string; source: 'formsubstrate' | 'git' | 'none' }
export interface Snapshot { n: number; ref: string; commit: string; label: string; created: string; files: number }
export interface ReviewComment { id: string; path: string; line: number | null; hunk: string | null; text: string; created: string }

export interface Branch { name: string; sha: string; upstream: string | null; ahead: number; behind: number; gone: boolean; current: boolean; date: string; subject: string; session: string | null; worktree: string | null }
export interface RemoteBranch { name: string; remote: string; sha: string; date: string; subject: string }
export interface Branches { root: string; session: string | null; current: string | null; detached: boolean; head: string | null; local: Branch[]; remote: RemoteBranch[]; remotes: string[] }
export interface Stash { index: number; ref: string; sha: string; message: string; branch: string | null; created: string }
export interface Tag { name: string; annotated: boolean; target: string; date: string; message: string }
export interface GitRefusal { overwrite?: boolean; files?: string[]; unmerged?: boolean; diverged?: boolean; ahead?: number; behind?: number }

export class GitError extends Error {
  constructor(message: string, readonly status: number, readonly extra: GitRefusal = {}) {
    super(message);
    this.name = 'GitError';
  }
}

const PREFIX = /^(\d{3}) ([\s\S]*)$/;

const asGitError = (err: unknown): GitError => {
  if (err instanceof GitError) return err;
  const text = err instanceof Error ? err.message : String(err);
  const extra = err instanceof ApiError && err.body && typeof err.body === 'object' ? (err.body as GitRefusal) : {};
  const m = PREFIX.exec(text);
  return m ? new GitError(m[2], Number(m[1]), extra) : new GitError(text, 0, extra);
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (err) {
    throw asGitError(err);
  }
}

async function held<T>(path: string, init: RequestInit): Promise<T> {
  try {
    return await owner<T>(path, init);
  } catch (err) {
    throw asGitError(err);
  }
}

const query = (params: Record<string, string | number | boolean | null | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    sp.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });
const withSession = <T extends object>(body: T, session?: string | null): T & { session?: string } => (session ? { ...body, session } : body);

async function refusable(path: string, payload: object): Promise<{ ok: boolean; check: string; output: string }> {
  try {
    const data = await owner<Record<string, unknown>>(path, post(payload));
    return { ok: data.ok !== false, check: typeof data.check === 'string' ? data.check : '', output: typeof data.output === 'string' ? data.output : '' };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.body && typeof err.body === 'object') {
      const body = err.body as { check?: unknown; output?: unknown };
      if (typeof body.check === 'string') return { ok: false, check: body.check, output: typeof body.output === 'string' ? body.output : '' };
    }
    throw asGitError(err);
  }
}

export const git = {
  status(session?: string | null): Promise<GitStatus> {
    return call<GitStatus>(`/api/git/status${query({ session })}`);
  },
  diff(path: string, staged: boolean, session?: string | null): Promise<FileDiff> {
    return call<FileDiff>(`/api/git/diff${query({ session, path, staged })}`);
  },
  review(session?: string | null): Promise<Review> {
    return call<Review>(`/api/git/review${query({ session })}`);
  },
  hunks(path: string, hunks: string[], action: 'accept' | 'reject', session?: string | null): Promise<{ ok: boolean; applied: number; review: FileReview | null }> {
    return held('/api/git/hunks', post(withSession({ path, hunks, action }, session)));
  },
  stage(paths: string[], session?: string | null): Promise<GitStatus> {
    return held<GitStatus>('/api/git/stage', post(withSession({ paths }, session)));
  },
  unstage(paths: string[], session?: string | null): Promise<GitStatus> {
    return held<GitStatus>('/api/git/unstage', post(withSession({ paths }, session)));
  },
  discard(paths: string[], untracked: boolean, session?: string | null): Promise<GitStatus> {
    return held<GitStatus>('/api/git/discard', post(withSession({ paths, untracked }, session)));
  },
  commit(message: string, opts: { amend?: boolean; all?: boolean; session?: string | null } = {}): Promise<{ commit: string; summary: string; audit: Audit; identitySource?: 'formsubstrate' | 'git' | 'none' }> {
    return held('/api/git/commit', post(withSession({ message, amend: opts.amend === true, all: opts.all === true }, opts.session)));
  },
  async log(opts: { session?: string | null; limit?: number; ref?: string } = {}): Promise<Commit[]> {
    const r = await call<{ commits: Commit[] }>(`/api/git/log${query({ session: opts.session, limit: opts.limit, ref: opts.ref })}`);
    return r.commits;
  },
  identity(): Promise<Identity> {
    return call<Identity>('/api/git/identity');
  },
  setIdentity(v: Omit<Identity, 'source'>): Promise<Identity> {
    return held<Identity>('/api/git/identity', put(v));
  },
  async snapshots(session?: string | null): Promise<Snapshot[]> {
    const r = await call<{ snapshots: Snapshot[] }>(`/api/git/snapshots${query({ session })}`);
    return r.snapshots;
  },
  snapshot(label?: string, session?: string | null): Promise<Snapshot> {
    return held<Snapshot>('/api/git/snapshots', post(withSession(label ? { label } : {}, session)));
  },
  rewind(n: number, session?: string | null): Promise<{ restored: Snapshot; safety: Snapshot; status: GitStatus }> {
    return held('/api/git/rewind', post(withSession({ n }, session)));
  },
  comment(session: string, path: string, line: number | null, hunk: string | null, text: string): Promise<{ sent: 'terminal' | 'headless' | 'stored'; comment: ReviewComment }> {
    return held('/api/git/comments', post({ session, path, line, hunk, text }));
  },
  async push(opts: { session?: string | null; remote?: string; branch?: string } = {}): Promise<{ ok: boolean; check: string; output: string }> {
    return refusable('/api/git/push', withSession({ remote: opts.remote ?? 'origin', ...(opts.branch ? { branch: opts.branch } : {}) }, opts.session));
  },
  async audit(session: string): Promise<FlaggedCommit[]> {
    const r = await call<{ commits: FlaggedCommit[] }>(`/api/git/audit${query({ session })}`);
    return r.commits;
  },
  writeWorktreeFile(session: string, path: string, text: string, expectedMtime: number | null): Promise<{ path: string; size: number; mtime: number }> {
    return held('/api/git/worktree-file', put({ session, path, text, expectedMtime }));
  },
  signAndPush(opts: { session?: string | null; remote?: string; branch?: string } = {}): Promise<{ ok: boolean; check: string; output: string }> {
    return refusable('/api/git/sign-and-push', withSession({ remote: opts.remote ?? 'origin', ...(opts.branch ? { branch: opts.branch } : {}) }, opts.session));
  },
  branches(session?: string | null): Promise<Branches> {
    return call<Branches>(`/api/git/branches${query({ session })}`);
  },
  createBranch(name: string, opts: { start?: string | null; switch?: boolean; session?: string | null } = {}): Promise<{ created: string; sha: string; switched: boolean; status: GitStatus }> {
    return held('/api/git/branches', post(withSession({ name, start: opts.start || null, switch: opts.switch === true }, opts.session)));
  },
  switchBranch(name: string, session?: string | null): Promise<{ switched: string; created: boolean; status: GitStatus }> {
    return held('/api/git/switch', post(withSession({ name }, session)));
  },
  deleteBranch(name: string, force: boolean, session?: string | null): Promise<{ deleted: string; sha: string }> {
    return held('/api/git/branches/delete', post(withSession({ name, force }, session)));
  },
  fetch(opts: { remote?: string | null; prune?: boolean; session?: string | null } = {}): Promise<{ ok: boolean; output: string; status: GitStatus }> {
    return held('/api/git/fetch', post(withSession({ remote: opts.remote || null, prune: opts.prune !== false }, opts.session)));
  },
  pull(mode: 'ff-only' | 'merge' = 'ff-only', session?: string | null): Promise<{ ok: boolean; result: 'up-to-date' | 'fast-forward' | 'merged'; ahead: number; behind: number; output: string; status: GitStatus }> {
    return held('/api/git/pull', post(withSession({ mode }, session)));
  },
  async stashes(session?: string | null): Promise<Stash[]> {
    const r = await call<{ stashes: Stash[] }>(`/api/git/stashes${query({ session })}`);
    return r.stashes;
  },
  stash(message: string, untracked: boolean, session?: string | null): Promise<{ stash: Stash | null; stashes: Stash[]; status: GitStatus }> {
    return held('/api/git/stashes', post(withSession({ message, untracked }, session)));
  },
  applyStash(s: Pick<Stash, 'index' | 'sha'>, pop: boolean, session?: string | null): Promise<{ applied: string; dropped: boolean; conflicted: boolean; stashes: Stash[]; status: GitStatus }> {
    return held('/api/git/stashes/apply', post(withSession({ index: s.index, sha: s.sha, pop }, session)));
  },
  dropStash(s: Pick<Stash, 'index' | 'sha'>, session?: string | null): Promise<{ dropped: string; stashes: Stash[] }> {
    return held('/api/git/stashes/drop', post(withSession({ index: s.index, sha: s.sha }, session)));
  },
  async tags(session?: string | null): Promise<Tag[]> {
    const r = await call<{ tags: Tag[] }>(`/api/git/tags${query({ session })}`);
    return r.tags;
  },
  createTag(name: string, message: string, opts: { ref?: string | null; session?: string | null } = {}): Promise<{ tag: Tag | null; tags: Tag[] }> {
    return held('/api/git/tags', post(withSession({ name, message, ref: opts.ref || null }, opts.session)));
  },
  pushTag(name: string, remote: string, session?: string | null): Promise<{ ok: boolean; output: string }> {
    return held('/api/git/tags/push', post(withSession({ name, remote }, session)));
  },
};
