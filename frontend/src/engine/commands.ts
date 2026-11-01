import type { GraphDoc, GraphNode, NodeKind } from './state';
import { nextId } from './state';

export type Command =
  | { type: 'add_node'; kind: NodeKind; id?: string; label?: string; x: number; y: number; config?: Record<string, unknown> }
  | { type: 'move_node'; id: string; x: number; y: number }
  | { type: 'move_nodes'; moves: ReadonlyArray<{ id: string; x: number; y: number }> }
  | { type: 'rename_node'; id: string; label: string }
  | { type: 'update_node_config'; id: string; config: Record<string, unknown> }
  | { type: 'update_node'; id: string; label?: string; config?: Record<string, unknown> }
  | { type: 'remove_node'; id: string }
  | { type: 'add_edge'; from: string; to: string; id?: string; label?: string }
  | { type: 'remove_edge'; id: string }
  | { type: 'update_edge'; id: string; label: string }
  | { type: 'rename_doc'; name: string }
  | { type: 'load_doc'; doc: GraphDoc };

type CmdOf<K extends Command['type']> = Extract<Command, { type: K }>;

const byId = (draft: GraphDoc, id: string): GraphNode | undefined => draft.nodes.find((n) => n.id === id);

const sameConfig = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const HANDLERS: { [K in Command['type']]: (draft: GraphDoc, cmd: CmdOf<K>) => boolean } = {
  add_node(draft, cmd) {
    if (cmd.id && byId(draft, cmd.id)) return false;
    draft.nodes.push({ id: cmd.id ?? nextId('n'), kind: cmd.kind, label: cmd.label ?? cmd.kind, x: cmd.x, y: cmd.y, config: cmd.config });
    return true;
  },
  move_node(draft, cmd) {
    const n = byId(draft, cmd.id);
    if (!n || (n.x === cmd.x && n.y === cmd.y)) return false;
    n.x = cmd.x;
    n.y = cmd.y;
    return true;
  },
  move_nodes(draft, cmd) {
    let changed = false;
    for (const m of cmd.moves) {
      const n = byId(draft, m.id);
      if (!n || (n.x === m.x && n.y === m.y)) continue;
      n.x = m.x;
      n.y = m.y;
      changed = true;
    }
    return changed;
  },
  rename_node(draft, cmd) {
    const n = byId(draft, cmd.id);
    if (!n || n.label === cmd.label) return false;
    n.label = cmd.label;
    return true;
  },
  update_node_config(draft, cmd) {
    const n = byId(draft, cmd.id);
    if (!n || sameConfig(n.config, cmd.config)) return false;
    n.config = cmd.config;
    return true;
  },
  update_node(draft, cmd) {
    const n = byId(draft, cmd.id);
    if (!n) return false;
    let changed = false;
    if (cmd.label !== undefined && cmd.label !== n.label) { n.label = cmd.label; changed = true; }
    if (cmd.config !== undefined && !sameConfig(n.config, cmd.config)) { n.config = cmd.config; changed = true; }
    return changed;
  },
  remove_node(draft, cmd) {
    const before = draft.nodes.length;
    draft.nodes = draft.nodes.filter((n) => n.id !== cmd.id);
    draft.edges = draft.edges.filter((e) => e.from !== cmd.id && e.to !== cmd.id);
    return draft.nodes.length !== before;
  },
  add_edge(draft, cmd) {
    if (cmd.from === cmd.to || !byId(draft, cmd.from) || !byId(draft, cmd.to)) return false;
    if (byId(draft, cmd.to)?.kind === 'start' || byId(draft, cmd.from)?.kind === 'end') return false;
    if (draft.edges.some((e) => e.from === cmd.from && e.to === cmd.to)) return false;
    if (cmd.id && draft.edges.some((e) => e.id === cmd.id)) return false;
    draft.edges.push({ id: cmd.id ?? nextId('e'), from: cmd.from, to: cmd.to, label: cmd.label || undefined });
    return true;
  },
  update_edge(draft, cmd) {
    const e = draft.edges.find((x) => x.id === cmd.id);
    const next = cmd.label || undefined;
    if (!e || e.label === next) return false;
    e.label = next;
    return true;
  },
  remove_edge(draft, cmd) {
    const before = draft.edges.length;
    draft.edges = draft.edges.filter((e) => e.id !== cmd.id);
    return draft.edges.length !== before;
  },
  rename_doc(draft, cmd) {
    if (draft.name === cmd.name) return false;
    draft.name = cmd.name;
    return true;
  },
  load_doc(draft, cmd) {
    draft.version = cmd.doc.version;
    draft.name = cmd.doc.name;
    draft.nodes = cmd.doc.nodes;
    draft.edges = cmd.doc.edges;
    return true;
  },
};

export function applyCommand(draft: GraphDoc, cmd: Command): boolean {
  const handler = HANDLERS[cmd.type] as (d: GraphDoc, c: Command) => boolean;
  return handler(draft, cmd);
}
