import { request } from './api';
import { owner } from './window-token';

const path = (name: string): string => `/api/secrets/${encodeURIComponent(name)}`;

export async function listSecrets(): Promise<string[]> {
  const r = await request<{ names: string[] }>('/api/secrets');
  return r.names;
}

export type SecretState = 'saved' | 'absent' | 'unknown';
export type SecretStore = 'keychain' | 'file';

export interface SecretStatus {
  present: boolean | null;
  state: SecretState;
  store: SecretStore | null;
}

export function secretStatus(name: string): Promise<SecretStatus> {
  return request<SecretStatus>(path(name));
}

export function saveSecret(name: string, value: string): Promise<SecretStatus> {
  return owner<SecretStatus>(path(name), { method: 'PUT', body: JSON.stringify({ value }) });
}

export function secretStatusText(s: SecretStatus): string {
  if (s.state === 'unknown') return 'Not checked yet';
  if (s.state === 'absent') return 'Not set';
  return s.store === 'file' ? 'Saved in a file only you can read' : 'Saved in the system keychain';
}

export async function removeSecret(name: string): Promise<void> {
  await owner<void>(path(name), { method: 'DELETE' });
}
