export interface WorkspaceInfo { path: string; name: string; isFormRepo: boolean; branch: string }
export interface OpenDoc { id: string; path: string; name: string; modified: boolean }
export interface Job { id: string; label: string; progress: number; done: boolean; cancel?: () => void }
export interface SessionsSummary { working: number; needsInput: number }

export interface StoreEvents {
  workspace: WorkspaceInfo | null;
  docs: readonly OpenDoc[];
  active: string | null;
  jobs: readonly Job[];
  sessions: SessionsSummary;
}

type Listener<K extends keyof StoreEvents> = (value: StoreEvents[K]) => void;

const DONE_LINGER_MS = 8000;

export class WorkspaceStore {
  private ws: WorkspaceInfo | null = null;
  private docList: OpenDoc[] = [];
  private activeId: string | null = null;
  private jobList: Job[] = [];
  private summary: SessionsSummary = { working: 0, needsInput: 0 };
  private readonly listeners: { [K in keyof StoreEvents]: Set<Listener<K>> } = {
    workspace: new Set(), docs: new Set(), active: new Set(), jobs: new Set(), sessions: new Set(),
  };

  on<K extends keyof StoreEvents>(event: K, fn: Listener<K>): () => void {
    (this.listeners[event] as Set<Listener<K>>).add(fn);
    return () => { (this.listeners[event] as Set<Listener<K>>).delete(fn); };
  }

  private emit<K extends keyof StoreEvents>(event: K, value: StoreEvents[K]): void {
    for (const fn of Array.from(this.listeners[event] as Set<Listener<K>>)) fn(value);
  }

  get workspace(): WorkspaceInfo | null { return this.ws; }
  get docs(): readonly OpenDoc[] { return this.docList; }
  get active(): OpenDoc | null { return this.docList.find((d) => d.id === this.activeId) ?? null; }
  get jobs(): readonly Job[] { return this.jobList; }
  get sessions(): SessionsSummary { return this.summary; }
  get busy(): boolean { return this.jobList.some((j) => !j.done); }

  setWorkspace(info: WorkspaceInfo | null): void {
    this.ws = info;
    this.emit('workspace', info);
  }

  setBranch(branch: string): void {
    if (!this.ws || this.ws.branch === branch) return;
    this.ws = { ...this.ws, branch };
    this.emit('workspace', this.ws);
  }

  openDoc(doc: OpenDoc): void {
    const at = this.docList.findIndex((d) => d.id === doc.id);
    if (at >= 0) this.docList[at] = doc; else this.docList.push(doc);
    this.docList = [...this.docList];
    this.emit('docs', this.docList);
    this.setActive(doc.id);
  }

  closeDoc(id: string): void {
    const at = this.docList.findIndex((d) => d.id === id);
    if (at < 0) return;
    this.docList = this.docList.filter((d) => d.id !== id);
    this.emit('docs', this.docList);
    if (this.activeId === id) this.setActive(this.docList[Math.min(at, this.docList.length - 1)]?.id ?? null);
  }

  setModified(id: string, modified: boolean): void {
    const at = this.docList.findIndex((d) => d.id === id);
    if (at < 0 || this.docList[at].modified === modified) return;
    this.docList = this.docList.map((d) => (d.id === id ? { ...d, modified } : d));
    this.emit('docs', this.docList);
  }

  setActive(id: string | null): void {
    if (this.activeId === id) return;
    this.activeId = id;
    this.emit('active', id);
  }

  upsertJob(job: Job): void {
    const at = this.jobList.findIndex((j) => j.id === job.id);
    this.jobList = at >= 0 ? this.jobList.map((j) => (j.id === job.id ? job : j)) : [...this.jobList, job];
    this.emit('jobs', this.jobList);
  }

  finishJob(id: string): void {
    const at = this.jobList.findIndex((j) => j.id === id);
    if (at < 0) return;
    this.jobList = this.jobList.map((j) => (j.id === id ? { ...j, done: true, progress: 1 } : j));
    this.emit('jobs', this.jobList);
    window.setTimeout(() => this.removeJob(id), DONE_LINGER_MS);
  }

  removeJob(id: string): void {
    if (!this.jobList.some((j) => j.id === id)) return;
    this.jobList = this.jobList.filter((j) => j.id !== id);
    this.emit('jobs', this.jobList);
  }

  setSessions(summary: SessionsSummary): void {
    if (summary.working === this.summary.working && summary.needsInput === this.summary.needsInput) return;
    this.summary = { ...summary };
    this.emit('sessions', this.summary);
  }
}

export const workspace = new WorkspaceStore();
