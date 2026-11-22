import { ChangeSet, Text } from '@codemirror/state';
import { detailOf, readFile, renamePath, statusOf, writeFile } from '../../io/workspace';
import { t } from '../i18n';

export interface EditPos { line: number; character: number }
export interface EditRange { start: EditPos; end: EditPos }
export interface TextChange { range: EditRange; newText: string }
interface DocChange { textDocument: { uri: string; version?: number | null }; edits: TextChange[] }
interface FileOptions { overwrite?: boolean; ignoreIfExists?: boolean }
interface FileChange { kind: string; uri?: string; oldUri?: string; newUri?: string; options?: FileOptions }
export interface WorkspaceEdit { changes?: Record<string, TextChange[]>; documentChanges?: Array<DocChange | FileChange> }

export interface OpenDoc { key: string; doc: Text; version: number | null; stale: boolean }

export interface EditHost {
  pathOf(uri: string): string | null;
  sync(): void;
  openDoc(uri: string): OpenDoc | null;
  commit(uri: string, changes: ChangeSet): void;
  settled(uris: string[], written: string[], renamed: Array<{ from: string; to: string }>): void;
}

export interface EditOutcome { applied: boolean; reason: string }

type Step =
  | { kind: 'text'; uri: string; version: number | null; edits: TextChange[] }
  | { kind: 'create'; uri: string; options: FileOptions }
  | { kind: 'rename'; from: string; to: string; options: FileOptions };

interface DiskFile { text: string; mtime: number | null; fresh: boolean }

const refused = (reason: string): EditOutcome => ({ applied: false, reason });
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const unsupported = (): string => t('The language server sent an edit this editor cannot apply');
const moved = (path: string): string => `${baseOf(path)}: ${t('the file changed since the language server read it, so the edit was not applied')}`;

export const textOf = (text: string): Text => Text.of(text.split(/\r\n?|\n/));

const eolOf = (text: string): string => {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
};

const offsetOf = (doc: Text, pos: EditPos): number => {
  if (pos.line >= doc.lines) return doc.length;
  const line = doc.line(Math.max(1, pos.line + 1));
  return Math.min(line.from + Math.max(0, pos.character), line.to);
};

export function changesFor(doc: Text, edits: TextChange[]): ChangeSet {
  const specs = edits.map((e, i) => {
    const from = offsetOf(doc, e.range.start);
    return { from, to: Math.max(from, offsetOf(doc, e.range.end)), insert: e.newText, i };
  });
  specs.sort((a, b) => a.from - b.from || a.i - b.i);
  return ChangeSet.of(specs.map(({ from, to, insert }) => ({ from, to, insert })), doc.length);
}

const validEdits = (list: unknown): list is TextChange[] => Array.isArray(list) && list.every((e: TextChange | null) =>
  !!e && typeof e.newText === 'string' && !!e.range && Number.isInteger(e.range.start?.line) && Number.isInteger(e.range.start?.character) && Number.isInteger(e.range.end?.line) && Number.isInteger(e.range.end?.character));

function stepsOf(edit: WorkspaceEdit | null | undefined): Step[] | null {
  if (!edit || typeof edit !== 'object') return null;
  const out: Step[] = [];
  if (Array.isArray(edit.documentChanges)) {
    for (const raw of edit.documentChanges) {
      if (!raw || typeof raw !== 'object') return null;
      if ('kind' in raw) {
        const options = raw.options ?? {};
        if (raw.kind === 'create' && typeof raw.uri === 'string') out.push({ kind: 'create', uri: raw.uri, options });
        else if (raw.kind === 'rename' && typeof raw.oldUri === 'string' && typeof raw.newUri === 'string') out.push({ kind: 'rename', from: raw.oldUri, to: raw.newUri, options });
        else return null;
        continue;
      }
      const uri = raw.textDocument?.uri;
      if (typeof uri !== 'string' || !validEdits(raw.edits)) return null;
      const version = raw.textDocument.version;
      out.push({ kind: 'text', uri, version: typeof version === 'number' ? version : null, edits: raw.edits });
    }
    return out;
  }
  if (!edit.changes || typeof edit.changes !== 'object') return out;
  for (const [uri, edits] of Object.entries(edit.changes)) {
    if (!validEdits(edits)) return null;
    out.push({ kind: 'text', uri, version: null, edits });
  }
  return out;
}

export function editsOf(edit: WorkspaceEdit | null | undefined, same: (uri: string) => boolean): TextChange[] {
  const out: TextChange[] = [];
  for (const s of stepsOf(edit) ?? []) if (s.kind === 'text' && same(s.uri)) out.push(...s.edits);
  return out;
}

const failure = (verb: string, path: string, err: unknown): EditOutcome =>
  refused(statusOf(err) === 409 ? moved(path) : `${verb} ${baseOf(path)}: ${detailOf(err)}`);

export async function applyWorkspaceEdit(edit: WorkspaceEdit | null | undefined, stamp: ReadonlyMap<string, number>, host: EditHost): Promise<EditOutcome> {
  const steps = stepsOf(edit);
  if (!steps) return refused(unsupported());
  if (!steps.length) return { applied: true, reason: '' };
  const paths = new Map<string, string>();
  const first = new Map<string, string>();
  const one = (uri: string): string | null => {
    const path = host.pathOf(uri);
    if (!path) return null;
    const known = first.get(path) ?? uri;
    first.set(path, known);
    paths.set(known, path);
    return known;
  };
  for (const s of steps) {
    const a = one(s.kind === 'rename' ? s.from : s.uri), b = s.kind === 'rename' ? one(s.to) : a;
    if (a === null || b === null) return refused(t('The edit reaches a file outside the workspace, so it was not applied'));
    if (s.kind === 'rename') { s.from = a; s.to = b; } else s.uri = a;
  }
  const pathFor = (uri: string): string => paths.get(uri) ?? '';
  const made = new Set<string>();
  for (const s of steps) {
    if (s.kind === 'text') continue;
    for (const uri of s.kind === 'rename' ? [s.from, s.to] : [s.uri]) {
      if (host.openDoc(uri)) return refused(`${baseOf(pathFor(uri))}: ${t('Close this file before the language server creates or renames it')}`);
      made.add(uri);
    }
  }
  const disk = new Map<string, DiskFile>();
  for (const s of steps) {
    if (s.kind !== 'text' || made.has(s.uri) || disk.has(s.uri)) continue;
    const open = host.openDoc(s.uri);
    if (open && open.version !== null) continue;
    try {
      const f = await readFile(pathFor(s.uri));
      disk.set(s.uri, { text: f.text, mtime: f.mtime, fresh: false });
    } catch (err) {
      return failure(t('Cannot open'), pathFor(s.uri), err);
    }
  }

  host.sync();
  const live = new Map<string, { doc: Text; changes: ChangeSet | null }>();
  for (const s of steps) {
    if (s.kind !== 'text' || made.has(s.uri)) continue;
    const open = host.openDoc(s.uri);
    if (!open) {
      if (!disk.has(s.uri)) return refused(moved(pathFor(s.uri)));
      continue;
    }
    if (!live.has(s.uri)) {
      const seen = stamp.get(open.key);
      const base = disk.get(s.uri);
      const drifted = open.version === null
        ? !base || !textOf(base.text).eq(open.doc)
        : (seen !== undefined && seen !== open.version) || (s.version !== null && s.version !== open.version) || (seen === undefined && s.version === null);
      if (open.stale || drifted) return refused(moved(pathFor(s.uri)));
      live.set(s.uri, { doc: open.doc, changes: null });
    }
    const at = live.get(s.uri);
    if (!at) continue;
    try {
      const next = changesFor(at.doc, s.edits);
      at.changes = at.changes ? at.changes.compose(next) : next;
      at.doc = next.apply(at.doc);
    } catch {
      return refused(unsupported());
    }
  }
  const touched: string[] = [];
  for (const [uri, at] of live) {
    if (!at.changes || at.changes.empty) continue;
    host.commit(uri, at.changes);
    touched.push(uri);
  }

  const written = new Set<string>();
  const renamed: Array<{ from: string; to: string }> = [];
  const finish = (outcome: EditOutcome): EditOutcome => {
    host.settled(touched, Array.from(written), renamed);
    return outcome;
  };
  for (const s of steps) {
    if (s.kind === 'create') {
      const path = pathFor(s.uri);
      try {
        await writeFile(path, '', null, true);
        disk.set(s.uri, { text: '', mtime: null, fresh: true });
        written.add(path);
      } catch (err) {
        if (statusOf(err) !== 409) return finish(refused(`${t('Cannot create')} ${baseOf(path)}: ${detailOf(err)}`));
        if (s.options.overwrite) disk.set(s.uri, { text: '', mtime: null, fresh: true });
        else if (s.options.ignoreIfExists) {
          try {
            const f = await readFile(path);
            disk.set(s.uri, { text: f.text, mtime: f.mtime, fresh: false });
          } catch (again) {
            return finish(failure(t('Cannot open'), path, again));
          }
        } else return finish(refused(`${t('Cannot create')} ${baseOf(path)}: ${t('a file with that name already exists')}`));
      }
      continue;
    }
    if (s.kind === 'rename') {
      const from = pathFor(s.from), to = pathFor(s.to);
      try {
        await renamePath(from, to);
        const had = disk.get(s.from);
        disk.delete(s.from);
        if (had) disk.set(s.to, had);
        renamed.push({ from, to });
      } catch (err) {
        if (statusOf(err) === 409 && s.options.ignoreIfExists && !s.options.overwrite) continue;
        return finish(refused(`${t('Cannot rename')} ${baseOf(from)}: ${detailOf(err)}`));
      }
      continue;
    }
    if (live.has(s.uri)) continue;
    const path = pathFor(s.uri);
    let file = disk.get(s.uri);
    if (!file) {
      try {
        const f = await readFile(path);
        file = { text: f.text, mtime: f.mtime, fresh: false };
      } catch (err) {
        return finish(failure(t('Cannot open'), path, err));
      }
    }
    try {
      const eol = file.fresh ? eolOf(s.edits.map((e) => e.newText).join('')) : eolOf(file.text);
      const before = textOf(file.fresh ? '' : file.text);
      const after = changesFor(before, s.edits).apply(before);
      const text = after.sliceString(0, after.length, eol);
      const saved = await writeFile(path, text, file.mtime);
      disk.set(s.uri, { text, mtime: saved.mtime, fresh: false });
      written.add(path);
    } catch (err) {
      return finish(err instanceof RangeError ? refused(unsupported()) : failure(t('Save failed:'), path, err));
    }
  }
  return finish({ applied: true, reason: '' });
}
