import { request } from './api';
import { owner } from './window-token';

export interface Member {
  handle: string;
  kind: string;
  role_prompt: string;
  state: string;
  model?: string;
  full_access?: boolean;
  held?: unknown[];
}

export interface Card { tool: string; args: string; diff?: string }

export interface Msg {
  seq: number;
  id: string;
  kind: string;
  author: string;
  body: string;
  ts: number;
  status?: string;
  mentions?: string[];
  refs?: number[];
  ledger_refs?: string[];
  unresolved?: string[];
  ack?: boolean;
  error?: string;
  hops?: number;
  run_parent?: number;
  continued_to?: number;
  group?: string;
  round?: number;
  card?: Card;
  simulated?: boolean;
  answer?: { approved: boolean; by: string; ts: number };
  usage?: { prompt: number; completion: number; cost: number };
  tools?: number;
  ms?: number;
}

export interface ChannelDoc {
  name: string;
  seq: number;
  members: Member[];
  messages: Msg[];
  config?: { turn_brake?: number; approval_tools?: string[] };
}

export interface ChannelInfo { name: string; seq: number; last_ts: number; members: number }
export interface Meter { turns: number; prompt_tokens: number; completion_tokens: number; cost: number; groups_open: number }
export interface Spend { prompt_tokens: number; completion_tokens: number; cost: number; calls: number }
export interface CatalogGroup { vendor: string; models: Array<{ id: string; label: string }> }
export interface Preset { name: string; label: string; note: string }
export interface CogStatus { llm_configured: boolean; provider: string; model: string; claude_cli: boolean; simulator: boolean }
export interface ProviderInfo { provider: string; base_url: string; model: string; configured: boolean; has_key: boolean }
export interface PendingApproval { channel: string; seq: number; author: string; card: Card }

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const base = (name: string): string => `/api/cogentics/channels/${encodeURIComponent(name)}`;

export const cogentics = {
  status: () => request<CogStatus>('/api/cogentics/status'),
  provider: () => request<ProviderInfo>('/api/cogentics/provider'),
  setProvider: (body: { provider?: string; base_url?: string; model?: string; api_key?: string }) =>
    owner<ProviderInfo>('/api/cogentics/provider', { method: 'PUT', ...json(body) }),
  forgetKey: () => owner<ProviderInfo>('/api/cogentics/provider/key', { method: 'DELETE' }),
  testProvider: () => owner<{ ok: boolean; detail?: string; models?: string[] }>('/api/cogentics/provider/test', { method: 'POST' }),
  channels: () => request<{ channels: ChannelInfo[] }>('/api/cogentics/channels'),
  create: (name: string) => owner<ChannelDoc>('/api/cogentics/channels', { method: 'POST', ...json({ name }) }),
  channel: (name: string) => request<ChannelDoc>(base(name)),
  remove: (name: string) => owner<{ ok: boolean }>(base(name), { method: 'DELETE' }),
  post: (name: string, body: string, trusted: boolean) => owner<Msg>(`${base(name)}/messages`, { method: 'POST', ...json({ body, trusted }) }),
  addMember: (name: string, body: { handle: string; role_prompt: string; kind: string; full_access: boolean; model: string }) =>
    owner<Member>(`${base(name)}/members`, { method: 'POST', ...json(body) }),
  setState: (name: string, handle: string, state: string, trusted: boolean) =>
    owner<Member>(`${base(name)}/members/${encodeURIComponent(handle)}`, { method: 'PATCH', ...json({ state, trusted }) }),
  removeMember: (name: string, handle: string) => owner<{ ok: boolean }>(`${base(name)}/members/${encodeURIComponent(handle)}`, { method: 'DELETE' }),
  release: (name: string, handle: string, trusted: boolean) =>
    owner<{ released: number }>(`${base(name)}/members/${encodeURIComponent(handle)}/release`, { method: 'POST', ...json({ trusted }) }),
  config: (name: string, body: { turn_brake?: number; approval_tools?: string[] }) =>
    owner<{ config: Record<string, unknown>; gated: string[] }>(`${base(name)}/config`, { method: 'PATCH', ...json(body) }),
  decide: (name: string, seq: number, approved: boolean) => owner<{ decided: number }>(`${base(name)}/approvals/${seq}`, { method: 'POST', ...json({ approved }) }),
  approvals: () => request<{ approvals: PendingApproval[] }>('/api/cogentics/approvals'),
  meter: (name: string) => request<Meter>(`${base(name)}/meter`),
  models: () => request<{ catalog: CatalogGroup[]; cli_models: Array<{ id: string; label: string }>; verified: string }>('/api/cogentics/models'),
  presets: () => request<{ presets: Preset[] }>('/api/cogentics/presets'),
  installPreset: (name: string, preset: string) => owner<{ added: string[]; skipped: string[] }>(`${base(name)}/presets/${encodeURIComponent(preset)}`, { method: 'POST' }),
  stream: (name: string) => new EventSource(`${base(name)}/stream`),
};

export interface UsageBucket { prompt_tokens: number; completion_tokens: number; cost: number; calls: number }
export interface UsageSummary {
  days: number;
  total: UsageBucket;
  by_day: Record<string, UsageBucket>;
  by_model: Record<string, UsageBucket>;
  by_scope: Record<string, UsageBucket>;
}
export interface ScopeInfo { id: string; label: string; created: number; last: number; files: number }
export interface ChangeInfo { path: string; status: string; pre: string }

const scope = (id: string): string => `/api/insight/scopes/${encodeURIComponent(id)}`;

export const insight = {
  summary: (days: number) => request<UsageSummary>(`/api/insight/usage/summary?days=${days}`),
  scopeSpend: (prefix: string) => request<Spend>(`/api/insight/usage/scope/${prefix.split('/').map(encodeURIComponent).join('/')}`),
  scopes: () => request<{ scopes: ScopeInfo[] }>('/api/insight/scopes'),
  changes: (id: string) => request<{ scope: string; changes: ChangeInfo[] }>(`${scope(id)}/changes`),
  diff: (id: string, path: string) => request<{ path: string; diff: string }>(`${scope(id)}/diff?path=${encodeURIComponent(path)}`),
  revert: (id: string, path: string) => owner<{ reverted: string; action: string }>(`${scope(id)}/revert`, { method: 'POST', ...json({ path }) }),
};
