import { openWorkspace } from '../io/workspace';
import { promptName } from './dialogs';
import { t } from './i18n';
import { toast } from './toast';
import { workspace as store } from './workspace-store';

const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;

async function pickPath(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const chosen = await open({ directory: true, multiple: false, title: t('Open folder') });
    return typeof chosen === 'string' ? chosen : null;
  }
  const typed = await promptName(t('Open folder: absolute path'), '', t('Open'));
  return typed && typed.trim() ? typed.trim() : null;
}

export async function openFolderAt(path: string): Promise<void> {
  const info = await openWorkspace(path);
  store.setWorkspace(info);
}

export async function openFolderPrompt(): Promise<void> {
  try {
    const path = await pickPath();
    if (path) await openFolderAt(path);
  } catch (e) {
    toast(e instanceof Error && e.message ? e.message : t('Could not open the folder.'), 'error');
  }
}
