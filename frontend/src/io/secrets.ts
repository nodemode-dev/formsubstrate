import { request } from './api';
import { owner } from './window-token';

const path = (name: string): string => `/api/secrets/${encodeURIComponent(name)}`;

export async function listSecrets(): Promise<string[]> {
  const r = await request<{ names: string[] }>('/api/secrets');
  return r.names;
}

export async function hasSecret(name: string): Promise<boolean> {
  const r = await request<{ present: boolean }>(path(name));
  return r.present === true;
}

export async function saveSecret(name: string, value: string): Promise<void> {
  await owner<void>(path(name), { method: 'PUT', body: JSON.stringify({ value }) });
}

export async function removeSecret(name: string): Promise<void> {
  await owner<void>(path(name), { method: 'DELETE' });
}
