import { t } from '../i18n';
import { toast } from '../toast';

const ALLOWED = /^(https?:\/\/[^\s/]|mailto:[^\s])/i;

async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export async function openExternal(url: string): Promise<void> {
  if (!ALLOWED.test(url)) {
    toast(`${t('Links do not open from the preview')}: ${url}`);
    return;
  }
  if ('__TAURI_INTERNALS__' in window) {
    try {
      const core = await import('@tauri-apps/api/core');
      await core.invoke('plugin:shell|open', { path: url });
      return;
    } catch {
      toast(t('Could not open the link'), 'error');
    }
  }
  toast((await copyLink(url)) ? `${t('Link copied')}: ${url}` : url);
}
