import { currentWorkspace, openWorkspace, recentWorkspaces } from '../io/workspace';
import { loadPrefs } from './prefs';
import type { WorkspaceInfo } from './workspace-store';

const DEADLINE_MS = 2000;
const RETRY_MS = 250;
const TRIES = 10;
export const REOPENED_EVENT = 'formsubstrate:reopened';

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
  let late = false;
  const limit = pause(DEADLINE_MS).then(() => { late = true; return null; });
  void run.then((info) => { if (late && info) window.dispatchEvent(new CustomEvent<WorkspaceInfo>(REOPENED_EVENT, { detail: info })); });
  return Promise.race([run, limit]);
}
