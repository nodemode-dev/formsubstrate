import { openWorkspace } from '../io/workspace';
import { confirmAction } from './dialogs';
import { t } from './i18n';
import { pickPath } from './path-picker';
import { toast } from './toast';
import { workspace as store } from './workspace-store';

let fileOpener: ((relative: string) => Promise<void>) | null = null;

export function setFileOpener(fn: (relative: string) => Promise<void>): void {
  fileOpener = fn;
}

function split(abs: string): { dir: string; name: string; sep: string } {
  const at = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'));
  const sep = abs.includes('\\') && !abs.includes('/') ? '\\' : '/';
  const dir = at <= 0 ? abs.slice(0, at + 1) || sep : abs.slice(0, at);
  return { dir: /^[A-Za-z]:$/.test(dir) ? dir + sep : dir, name: abs.slice(at + 1), sep };
}

function insideOf(root: string, abs: string): string | null {
  const flat = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const base = flat(root), file = flat(abs);
  return file.startsWith(`${base}/`) ? file.slice(base.length + 1) : null;
}

export async function openFolderAt(path: string): Promise<void> {
  if (store.docs.some((d) => d.modified) && !(await confirmAction('Open another folder', t('Files in this folder have unsaved changes. Opening another folder closes them without saving.'), 'Open', true))) return;
  const info = await openWorkspace(path);
  store.setWorkspace(info);
}

export async function openFolderPrompt(): Promise<void> {
  try {
    const path = await pickPath('folder');
    if (path) await openFolderAt(path);
  } catch (e) {
    toast(e instanceof Error && e.message ? e.message : t('Could not open the folder.'), 'error');
  }
}

export async function openFileAt(abs: string): Promise<void> {
  const open = store.workspace?.path;
  const inside = open ? insideOf(open, abs) : null;
  if (inside === null) {
    const { dir, name } = split(abs);
    if (open && !(await confirmAction('Open file', `${t('This file is outside the open workspace. Its folder becomes the workspace:')} ${dir}`, 'Open', false))) return;
    await openFolderAt(dir);
    if (store.workspace?.path !== dir && store.workspace?.path.replace(/\\/g, '/') !== dir.replace(/\\/g, '/')) return;
    await fileOpener?.(name);
    return;
  }
  await fileOpener?.(inside);
}

export async function openFilePrompt(): Promise<void> {
  try {
    const path = await pickPath('file');
    if (path) await openFileAt(path);
  } catch (e) {
    toast(e instanceof Error && e.message ? e.message : t('Could not open the file.'), 'error');
  }
}
