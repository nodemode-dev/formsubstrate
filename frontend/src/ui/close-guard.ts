import { confirmAction } from './dialogs';
import { t } from './i18n';
import type { WorkspaceStore } from './workspace-store';

const EVENT = 'formsubstrate://close-requested';

type Core = typeof import('@tauri-apps/api/core');

let core: Core | null = null;
let armed = false;

const dirty = (store: WorkspaceStore): boolean => store.docs.some((d) => d.modified);

async function arm(on: boolean): Promise<void> {
  if (!core) return;
  const was = armed;
  armed = on;
  try { await core.invoke('close_guard', { armed: on }); } catch { armed = was; }
}

export async function leaveApp(): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) { window.close(); return; }
  await arm(false);
  try {
    const win = await import('@tauri-apps/api/window');
    await win.getCurrentWindow().destroy();
  } catch {
    window.close();
  }
}

export async function installCloseGuard(store: WorkspaceStore): Promise<void> {
  try {
    core = await import('@tauri-apps/api/core');
    const events = await import('@tauri-apps/api/event');
    const sync = (): void => { if (dirty(store) !== armed) void arm(dirty(store)); };
    store.on('docs', sync);
    sync();
    await events.listen(EVENT, () => {
      void (async () => {
        if (!dirty(store) || await confirmAction('Quit without saving', t('Some files have unsaved changes.'), 'Quit', true)) { await leaveApp(); return; }
        await arm(true);
      })();
    });
  } catch {
    core = null;
  }
}
