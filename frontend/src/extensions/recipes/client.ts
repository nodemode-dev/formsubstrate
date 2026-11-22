import { request } from '../../io/api';
import { workspaceTrusted } from '../../io/trust';
import { owner } from '../../io/window-token';

export interface RecipeInput { name: string; label?: string; type?: string; default?: string; required?: boolean; placeholder?: string }

export interface RecipeRow {
  name: string;
  description: string;
  inputs: RecipeInput[];
  skills: string[];
  nodes: number;
  installed?: boolean;
}

export interface RecipeFull extends RecipeRow {
  doc: Record<string, unknown>;
  task_template: string;
}

export interface RecipeList { recipes: RecipeRow[]; presets: RecipeRow[]; note: string }

export interface RunStarted { run_id: string; status: string; mode: string; task: string; recipe: string }

export interface GraphRow { name: string; nodes: number; valid: boolean }

export interface RunEnv { claude: boolean }

export const RUN_STARTED = 'formsubstrate:run-started';
export const RECIPES_CHANGED = 'formsubstrate:recipes-changed';

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const recipesApi = {
  list: (): Promise<RecipeList> => request<RecipeList>('/api/recipes'),
  get: (name: string): Promise<RecipeFull> => request<RecipeFull>(`/api/recipes/${encodeURIComponent(name)}`),
  save: (recipe: { name: string; description: string; doc: Record<string, unknown>; task_template: string; inputs: RecipeInput[]; skills: string[] }): Promise<unknown> =>
    owner(`/api/recipes/${encodeURIComponent(recipe.name)}`, { method: 'PUT', ...json(recipe) }),
  remove: (name: string): Promise<unknown> => owner(`/api/recipes/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  run: (name: string, inputs: Record<string, string>, mode: string): Promise<RunStarted> =>
    owner<RunStarted>(`/api/recipes/${encodeURIComponent(name)}/run`, { method: 'POST', ...json({ inputs, mode, trust: workspaceTrusted() }) }),
  install: (name: string): Promise<unknown> => owner(`/api/recipes/presets/${encodeURIComponent(name)}/install`, { method: 'POST' }),
  graphs: (): Promise<{ graphs: GraphRow[] }> => request<{ graphs: GraphRow[] }>('/api/graphs'),
  graph: (name: string): Promise<{ text: string }> => request<{ text: string }>(`/api/graphs/${encodeURIComponent(name)}`),
  env: (): Promise<RunEnv> => request<RunEnv>('/api/runs/env'),
};

export function placeholdersOf(template: string): RecipeInput[] {
  const seen = new Set<string>();
  const out: RecipeInput[] = [];
  for (const m of template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ name: m[1], label: m[1], type: 'text', required: true });
  }
  return out;
}

const MODE_KEY = 'formsubstrate.recipes.mode';

export function savedMode(): string {
  try { return localStorage.getItem(MODE_KEY) === 'claude' ? 'claude' : 'simulate'; } catch { return 'simulate'; }
}

export function keepMode(mode: string): void {
  try { localStorage.setItem(MODE_KEY, mode); } catch { return; }
}
