import { loadPrefs, updatePrefs } from '../ui/prefs';
import { workspace } from '../ui/workspace-store';

export const TRUST_EVENT = 'subform:trust-changed';

const same = (a: string, b: string): boolean => a === b;

export function isTrusted(path: string | null | undefined): boolean {
  return !!path && loadPrefs().trustedWorkspaces.some((p) => same(p, path));
}

export function wasAsked(path: string): boolean {
  return loadPrefs().trustAsked.some((p) => same(p, path));
}

export function workspaceTrusted(): boolean {
  return isTrusted(workspace.workspace?.path);
}

export function markAsked(path: string): void {
  const p = loadPrefs();
  if (p.trustAsked.includes(path)) return;
  updatePrefs({ trustAsked: [...p.trustAsked, path].slice(-200) });
}

export function setTrusted(path: string, on: boolean): void {
  const p = loadPrefs();
  const has = p.trustedWorkspaces.includes(path);
  if (has === on) return;
  updatePrefs({
    trustedWorkspaces: on ? [...p.trustedWorkspaces, path].slice(-200) : p.trustedWorkspaces.filter((x) => x !== path),
    trustAsked: p.trustAsked.includes(path) ? p.trustAsked : [...p.trustAsked, path].slice(-200),
  });
  window.dispatchEvent(new CustomEvent<string>(TRUST_EVENT, { detail: path }));
}

export const trustQuery = (first: '?' | '&'): string => (workspaceTrusted() ? `${first}trust=1` : '');
