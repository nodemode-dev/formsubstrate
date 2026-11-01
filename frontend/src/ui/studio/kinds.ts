import { NODE_KINDS, type NodeKind } from '../../engine';

export interface KindMeta { kind: NodeKind; icon: string; label: string; help: string }

const META: Record<NodeKind, { icon: string; label: string; help: string }> = {
  start: { icon: 'nkStart', label: 'Start', help: 'Entry point. Every graph begins here.' },
  agent: { icon: 'nkAgent', label: 'Agent', help: 'A model worker that reads, writes and runs tools.' },
  tool: { icon: 'nkTool', label: 'Tool', help: 'One direct tool call, no model.' },
  evaluator: { icon: 'nkEvaluator', label: 'Evaluator', help: 'A critic. Label its out-edges accept and revise.' },
  yield: { icon: 'nkYield', label: 'Yield', help: 'Parks the run for an event, an approval or a delay.' },
  branch: { icon: 'nkBranch', label: 'Branch', help: 'If and else. Routes the true and false edges on an expression.' },
  foreach: { icon: 'nkForeach', label: 'Foreach', help: 'Runs the each edge once per item and joins on the done edge.' },
  transform: { icon: 'nkTransform', label: 'Transform', help: 'Maps data with a template or an expression.' },
  call_graph: { icon: 'nkCall', label: 'Call graph', help: 'Runs a saved graph inline as a subflow.' },
  end: { icon: 'nkEnd', label: 'End', help: 'Terminal node. The run completes here.' },
};

export const KIND_LIST: readonly KindMeta[] = NODE_KINDS.map((kind) => ({ kind, ...META[kind] }));

export const kindMeta = (kind: string): KindMeta => KIND_LIST.find((k) => k.kind === kind) ?? KIND_LIST[1];

export const FLOW_KINDS: ReadonlySet<string> = new Set(['agent', 'tool', 'branch', 'foreach', 'transform', 'call_graph']);

export const NODE_W = 168;
export const NODE_H = 52;
