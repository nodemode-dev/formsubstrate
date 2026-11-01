import { request } from '../../io/api';
import { owner } from '../../io/window-token';

export type TriggerKind = 'interval' | 'delay' | 'watch' | 'webhook';

export interface HistoryEntry { at: number; source: string; run_id?: string; error?: string; skipped?: string }

export interface Trigger {
  id: string;
  kind: TriggerKind;
  spec: { seconds?: number; glob?: string; signed?: boolean };
  action: { kind: string; name?: string; mode?: string; run_id?: string; inputs?: Record<string, string> };
  fires: number;
  enabled: boolean;
  missed?: boolean;
  needs_confirm?: boolean;
  last_fired: number | null;
  next_fire: number | null;
  history: HistoryEntry[];
  path?: string;
}

export interface TriggerList { workspace: string | null; open: boolean; triggers: Trigger[]; min_interval: number }

export interface NewTrigger { kind: TriggerKind; spec: Record<string, unknown>; action: Record<string, unknown> }

export const TRIGGERS_CHANGED = 'subform:triggers-changed';

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const triggersApi = {
  list: (): Promise<TriggerList> => request<TriggerList>('/api/triggers'),
  add: (body: NewTrigger): Promise<{ trigger: Trigger; secret: string | null }> => owner('/api/triggers', { method: 'POST', ...json(body) }),
  enable: (id: string, enabled: boolean): Promise<Trigger> => owner<Trigger>(`/api/triggers/${id}`, { method: 'PATCH', ...json({ enabled }) }),
  remove: (id: string): Promise<unknown> => owner(`/api/triggers/${id}`, { method: 'DELETE' }),
  fire: (id: string): Promise<HistoryEntry> => owner<HistoryEntry>(`/api/triggers/${id}/fire`, { method: 'POST' }),
  confirm: (id: string): Promise<Trigger> => owner<Trigger>(`/api/triggers/${id}/confirm`, { method: 'POST' }),
  trust: (workspace: string, trusted: boolean): Promise<unknown> => owner('/api/triggers/trust', { method: 'POST', ...json({ workspace, trusted }) }),
  webhook: (id: string): Promise<{ path: string; header: string; timestamp_header: string; nonce_header: string; secret: string }> => owner(`/api/triggers/${id}/webhook`),
};

export function clock(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
