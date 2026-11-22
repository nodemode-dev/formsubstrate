import { ChangeSet, Text, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { LSPPlugin, Workspace, type LSPClient, type WorkspaceFile } from '@codemirror/lsp-client';

interface FileUpdate { file: WorkspaceFile; prevDoc: Text; changes: ChangeSet }

export interface WorkspaceHost {
  pathOf(uri: string): string | null;
  open(path: string): Promise<boolean>;
  transact(path: string, spec: TransactionSpec): void;
  read(path: string): Promise<string | null>;
  attached(file: SfFile): void;
  released(file: SfFile): void;
}

export class SfFile implements WorkspaceFile {
  constructor(
    readonly uri: string,
    readonly languageId: string,
    public version: number,
    public doc: Text,
    public view: EditorView | null,
  ) {}

  getView(): EditorView | null {
    return this.view;
  }
}

const decoded = (uri: string): string => {
  try { return decodeURIComponent(uri); } catch { return uri; }
};

export class SfWorkspace extends Workspace {
  files: SfFile[] = [];
  private readonly versions = new Map<string, number>();

  constructor(client: LSPClient, private readonly host: WorkspaceHost) {
    super(client);
  }

  private next(uri: string): number {
    const n = (this.versions.get(uri) ?? -1) + 1;
    this.versions.set(uri, n);
    return n;
  }

  getFile(uri: string): SfFile | null {
    const exact = this.files.find((f) => f.uri === uri);
    if (exact) return exact;
    const flat = decoded(uri);
    return this.files.find((f) => decoded(f.uri) === flat) ?? null;
  }

  syncFiles(): readonly FileUpdate[] {
    const out: FileUpdate[] = [];
    for (const file of this.files) {
      const view = file.view;
      const plugin = view ? LSPPlugin.get(view) : null;
      if (!view || !plugin) continue;
      let changes = plugin.unsyncedChanges;
      if (!file.doc.eq(plugin.syncedDoc)) changes = ChangeSet.of({ from: 0, to: file.doc.length, insert: view.state.doc }, file.doc.length);
      else if (changes.empty) continue;
      out.push({ file, changes, prevDoc: file.doc });
      file.doc = view.state.doc;
      file.version = this.next(file.uri);
      plugin.clear();
    }
    return out;
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    const have = this.getFile(uri);
    if (have) {
      have.view = view;
      this.host.attached(have);
      return;
    }
    const file = new SfFile(uri, languageId, this.next(uri), view.state.doc, view);
    this.files.push(file);
    this.client.didOpen(file);
    this.host.attached(file);
  }

  closeFile(uri: string, view: EditorView): void {
    const file = this.getFile(uri);
    if (file && file.view === view) file.view = null;
  }

  pushHidden(file: SfFile, doc: Text): void {
    if (file.view) return;
    file.doc = doc;
    file.version = this.next(file.uri);
    this.client.notification('textDocument/didChange', { textDocument: { uri: file.uri, version: file.version }, contentChanges: [{ text: doc.toString() }] });
  }

  release(uri: string): void {
    const file = this.getFile(uri);
    if (!file) return;
    this.files = this.files.filter((f) => f !== file);
    this.client.didClose(file.uri);
    this.host.released(file);
  }

  async requestFile(uri: string): Promise<SfFile | null> {
    const have = this.getFile(uri);
    if (have) return have;
    const path = this.host.pathOf(uri);
    if (path === null) return null;
    const text = await this.host.read(path);
    if (text === null) return null;
    return new SfFile(uri, '', -1, Text.of(text.split(/\r\n|\r|\n/)), null);
  }

  async displayFile(uri: string): Promise<EditorView | null> {
    const path = this.host.pathOf(uri);
    if (path === null) return null;
    if (!(await this.host.open(path))) return null;
    return this.getFile(uri)?.view ?? null;
  }

  updateFile(uri: string, update: TransactionSpec): void {
    const file = this.getFile(uri);
    if (!file) return;
    if (file.view) { file.view.dispatch(update); return; }
    const path = this.host.pathOf(uri);
    if (path !== null) this.host.transact(path, update);
  }
}
