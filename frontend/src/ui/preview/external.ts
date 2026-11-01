import { t } from '../i18n';
import { toast } from '../toast';

const BAD_CHARS = /[\s\u0000-\u001f\u007f-\u009f  ]/;
const SHOWN_MAX = 200;

function checked(url: string): string | null {
  if (typeof url !== 'string' || !url || BAD_CHARS.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === 'mailto:') return parsed.pathname ? parsed.href : null;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.hostname ? parsed.href : null;
}

function shown(href: string): string {
  return href.length > SHOWN_MAX ? `${href.slice(0, SHOWN_MAX)}...` : href;
}

async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export async function openExternal(url: string): Promise<void> {
  const href = checked(url);
  if (href === null) {
    toast(`${t('Links do not open from the preview')}: ${shown(String(url).replace(BAD_CHARS, ' '))}`);
    return;
  }
  if ('__TAURI_INTERNALS__' in window) {
    try {
      const core = await import('@tauri-apps/api/core');
      await core.invoke('plugin:shell|open', { path: href });
      toast(`${t('Opening')}: ${shown(href)}`);
      return;
    } catch {
      toast(`${t('Could not open the link')}: ${shown(href)}`, 'error');
    }
  }
  toast((await copyLink(href)) ? `${t('Link copied')}: ${shown(href)}` : shown(href));
}
