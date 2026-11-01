export function patchKeyed<T>(container: Element, items: readonly T[], key: (item: T) => string, create: (item: T) => Element, update: (node: Element, item: T) => void): void {
  const byKey = new Map<string, Element>();
  for (const child of Array.from(container.children)) {
    const k = child.getAttribute('data-key');
    if (k !== null) byKey.set(k, child);
  }
  const seen = new Set<string>(items.map(key));
  for (const [k, node] of byKey) if (!seen.has(k)) node.remove();
  let cursor: Element | null = container.firstElementChild;
  for (const item of items) {
    const k = key(item);
    let node = byKey.get(k);
    if (node) {
      update(node, item);
    } else {
      node = create(item);
      node.setAttribute('data-key', k);
    }
    if (node !== cursor) container.insertBefore(node, cursor);
    else cursor = cursor.nextElementSibling;
  }
}

export function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export const svgEl = (name: string): SVGElement => document.createElementNS('http://www.w3.org/2000/svg', name);
