export type NodeKind = 'start' | 'agent' | 'tool' | 'evaluator' | 'yield' | 'branch' | 'foreach' | 'transform' | 'call_graph' | 'end';

export const NODE_KINDS: readonly NodeKind[] = ['start', 'agent', 'tool', 'evaluator', 'yield', 'branch', 'foreach', 'transform', 'call_graph', 'end'];

export const ROUTES: Readonly<Partial<Record<NodeKind, readonly string[]>>> = {
  evaluator: ['accept', 'revise'],
  branch: ['true', 'false'],
  foreach: ['each', 'done'],
};

export type NodeStatus = 'running' | 'done' | 'error' | 'parked';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  config?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface GraphDoc {
  version: 1;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function emptyDoc(name = 'untitled'): GraphDoc {
  return { version: 1, name, nodes: [], edges: [] };
}

export function cloneDoc(doc: GraphDoc): GraphDoc {
  return structuredClone(doc);
}

let counter = 0;

export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export function isKind(v: unknown): v is NodeKind {
  return typeof v === 'string' && (NODE_KINDS as readonly string[]).includes(v);
}

export function validateDoc(doc: unknown): string[] {
  const errs: string[] = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['document must be an object'];
  const d = doc as Partial<GraphDoc>;
  if (d.version !== 1) errs.push('version must be 1');
  if (typeof d.name !== 'string' || !d.name.trim()) errs.push('name must be a non-empty string');
  if (!Array.isArray(d.nodes)) errs.push('nodes must be an array');
  if (!Array.isArray(d.edges)) errs.push('edges must be an array');
  if (errs.length) return errs;
  const ids = new Set<string>();
  for (const n of d.nodes as GraphNode[]) {
    if (!n || typeof n !== 'object') { errs.push('node must be an object'); continue; }
    if (!n.id || typeof n.id !== 'string') { errs.push('node missing id'); continue; }
    if (ids.has(n.id)) errs.push(`duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (!isKind(n.kind)) errs.push(`node ${n.id}: unknown kind "${String(n.kind)}"`);
    if (typeof n.x !== 'number' || typeof n.y !== 'number' || !Number.isFinite(n.x) || !Number.isFinite(n.y)) errs.push(`node ${n.id}: x and y must be numbers`);
    if (typeof n.label !== 'string') errs.push(`node ${n.id}: label must be a string`);
    if (n.config !== undefined && (typeof n.config !== 'object' || n.config === null || Array.isArray(n.config))) errs.push(`node ${n.id}: config must be an object`);
  }
  const edgeIds = new Set<string>();
  for (const e of d.edges as GraphEdge[]) {
    if (!e || typeof e !== 'object') { errs.push('edge must be an object'); continue; }
    if (!e.id || typeof e.id !== 'string') { errs.push('edge missing id'); continue; }
    if (edgeIds.has(e.id)) errs.push(`duplicate edge id: ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.from)) errs.push(`edge ${e.id}: unknown source node "${String(e.from)}"`);
    if (!ids.has(e.to)) errs.push(`edge ${e.id}: unknown target node "${String(e.to)}"`);
    if (e.label !== undefined && typeof e.label !== 'string') errs.push(`edge ${e.id}: label must be a string`);
  }
  return errs;
}
