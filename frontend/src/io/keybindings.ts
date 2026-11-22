import type { Commands } from '../ui/commands';
import { request } from './api';
import { owner } from './window-token';

export const KEYS_EVENT = 'formsubstrate:keys-changed';

const LOAD_WAIT_MS = 8000;
const RETRY_MS = 3000;
const RETRIES = 20;

type Saved = Record<string, string[]>;

let loaded = false;
let chain: Promise<void> = Promise.resolve();

function shaped(raw: unknown): Saved {
  const keys = raw && typeof raw === 'object' ? (raw as { keys?: unknown }).keys : null;
  const out: Saved = {};
  if (!keys || typeof keys !== 'object') return out;
  for (const [id, combos] of Object.entries(keys as Record<string, unknown>)) {
    if (Array.isArray(combos)) out[id] = combos.filter((c): c is string => typeof c === 'string' && c.length > 0);
  }
  return out;
}

async function fetchSaved(waitMs: number): Promise<Saved> {
  const stop = new AbortController();
  const timer = window.setTimeout(() => stop.abort(), waitMs);
  try { return shaped(await request<unknown>('/api/keybindings', { signal: stop.signal })); }
  finally { window.clearTimeout(timer); }
}

export const keysLoaded = (): boolean => loaded;

export async function adoptSavedKeys(commands: Commands, tries = RETRIES): Promise<boolean> {
  if (loaded) return true;
  try {
    const saved = await fetchSaved(LOAD_WAIT_MS);
    if (loaded) return true;
    loaded = true;
    if (Object.keys(saved).length) {
      commands.adopt(saved);
      window.dispatchEvent(new Event(KEYS_EVENT));
    }
    return true;
  } catch {
    if (tries > 0) window.setTimeout(() => { void adoptSavedKeys(commands, tries - 1); }, RETRY_MS);
    return false;
  }
}

export function commitKeys(commands: Commands): Promise<boolean> {
  const keys = commands.overrides();
  commands.remember(keys);
  window.dispatchEvent(new Event(KEYS_EVENT));
  const run = chain.then(() => owner<unknown>('/api/keybindings', { method: 'PUT', body: JSON.stringify({ keys }) })).then(() => true, () => false);
  chain = run.then(() => undefined);
  return run;
}
