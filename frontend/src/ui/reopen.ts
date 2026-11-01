import { currentWorkspace, openWorkspace, recentWorkspaces } from '../io/workspace';
import { loadPrefs } from './prefs';
import type { WorkspaceInfo } from './workspace-store';

const DEADLINE_MS = 2000;
const RETRY_MS = 250;
const TRIES = 3;

const pause = (ms: number): Promise<void> => new Promise((resolve) => { window.setTimeout(resolve, ms); });

async function attempt(): Promise<WorkspaceInfo | null> {
  const open = await currentWorkspace();
  if (open && open.path) return open;
  const recent = await recentWorkspaces();
  for (const entry of recent.slice(0, TRIES)) {
    try { return await openWorkspace(entry.path); } catch { continue; }
  }
  return null;
}

export async function reopenLastWorkspace(): Promise<WorkspaceInfo | null> {
  if (!loadPrefs().reopenLastWorkspace) return null;
  const until = Date.now() + DEADLINE_MS;
  const run = (async (): Promise<WorkspaceInfo | null> => {
    while (Date.now() < until) {
      try { return await attempt(); } catch { await pause(RETRY_MS); }
    }
    return null;
  })();
  const limit = pause(DEADLINE_MS).then(() => null);
  return Promise.race([run, limit]);
}
