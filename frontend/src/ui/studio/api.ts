import { emptyDoc, Engine, type ChangeEvent, type GraphDoc, type NodeStatus, type Origin, type ParseResult, type StatusEvent } from '../../engine';

export const RUN_EVENT = 'formsubstrate:run-event';
export const RUN_FINISHED = 'formsubstrate:run-finished';
export const STUDIO_SELECT = 'formsubstrate:studio-select';
export const STUDIO_GRAPHS_CHANGED = 'formsubstrate:studio-graphs-changed';
export const STUDIO_OPEN = 'formsubstrate:studio-open';
export const STUDIO_FILE = 'formsubstrate:studio-file';

export interface RunEventDetail {
  node_id?: string;
  phase?: 'enter' | 'exit' | 'yielded' | 'loop' | 'halt' | 'error' | 'parked';
  status?: NodeStatus;
}

export interface StudioAction {
  id: string;
  label: string;
  icon: string;
  title?: string;
  run(): void;
  enabled?(): boolean;
}

export type Selection = { kind: 'node' | 'edge'; id: string } | null;

type Opener = (name: string | null) => Promise<boolean>;

class StudioHub {
  readonly engine = new Engine(emptyDoc('untitled'));
  private file: { name: string; mtime: number } | null = null;
  private picked: Selection = null;
  private readonly actionList: StudioAction[] = [];
  private readonly selectors = new Set<(s: Selection) => void>();
  private readonly actionWatchers = new Set<() => void>();
  private opener: Opener | null = null;

  constructor() {
    window.addEventListener(RUN_EVENT, (e) => {
      const d = (e as CustomEvent<RunEventDetail>).detail;
      if (!d || !d.node_id) return;
      if (d.status) { this.engine.setNodeStatus(d.node_id, d.status); return; }
      if (d.phase === 'enter') {
        this.engine.setNodeStatus(d.node_id, 'running');
      } else if (d.phase === 'exit' || d.phase === 'loop') {
        this.engine.setNodeStatus(d.node_id, 'done');
      } else if (d.phase === 'yielded' || d.phase === 'parked') {
        this.engine.setNodeStatus(d.node_id, 'parked');
      } else if (d.phase === 'halt' || d.phase === 'error') {
        this.engine.setNodeStatus(d.node_id, 'error');
      }
    });
    window.addEventListener(RUN_FINISHED, () => this.engine.clearStatus());
  }

  getDoc(): GraphDoc { return this.engine.getDoc(); }

  toText(): string { return this.engine.toText(); }

  loadFromText(text: string, origin: Origin = 'system'): ParseResult { return this.engine.loadFromText(text, origin); }

  onChange(handler: (e: ChangeEvent) => void): () => void { return this.engine.onChange(handler); }

  onStatus(handler: (e: StatusEvent) => void): () => void { return this.engine.statusChanged.on(handler); }

  setNodeStatus(id: string, status: NodeStatus | null): void { this.engine.setNodeStatus(id, status); }

  clearStatus(): void { this.engine.clearStatus(); }

  get fileName(): string | null { return this.file?.name ?? null; }

  get fileMtime(): number | null { return this.file?.mtime ?? null; }

  setFile(file: { name: string; mtime: number } | null): void {
    this.file = file;
    window.dispatchEvent(new CustomEvent(STUDIO_FILE));
  }

  get selection(): Selection { return this.picked; }

  select(sel: Selection): void {
    if (this.picked?.kind === sel?.kind && this.picked?.id === sel?.id) return;
    this.picked = sel;
    for (const fn of Array.from(this.selectors)) fn(sel);
    window.dispatchEvent(new CustomEvent(STUDIO_SELECT, { detail: sel }));
  }

  onSelect(fn: (s: Selection) => void): () => void {
    this.selectors.add(fn);
    return () => { this.selectors.delete(fn); };
  }

  registerAction(action: StudioAction): () => void {
    this.actionList.push(action);
    for (const fn of Array.from(this.actionWatchers)) fn();
    return () => {
      const at = this.actionList.indexOf(action);
      if (at >= 0) this.actionList.splice(at, 1);
      for (const fn of Array.from(this.actionWatchers)) fn();
    };
  }

  get actions(): readonly StudioAction[] { return this.actionList; }

  onActions(fn: () => void): () => void {
    this.actionWatchers.add(fn);
    return () => { this.actionWatchers.delete(fn); };
  }

  setOpener(fn: Opener): void { this.opener = fn; }

  open(name: string | null = null): Promise<boolean> { return this.opener ? this.opener(name) : Promise.resolve(false); }

  graphsChanged(): void { window.dispatchEvent(new CustomEvent(STUDIO_GRAPHS_CHANGED)); }
}

export const studio = new StudioHub();
