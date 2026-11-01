import { request } from './api';
import { trustQuery } from './trust';
import { owner } from './window-token';

export interface ToolDef {
  type: 'function';
  source: string;
  function: { name: string; description: string; parameters: JsonSchema };
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, { type?: string; description?: string; enum?: string[] }>;
  required?: string[];
}

export interface SettingSpec {
  name: string;
  label?: string;
  type?: string;
  default?: string;
  secret?: boolean;
  placeholder?: string;
}

export interface PluginInfo {
  name: string;
  description: string;
  path: string;
  origin: 'bundled' | 'workspace';
  tools: string[];
  error: string | null;
  version: string;
  kind: string;
  enabled: boolean;
  loaded: boolean;
  held: string;
  settings_schema: SettingSpec[];
}

export interface PluginSettings {
  schema: SettingSpec[];
  values: Record<string, string>;
  secret_set: Record<string, boolean>;
}

export interface McpRow {
  name: string;
  origin: 'builtin' | 'user';
  transport: string;
  url: string;
  command: string;
  enabled: boolean;
  status: string;
  detail: string;
  tools: number;
  sessions?: boolean;
  header_names?: string[];
}

export interface McpAdd {
  name: string;
  transport: 'http' | 'stdio';
  url: string;
  command: string;
  headers: Record<string, string>;
  sessions: boolean;
}

export interface CollectionRow { name: string; docs: number; updated: number }
export interface CollectionHit { score: number; text: string; meta: Record<string, unknown>; ts: number }

export interface ActivityEvent {
  seq: number;
  ts: number;
  label: string;
  phase: string;
  note: string | null;
  source: string;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const library = {
  tools: (): Promise<{ tools: ToolDef[] }> => request('/api/tools'),
  call: (name: string, args: Record<string, unknown>): Promise<{ result: unknown }> => owner('/api/tools/call', post({ name, args })),
  plugins: (): Promise<{ plugins: PluginInfo[] }> => request(`/api/plugins${trustQuery('?')}`),
  reloadPlugins: (): Promise<{ plugins: PluginInfo[] }> => owner(`/api/plugins/reload${trustQuery('?')}`, { method: 'POST' }),
  enablePlugin: (name: string, enabled: boolean): Promise<{ plugins: PluginInfo[] }> => owner(`/api/plugins/${encodeURIComponent(name)}/enabled${trustQuery('?')}`, post({ enabled })),
  pluginSettings: (name: string): Promise<PluginSettings> => request(`/api/plugins/${encodeURIComponent(name)}/settings`),
  savePluginSettings: (name: string, values: Record<string, string>): Promise<{ plugins: PluginInfo[]; settings: PluginSettings }> => owner(`/api/plugins/${encodeURIComponent(name)}/settings${trustQuery('?')}`, post({ values })),
  mcp: (): Promise<{ servers: McpRow[]; builtin: McpRow[] }> => request('/api/mcp-servers'),
  addMcp: (body: McpAdd): Promise<{ status: string; detail: string; servers: McpRow[] }> => owner('/api/mcp-servers', post(body)),
  refreshMcp: (name: string): Promise<{ status: string; detail: string; servers: McpRow[] }> => owner(`/api/mcp-servers/${encodeURIComponent(name)}/refresh`, { method: 'POST' }),
  enableMcp: (name: string, enabled: boolean): Promise<{ status: string; detail: string; servers: McpRow[] }> => owner(`/api/mcp-servers/${encodeURIComponent(name)}/enabled`, post({ enabled })),
  removeMcp: (name: string): Promise<{ removed: string; servers: McpRow[] }> => owner(`/api/mcp-servers/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  collections: (): Promise<{ collections: CollectionRow[]; workspace?: boolean }> => request('/api/collections'),
  searchCollection: (collection: string, query: string): Promise<{ hits: CollectionHit[] }> => request(`/api/collections/search?collection=${encodeURIComponent(collection)}&query=${encodeURIComponent(query)}&k=6`),
  addDoc: (collection: string, text: string): Promise<{ added: string; docs: number }> => owner('/api/collections/docs', post({ collection, text, meta: { source: 'window' } })),
  removeCollection: (name: string): Promise<{ removed: string }> => owner(`/api/collections/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  activity: (since: number): Promise<{ events: ActivityEvent[]; last: number }> => request(`/api/activity?since=${since}`),
  clearActivity: (): Promise<{ cleared: number }> => owner('/api/activity', { method: 'DELETE' }),
};
