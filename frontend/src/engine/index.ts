import type { GraphDoc, NodeStatus } from './state';
import { cloneDoc, emptyDoc } from './state';
import type { Command } from './commands';
import { applyCommand } from './commands';
import { EventBus, type ChangeEvent, type Origin } from './events';
import { docToText, textToDoc, type ParseResult } from './serialize';

export type { GraphDoc, GraphNode, GraphEdge, NodeKind, NodeStatus } from './state';
export { NODE_KINDS, ROUTES, emptyDoc, isKind, nextId, validateDoc } from './state';
export type { Command } from './commands';
export type { Origin, ChangeEvent } from './events';
export { EventBus } from './events';
export { docToText, textToDoc } from './serialize';
export type { ParseResult } from './serialize';

const HISTORY_LIMIT = 200;

export interface StatusEvent {
  id: string | null;
  status: NodeStatus | null;
}

export class Engine {
  private doc: GraphDoc;
  private undoStack: GraphDoc[] = [];
  private redoStack: GraphDoc[] = [];
  private revision = 0;
  private saved = 0;
  private readonly statuses = new Map<string, NodeStatus>();
  readonly changed = new EventBus<ChangeEvent>();
  readonly statusChanged = new EventBus<StatusEvent>();
  readonly dirtyChanged = new EventBus<boolean>();

  constructor(doc?: GraphDoc) {
    this.doc = doc ?? emptyDoc();
  }

  getDoc(): GraphDoc {
    return this.doc;
  }

  onChange(handler: (e: ChangeEvent) => void): () => void {
    return this.changed.on(handler);
  }

  dispatch(cmd: Command, origin: Origin = 'system'): boolean {
    return this.dispatchMany([cmd], origin);
  }

  dispatchMany(cmds: readonly Command[], origin: Origin = 'system'): boolean {
    const draft = cloneDoc(this.doc);
    let changed = false;
    for (const cmd of cmds) if (applyCommand(draft, cmd)) changed = true;
    if (!changed) return false;
    this.pushUndo();
    this.doc = draft;
    this.redoStack = [];
    this.bump(origin);
    return true;
  }

  loadFromText(text: string, origin: Origin = 'code'): ParseResult {
    const result = textToDoc(text);
    if (result.ok) this.dispatch({ type: 'load_doc', doc: result.doc }, origin);
    return result;
  }

  replace(doc: GraphDoc, origin: Origin = 'system'): void {
    this.doc = cloneDoc(doc);
    this.undoStack = [];
    this.redoStack = [];
    this.statuses.clear();
    this.revision += 1;
    this.saved = this.revision;
    this.changed.emit({ origin });
    this.statusChanged.emit({ id: null, status: null });
    this.dirtyChanged.emit(false);
  }

  toText(): string {
    return docToText(this.doc);
  }

  get dirty(): boolean {
    return this.revision !== this.saved;
  }

  markSaved(): void {
    if (this.saved === this.revision) return;
    this.saved = this.revision;
    this.dirtyChanged.emit(false);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(cloneDoc(this.doc));
    this.doc = prev;
    this.bump('system');
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(cloneDoc(this.doc));
    this.doc = next;
    this.bump('system');
    return true;
  }

  setNodeStatus(id: string, status: NodeStatus | null): void {
    const had = this.statuses.get(id) ?? null;
    if (had === status) return;
    if (status === null) this.statuses.delete(id); else this.statuses.set(id, status);
    this.statusChanged.emit({ id, status });
  }

  nodeStatus(id: string): NodeStatus | null {
    return this.statuses.get(id) ?? null;
  }

  clearStatus(): void {
    if (this.statuses.size === 0) return;
    this.statuses.clear();
    this.statusChanged.emit({ id: null, status: null });
  }

  private bump(origin: Origin): void {
    const was = this.dirty;
    this.revision += 1;
    this.changed.emit({ origin });
    if (was !== this.dirty) this.dirtyChanged.emit(this.dirty);
  }

  private pushUndo(): void {
    this.undoStack.push(cloneDoc(this.doc));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
  }
}
