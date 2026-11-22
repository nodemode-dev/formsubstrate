import { sessionsClient } from '../../io/sessions';
import type { Commands } from '../commands';
import { baseName } from '../editor/languages';
import { t } from '../i18n';
import { loadPrefs } from '../prefs';
import type { WorkspaceStore } from '../workspace-store';
import type { DiffTarget } from './diff-view';
import { Views } from './views';

const OPEN_DIFF = 'formsubstrate:open-diff';
const OPEN_REVIEW = 'formsubstrate:open-review';
const diffId = (x: DiffTarget): string => (x.commit ? `diff:${x.session ?? 'workspace'}:commit:${x.commit}:${x.path}` : `diff:${x.session ?? 'workspace'}:${x.staged ? 'staged' : 'work'}:${x.path}`);

const COMMIT_RE = /^[0-9a-f]{4,64}$/i;

const reviewId = (session: string | null): string => `review:${session ?? 'workspace'}`;

const isTarget = (v: unknown): v is DiffTarget => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.path === 'string' && o.path.length > 0 && typeof o.staged === 'boolean' && (o.session === null || o.session === undefined || typeof o.session === 'string');
};

export function installReview(store: WorkspaceStore, commands: Commands, area: HTMLElement, editorHost: HTMLElement): Views {
  const pr = loadPrefs();
  const views = new Views(store, area, editorHost, { fontSize: pr.editorFontSize, tabSize: pr.editorTabSize, wordWrap: pr.editorWordWrap });

  const openDiff = (x: DiffTarget): void => {
    const id = diffId(x);
    const where = x.commit ? (x.short ?? x.commit.slice(0, 7)) : x.staged ? t('staged') : x.session ? t('session') : t('working tree');
    void import('./diff-view').then(({ DiffTab }) => {
      views.open(id, { name: `${baseName(x.path)} (${where})`, path: x.commit ? `${t('Diff')}: ${x.path} (${x.commit})` : `${t('Diff')}: ${x.path}` }, () => new DiffTab(x, views.prefs, (dirty) => views.setModified(id, dirty)));
      views.show(id);
    });
  };

  const openReview = (session: string | null): void => {
    const id = reviewId(session);
    const label = session ? (sessionsClient.get(session)?.title ?? session) : t('workspace');
    void import('./review-pane').then(({ ReviewPane }) => {
      views.open(id, { name: `${t('Review')}: ${label}`, path: `${t('Review changes')}: ${label}` }, () => new ReviewPane(session));
      views.show(id);
    });
  };

  window.addEventListener(OPEN_DIFF, (e) => {
    const d = (e as CustomEvent<unknown>).detail;
    if (!isTarget(d)) return;
    const commit = typeof d.commit === 'string' && COMMIT_RE.test(d.commit) ? d.commit : undefined;
    const short = commit && typeof d.short === 'string' && COMMIT_RE.test(d.short) ? d.short : undefined;
    openDiff(commit ? { path: d.path, staged: false, session: d.session ?? null, commit, short } : { path: d.path, staged: d.staged, session: d.session ?? null });
  });

  window.addEventListener(OPEN_REVIEW, (e) => {
    const d = (e as CustomEvent<{ session?: string | null } | null>).detail;
    openReview(typeof d?.session === 'string' ? d.session : null);
  });

  commands.add({
    id: 'git-review',
    label: 'Review Changes',
    enabled: () => !!store.workspace,
    run: () => { window.dispatchEvent(new CustomEvent(OPEN_REVIEW, { detail: { session: null } })); },
  });

  return views;
}
