import { request } from './api';

export interface GraphFile { path: string; size: number; mtime: number }

export interface GraphReply {
  sig: string;
  root: string;
  nodes: GraphFile[];
  edges: Array<[number, number]>;
  truncated: boolean;
  reason: string;
  parsed: number;
  cached: boolean;
  elapsedMs: number;
}

export interface GraphUnchanged { unchanged: true; sig: string }

export async function fetchGraph(sig: string | null, signal?: AbortSignal): Promise<GraphReply | GraphUnchanged> {
  const q = sig ? `?sig=${encodeURIComponent(sig)}` : '';
  return request<GraphReply | GraphUnchanged>(`/api/graph${q}`, { signal });
}

export const isUnchanged = (r: GraphReply | GraphUnchanged): r is GraphUnchanged => 'unchanged' in r;
