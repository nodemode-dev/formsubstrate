import { t } from '../i18n';

export type Cfg = Record<string, unknown>;
export type Value = string | boolean;

export interface Field {
  id: string;
  label: string;
  kinds: readonly string[];
  type: 'text' | 'num' | 'select' | 'check';
  mono?: boolean;
  hint?: string;
  placeholder?: string;
  options?: readonly string[];
  list?: readonly string[];
  min?: number;
  max?: number;
  get(cfg: Cfg): Value;
  set(cfg: Cfg, value: Value): string | null;
}

const AGENTS = ['agent', 'evaluator'] as const;
const str = (cfg: Cfg, key: string, fallback = ''): string => (typeof cfg[key] === 'string' ? (cfg[key] as string) : fallback);

export const FIELDS: readonly Field[] = [
  {
    id: 'model', label: 'Model', kinds: AGENTS, type: 'text', placeholder: 'default (your claude setting)', list: ['sonnet', 'opus', 'haiku'],
    hint: 'Passed to claude --model. Leave empty for the default.',
    get: (c) => str(c, 'model'),
    set: (c, v) => { if (String(v).trim()) c.model = String(v).trim(); else delete c.model; return null; },
  },
  {
    id: 'permission', label: 'Tools', kinds: AGENTS, type: 'select', options: ['read', 'edit', 'plan', 'none'],
    hint: 'read: Read, Grep and Glob only. edit: adds Edit and Write. plan: plan mode. none: no tools.',
    get: (c) => str(c, 'permission', 'read'),
    set: (c, v) => { if (v === 'read') delete c.permission; else c.permission = String(v); return null; },
  },
  {
    id: 'timeout_s', label: 'Timeout (seconds)', kinds: AGENTS, type: 'num', min: 10, max: 7200,
    get: (c) => (typeof c.timeout_s === 'number' ? String(c.timeout_s) : '600'),
    set: (c, v) => {
      const n = Number(String(v).trim());
      if (!Number.isFinite(n) || n < 10) return t('Timeout must be at least 10 seconds');
      c.timeout_s = n;
      return null;
    },
  },
  {
    id: 'approve', label: 'Wait for approval before running', kinds: ['tool'], type: 'check',
    hint: 'Every tool except list_files and read_file always waits for your approval.',
    get: (c) => c.approve === true,
    set: (c, v) => { if (v) c.approve = true; else delete c.approve; return null; },
  },
];
