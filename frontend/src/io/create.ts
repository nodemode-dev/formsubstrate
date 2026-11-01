import { request } from './api';

export type AppKind = 'rust' | 'python';
export type JobState = 'running' | 'done' | 'failed' | 'cancelled';

export interface CreateKind { id: AppKind; label: string }
export interface CreateOptions { kinds: CreateKind[]; block: number | null; formslot: boolean; identity: { name: string; email: string; stored: boolean } }
export interface CloneJob { id: string; kind: string; state: JobState; progress: number; message: string; path: string; name: string; error: string }
export interface PortCheck { ok: boolean; problem: string }
export interface NewAppBody { name: string; kind: AppKind; dest: string; port: number }
export interface NewAppResult {
  path: string;
  name: string;
  kind: AppKind;
  ports: { base: number; end: number; engine: number };
  commit: string;
  files: number;
  identity: { name: string; email: string };
  signed: boolean;
  formslot: { installed: boolean; note: string };
}

const WINDOW_HEADER = 'X-Subform-Window';
let windowToken: Promise<string> | null = null;

function ensureToken(): Promise<string> {
  if (!windowToken) {
    const fresh = request<{ token: string }>('/api/window-token', { method: 'POST' }).then((r) => r.token);
    windowToken = fresh;
    fresh.catch(() => { if (windowToken === fresh) windowToken = null; });
  }
  return windowToken;
}

async function owner<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = async (): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set(WINDOW_HEADER, await ensureToken());
    return request<T>(path, { ...init, headers });
  };
  try {
    return await send();
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('403')) throw err;
    windowToken = null;
    return send();
  }
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });
const query = (params: Record<string, string | number | null | undefined>): string => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') out.set(k, String(v));
  const text = out.toString();
  return text ? `?${text}` : '';
};

export const create = {
  options: (dest?: string): Promise<CreateOptions> => owner<CreateOptions>(`/api/create/options${query({ dest })}`),
  port: (base: number, dest?: string): Promise<PortCheck> => owner<PortCheck>(`/api/create/port${query({ base, dest })}`),
  clone: (url: string, dest: string, folder: string): Promise<CloneJob> => owner<CloneJob>('/api/create/clone', post({ url, dest, folder })),
  job: (id: string): Promise<CloneJob> => owner<CloneJob>(`/api/create/jobs/${encodeURIComponent(id)}`),
  cancel: (id: string): Promise<CloneJob> => owner<CloneJob>(`/api/create/jobs/${encodeURIComponent(id)}/cancel`, post()),
  app: (body: NewAppBody): Promise<NewAppResult> => owner<NewAppResult>('/api/create/app', post(body)),
};
