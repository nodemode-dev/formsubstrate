import { request } from './api';
import { owner } from './window-token';

export type RunStatus = 'running' | 'parked' | 'done' | 'failed' | 'cancelled';
export type RunMode = 'simulate' | 'claude';

export interface RunUsage { prompt_tokens: number; completion_tokens: number; cost: number; calls: number }

export interface RunSummary {
  id: string;
  status: RunStatus;
  name: string;
  task: string;
  mode: string;
  created: number;
  events: number;
  parked_on: ParkedOn | null;
  usage?: RunUsage;
}

export interface ParkedOn { type?: string; tool?: string; args?: Record<string, unknown>; diff?: string | null; seconds?: number; glob?: string }

export interface RunEvent {
  seq: number;
  run_id?: string;
  node_id: string;
  label: string;
  kind: string;
  phase: string;
  note?: string | null;
  ts?: number;
}

export interface Visit {
  n: number;
  status: 'running' | 'done' | 'failed';
  input: string;
  item?: unknown;
  output: string | null;
  error: string | null;
  started: number;
  ended: number | null;
  seq: number;
  seq_end?: number;
}

export interface RunDetail extends Omit<RunSummary, 'events'> {
  events: RunEvent[];
  nodes: Record<string, Visit[]>;
  doc: unknown;
}

export interface RunsEnv { claude: boolean; path: string | null }

export interface ToolInfo { name: string; description: string; args: Record<string, string> }

export const RUN_STARTED = 'subform:run-started';
export const RUN_SELECTED = 'subform:run-selected';
export const RUNS_CHANGED = 'subform:runs-changed';

export const runsApi = {
  env: (): Promise<RunsEnv> => request<RunsEnv>('/api/runs/env'),
  tools: (): Promise<{ tools: ToolInfo[]; approval: string[] }> => request('/api/runs/tools'),
  list: (): Promise<{ runs: RunSummary[] }> => request('/api/runs'),
  detail: (id: string): Promise<RunDetail> => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  start: (doc: unknown, task: string, mode: RunMode): Promise<{ run_id: string; status: string; mode: string }> =>
    owner('/api/runs', { method: 'POST', body: JSON.stringify({ doc, task, mode }) }),
  rerun: (id: string): Promise<{ run_id: string }> => owner(`/api/runs/${encodeURIComponent(id)}/rerun`, { method: 'POST', body: '{}' }),
  resume: (id: string): Promise<unknown> => owner(`/api/runs/${encodeURIComponent(id)}/resume`, { method: 'POST', body: '{}' }),
  cancel: (id: string): Promise<unknown> => owner(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  remove: (id: string): Promise<unknown> => owner(`/api/runs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  decide: (id: string, approved: boolean): Promise<unknown> => owner(`/api/runs/approvals/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ approved }) }),
  graphs: (): Promise<{ graphs: Array<{ name: string }> }> => request('/api/graphs'),
};

export async function tailRun(id: string, onEvent: (ev: RunEvent & { phase: string }) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(id)}/stream`, { signal });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf('\n');
    while (cut >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (line) {
        try { onEvent(JSON.parse(line) as RunEvent); } catch { }
      }
      cut = buffer.indexOf('\n');
    }
  }
}

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function fmtUsage(u?: RunUsage | null): string {
  if (!u || !u.calls) return '';
  const tok = fmtTokens(u.prompt_tokens + u.completion_tokens);
  return u.cost ? `${tok} tok · $${u.cost.toFixed(4)}` : `${tok} tok`;
}
