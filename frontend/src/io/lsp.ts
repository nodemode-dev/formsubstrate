import { request } from './api';
import { trustQuery } from './trust';

export type LspLang = 'typescript' | 'python';

export interface LspCandidate {
  name: string;
  kind: string;
  found: boolean;
  path: string | null;
  version: string | null;
  usable: boolean;
  note: string;
}

export interface LspServerInfo {
  lang: LspLang;
  label: string;
  exts: string[];
  install: string[];
  found: boolean;
  active: { name: string; path: string; kind: string; version: string | null } | null;
  candidates: LspCandidate[];
  notes: string[];
}

export interface LspServers {
  root: string | null;
  running: number;
  servers: LspServerInfo[];
}

export function lspServers(): Promise<LspServers> {
  return request<LspServers>('/api/lsp/servers');
}

export function lspSocketUrl(lang: LspLang): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/api/lsp/ws?lang=${lang}${trustQuery('&')}`;
}
