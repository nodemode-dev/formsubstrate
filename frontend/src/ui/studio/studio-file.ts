import { emptyDoc, textToDoc, type GraphDoc } from '../../engine';
import { ApiError } from '../../io/api';
import { deleteSavedGraph, readSavedGraph, saveGraph } from '../../io/studio';
import { confirmAction } from '../dialogs';
import { t } from '../i18n';
import { toast } from '../toast';
import { studio } from './api';

export const sanitizeName = (raw: string): string => {
  const flat = raw.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').replace(/-+$/, '').slice(0, 80);
  return flat || 'untitled';
};

export function starterDoc(name = 'untitled'): GraphDoc {
  return {
    version: 1,
    name,
    nodes: [
      { id: 's', kind: 'start', label: 'start', x: 40, y: 150 },
      { id: 'a', kind: 'agent', label: 'agent', x: 260, y: 150, config: { prompt: '' } },
      { id: 'e', kind: 'end', label: 'end', x: 480, y: 150 },
    ],
    edges: [
      { id: '1', from: 's', to: 'a' },
      { id: '2', from: 'a', to: 'e' },
    ],
  };
}

const detail = (err: unknown): string => (err instanceof Error ? err.message.replace(/^\d{3}\s*/, '') : String(err));

export async function confirmDiscard(): Promise<boolean> {
  if (!studio.engine.dirty) return true;
  return confirmAction(t('Discard unsaved changes'), t('The graph in Studio has unsaved changes.'), t('Discard'), true);
}

export async function newGraph(): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  studio.engine.replace(starterDoc(), 'system');
  studio.setFile(null);
  studio.select(null);
  return true;
}

export async function loadSaved(name: string): Promise<boolean> {
  if (studio.fileName !== name && !(await confirmDiscard())) return false;
  try {
    const file = await readSavedGraph(name);
    const parsed = textToDoc(file.text);
    if (!parsed.ok) {
      toast(`${name}: ${parsed.errors[0]}`, 'error');
      return false;
    }
    studio.engine.replace(parsed.doc, 'system');
    studio.setFile({ name, mtime: file.mtime });
    studio.select(null);
    return true;
  } catch (err) {
    toast(detail(err), 'error');
    return false;
  }
}

export async function saveCurrent(): Promise<boolean> {
  const doc = studio.getDoc();
  const name = sanitizeName(doc.name);
  const previous = studio.fileName;
  const same = previous === name;
  try {
    const saved = await saveGraph(name, doc, same ? studio.fileMtime : null, !same);
    return done(saved.name, saved.mtime, saved.warnings, previous);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const text = same ? t('The graph changed on disk since it was opened. Overwrite it?') : t('A graph with this name already exists. Overwrite it?');
      if (!(await confirmAction(t('Save graph'), text, t('Overwrite'), true))) return false;
      try {
        const saved = await saveGraph(name, doc, null, false);
        return done(saved.name, saved.mtime, saved.warnings, previous);
      } catch (again) {
        toast(detail(again), 'error');
        return false;
      }
    }
    toast(detail(err), 'error');
    return false;
  }
}

async function done(name: string, mtime: number, warnings: string[], previous: string | null): Promise<boolean> {
  studio.setFile({ name, mtime });
  studio.engine.markSaved();
  if (previous && previous !== name) {
    try { await deleteSavedGraph(previous); } catch (err) { toast(detail(err), 'error'); }
  }
  studio.graphsChanged();
  if (warnings.length) toast(`${t('Saved with a warning')}: ${warnings[0]}`, 'info');
  return true;
}

export async function removeSaved(name: string): Promise<boolean> {
  if (!(await confirmAction(t('Delete graph'), `${name} ${t('will be removed from .formsubstrate/graphs.')}`, t('Delete'), true))) return false;
  try {
    await deleteSavedGraph(name);
    if (studio.fileName === name) studio.setFile(null);
    studio.graphsChanged();
    return true;
  } catch (err) {
    toast(detail(err), 'error');
    return false;
  }
}
