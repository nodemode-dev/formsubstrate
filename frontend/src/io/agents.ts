import { request } from './api';
import { owner } from './window-token';

export type AgentProgram = 'claude' | 'codex' | 'cursor' | 'antigravity';
export type AgentFinding = 'runs' | 'found' | 'broken' | 'missing';

export interface AgentInfo {
  program: AgentProgram;
  title: string;
  path: string | null;
  version: string | null;
  finding: AgentFinding;
  how: string;
  error: string;
  install: string;
  setting: string;
  mcp: boolean;
  gates: boolean;
  modes: string[];
}

export interface FormnetStatus {
  enabled: boolean;
  proxy: string;
  portOpen: boolean;
  certPath: string;
  certFound: string | null;
  certSource: 'setting' | 'FORMNET_DATA' | 'home';
  certFolder: string;
  bundle: string | null;
  bundleProblem: string;
  active: boolean;
}

export const AGENT_PROGRAMS: ReadonlyArray<readonly [AgentProgram, string]> = [['claude', 'Claude Code'], ['codex', 'Codex'], ['cursor', 'Cursor'], ['antigravity', 'Antigravity']];

export const AGENT_MODES: Record<AgentProgram, ReadonlyArray<'default' | 'acceptEdits' | 'plan'>> = {
  claude: ['acceptEdits', 'default', 'plan'],
  codex: ['acceptEdits', 'default', 'plan'],
  cursor: ['default', 'plan'],
  antigravity: ['acceptEdits', 'plan'],
};
export const agentTitle = (program: string | null | undefined): string => AGENT_PROGRAMS.find(([k]) => k === program)?.[1] ?? 'Claude Code';

const PROGRAM_SET = new Set<string>(AGENT_PROGRAMS.map(([k]) => k));
const isInfo = (v: unknown): v is AgentInfo => !!v && typeof v === 'object' && PROGRAM_SET.has(String((v as { program?: unknown }).program)) && Array.isArray((v as { modes?: unknown }).modes);

let known: AgentInfo[] = [];
let pending: Promise<AgentInfo[]> | null = null;

export const agents = {
  cached(): readonly AgentInfo[] { return known; },
  list(): Promise<AgentInfo[]> {
    if (!pending) {
      const mine = request<{ agents: unknown[] }>('/api/agents').then((r) => {
        known = (Array.isArray(r.agents) ? r.agents : []).filter(isInfo);
        return known;
      }).finally(() => { if (pending === mine) pending = null; });
      pending = mine;
    }
    return pending;
  },
  async setPath(program: AgentProgram, path: string): Promise<AgentInfo> {
    const info = await owner<AgentInfo>(`/api/agents/${program}/path`, { method: 'PUT', body: JSON.stringify({ path }) });
    known = known.map((a) => (a.program === program ? info : a));
    return info;
  },
};

export interface IdeLinkStatus { enabled: boolean; running: boolean; port: number | null; clients: number }

export const ideLink = {
  status(): Promise<IdeLinkStatus> { return request<IdeLinkStatus>('/api/ide/settings'); },
  save(enabled: boolean): Promise<IdeLinkStatus> { return owner<IdeLinkStatus>('/api/ide/settings', { method: 'PUT', body: JSON.stringify({ enabled }) }); },
};

export const formnet = {
  status(): Promise<FormnetStatus> { return request<FormnetStatus>('/api/formnet'); },
  save(body: { enabled?: boolean; certPath?: string }): Promise<FormnetStatus> { return owner<FormnetStatus>('/api/formnet', { method: 'PUT', body: JSON.stringify(body) }); },
};
