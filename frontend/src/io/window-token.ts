import { ApiError, request } from './api';

export const WINDOW_HEADER = 'X-Subform-Window';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

let cached: Promise<string> | null = null;

function shellInvoke(): Invoke | null {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
  return internals?.invoke ?? null;
}

async function fetchToken(): Promise<string> {
  const invoke = shellInvoke();
  if (invoke) {
    const given = await invoke('window_token').catch(() => null);
    if (typeof given === 'string' && given) return given;
  }
  return (await request<{ token: string }>('/api/window-token', { method: 'POST' })).token;
}

export function windowToken(): Promise<string> {
  if (!cached) {
    const fresh = fetchToken();
    cached = fresh;
    fresh.catch(() => { if (cached === fresh) cached = null; });
  }
  return cached;
}

export function forgetWindowToken(): void {
  cached = null;
}

export async function owner<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = async (): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set(WINDOW_HEADER, await windowToken());
    return request<T>(path, { ...init, headers });
  };
  try {
    return await send();
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 403) throw err;
    forgetWindowToken();
    return send();
  }
}
