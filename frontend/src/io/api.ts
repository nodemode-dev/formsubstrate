export interface SystemStatus {
  app: string;
  version: string;
  engine: string;
  data_dir: string;
  git: unknown;
  claude: unknown;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && init.body !== null && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    let parsed: unknown = null;
    try {
      const body: unknown = await res.json();
      parsed = body;
      if (body && typeof body === 'object' && 'detail' in body) detail = String((body as { detail: unknown }).detail);
    } catch {
      detail = res.statusText;
    }
    throw new ApiError(`${res.status} ${detail}`, res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function systemStatus(): Promise<SystemStatus> {
  return request<SystemStatus>('/api/system/status');
}
