import { request } from './api';
import { owner } from './window-token';
import type { GraphDoc } from '../engine';

export interface SavedGraph { name: string; path: string; mtime: number; size: number; nodes: number; edges: number; valid: boolean; docName?: string }
export interface GraphPreset { name: string; description: string; nodes: number; edges: number }
export interface GraphFile { name: string; path: string; text: string; mtime: number }
export interface GraphSaved { name: string; path: string; mtime: number; warnings: string[] }
export interface Validation { ok: boolean; errors: string[]; warnings: string[] }

const enc = encodeURIComponent;

export async function listSavedGraphs(): Promise<SavedGraph[]> {
  return (await request<{ graphs: SavedGraph[] }>('/api/graphs')).graphs;
}

export function readSavedGraph(name: string): Promise<GraphFile> {
  return request<GraphFile>(`/api/graphs/${enc(name)}`);
}

export function saveGraph(name: string, doc: GraphDoc, expectedMtime: number | null, create: boolean): Promise<GraphSaved> {
  return owner<GraphSaved>(`/api/graphs/${enc(name)}`, { method: 'PUT', body: JSON.stringify({ doc, expectedMtime, create }) });
}

export async function deleteSavedGraph(name: string): Promise<void> {
  await owner<unknown>(`/api/graphs/${enc(name)}`, { method: 'DELETE' });
}

export async function listPresets(): Promise<GraphPreset[]> {
  return (await request<{ presets: GraphPreset[] }>('/api/presets/graphs')).presets;
}

export function installPreset(name: string): Promise<{ name: string; path: string; mtime: number }> {
  return owner(`/api/graphs/presets/${enc(name)}/install`, { method: 'POST', body: '{}' });
}

export function validateGraph(doc: GraphDoc): Promise<Validation> {
  return request<Validation>('/api/graphs/validate', { method: 'POST', body: JSON.stringify({ doc }) });
}

export async function listToolNames(): Promise<string[]> {
  try {
    const raw = await request<unknown>('/api/tools');
    const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && 'tools' in raw && Array.isArray((raw as { tools: unknown }).tools) ? (raw as { tools: unknown[] }).tools : [];
    const names: string[] = [];
    for (const r of rows) {
      if (typeof r === 'string') names.push(r);
      else if (r && typeof r === 'object') {
        const o = r as { name?: unknown; function?: { name?: unknown } };
        const n = typeof o.name === 'string' ? o.name : typeof o.function?.name === 'string' ? o.function.name : '';
        if (n) names.push(n);
      }
    }
    return names;
  } catch {
    return [];
  }
}
