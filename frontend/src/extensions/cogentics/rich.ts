import { patchList, type PatchListOptions } from '../../ui/dom';
import { icon } from '../../ui/icons';

export function patchFilled<T>(container: HTMLElement, items: T[], opts: PatchListOptions<T>): void {
  patchList(container, items, {
    key: opts.key,
    update: opts.update,
    create: (item) => {
      const node = opts.create(item);
      opts.update(node, item);
      return node;
    },
  });
}

const TOKEN = /@([A-Za-z0-9_-]+)|#(\d+)|\[\[([^[\]\n]{1,64})\]\]/g;

export const fmtTok = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function blankCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

export function richNodes(body: string, handles: Set<string>): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(document.createTextNode(body.slice(last, at)));
    last = at + m[0].length;
    if (m[1] !== undefined) {
      if (handles.has(m[1])) {
        const span = document.createElement('span');
        span.className = 'cx-mention';
        span.textContent = `@${m[1]}`;
        out.push(span);
      } else {
        out.push(document.createTextNode(m[0]));
      }
    } else if (m[2] !== undefined) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cx-ref';
      b.dataset.jump = m[2];
      b.textContent = `#${m[2]}`;
      out.push(b);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cx-note';
      b.dataset.note = m[3];
      b.insertAdjacentHTML('afterbegin', icon('ledgerBook', 10));
      b.append(m[3]);
      out.push(b);
    }
  }
  if (last < body.length) out.push(document.createTextNode(body.slice(last)));
  return out;
}

export function paintRich(target: HTMLElement, body: string, handles: Set<string>): void {
  const key = `${body.length}:${body}`;
  if (target.dataset.rich === key) return;
  target.dataset.rich = key;
  target.replaceChildren(...richNodes(body, handles));
}

export function paintDiff(pre: HTMLElement, text: string): void {
  if (pre.dataset.diff === text) return;
  pre.dataset.diff = text;
  const nodes: Node[] = [];
  for (const line of text.split('\n')) {
    const i = document.createElement('i');
    i.className = line.startsWith('+') ? 'cx-d-add' : line.startsWith('-') ? 'cx-d-del' : 'cx-d-ctx';
    i.textContent = `${line}\n`;
    nodes.push(i);
  }
  pre.replaceChildren(...nodes);
}
