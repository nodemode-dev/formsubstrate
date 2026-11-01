import { el, setHidden } from '../dom';
import type { OpenDoc, WorkspaceStore } from '../workspace-store';

export interface EditorPrefs { fontSize: number; tabSize: number; wordWrap: boolean }

export interface ViewDoc {
  readonly root: HTMLElement;
  activate(): void;
  save(): Promise<boolean>;
  setOptions(o: EditorPrefs): void;
  dispose(): void;
  find?(): void;
  selectNext?(): void;
  selectAllOccurrences?(): void;
}

export class Views {
  private readonly host = el<HTMLElement>('<div class="cv-views" hidden></div>');
  private readonly docs = new Map<string, ViewDoc>();
  private current: string | null = null;
  private options: EditorPrefs;

  constructor(private readonly store: WorkspaceStore, area: HTMLElement, private readonly editorHost: HTMLElement, options: EditorPrefs) {
    this.options = options;
    area.append(this.host);
    store.on('docs', (list) => this.prune(list));
  }

  get prefs(): EditorPrefs { return this.options; }

  has(id: string): boolean { return this.docs.has(id); }

  get showing(): boolean { return this.current !== null; }

  get searchable(): boolean {
    const view = this.current ? this.docs.get(this.current) : undefined;
    return !!view && typeof view.find === 'function';
  }

  find(): boolean {
    const view = this.current ? this.docs.get(this.current) : undefined;
    if (!view) return false;
    view.find?.();
    return true;
  }

  selectNext(): boolean {
    const view = this.current ? this.docs.get(this.current) : undefined;
    if (!view) return false;
    view.selectNext?.();
    return true;
  }

  selectAllOccurrences(): boolean {
    const view = this.current ? this.docs.get(this.current) : undefined;
    if (!view) return false;
    view.selectAllOccurrences?.();
    return true;
  }

  open(id: string, doc: Omit<OpenDoc, 'id' | 'modified'>, make: () => ViewDoc): ViewDoc {
    let view = this.docs.get(id);
    if (!view) {
      view = make();
      this.docs.set(id, view);
      this.host.append(view.root);
      setHidden(view.root, true);
    }
    this.store.openDoc({ id, path: doc.path, name: doc.name, modified: this.store.docs.find((d) => d.id === id)?.modified ?? false });
    return view;
  }

  setModified(id: string, modified: boolean): void {
    this.store.setModified(id, modified);
  }

  show(id: string): boolean {
    const view = this.docs.get(id) ?? null;
    for (const [key, v] of this.docs) setHidden(v.root, key !== id);
    setHidden(this.host, !view);
    setHidden(this.editorHost, !!view);
    this.current = view ? id : null;
    if (view) view.activate();
    return !!view;
  }

  save(): boolean {
    const view = this.current ? this.docs.get(this.current) : undefined;
    if (!view) return false;
    void view.save();
    return true;
  }

  saveAll(): void {
    for (const [id, v] of this.docs) if (this.store.docs.find((d) => d.id === id)?.modified) void v.save();
  }

  setOptions(o: Partial<EditorPrefs>): void {
    this.options = { ...this.options, ...o };
    for (const v of this.docs.values()) v.setOptions(this.options);
  }

  private prune(list: readonly OpenDoc[]): void {
    const live = new Set(list.map((d) => d.id));
    for (const [id, v] of Array.from(this.docs)) {
      if (live.has(id)) continue;
      this.docs.delete(id);
      v.dispose();
      v.root.remove();
      if (this.current === id) {
        this.current = null;
        setHidden(this.host, true);
        setHidden(this.editorHost, false);
      }
    }
  }
}
