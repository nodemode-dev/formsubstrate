import { EditorView } from '@codemirror/view';

export type BlockGroup = 'snippet' | 'tool' | 'mcp' | 'studio';

export interface BlockTool {
  name: string;
  source: string;
  parameters: { type?: string; properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] };
}

export interface Block {
  id: string;
  group: BlockGroup;
  label: string;
  hint: string;
  icon: string;
  code?: string;
  tool?: BlockTool;
  data?: Record<string, unknown>;
}

export const BLOCKS_EVENT = 'subform:blocks-changed';

const blocks = new Map<string, Block>();
const listeners = new Set<() => void>();
let queued = false;

function announce(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const fn of listeners) fn();
    window.dispatchEvent(new Event(BLOCKS_EVENT));
  });
}

export function registerBlock(block: Block): void {
  blocks.set(block.id, block);
  announce();
}

export function unregisterBlock(id: string): void {
  if (blocks.delete(id)) announce();
}

export function replaceGroup(group: BlockGroup, next: Block[]): void {
  for (const [id, b] of blocks) if (b.group === group) blocks.delete(id);
  for (const b of next) blocks.set(b.id, b);
  announce();
}

export function listBlocks(group?: BlockGroup): Block[] {
  const all = [...blocks.values()];
  return group ? all.filter((b) => b.group === group) : all;
}

export function onBlocks(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function insertAtCursor(text: string): boolean {
  const dom = document.querySelector<HTMLElement>('.cm-content');
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (!view) return false;
  view.dispatch({ ...view.state.replaceSelection(text), userEvent: 'input.paste', scrollIntoView: true });
  view.focus();
  return true;
}
