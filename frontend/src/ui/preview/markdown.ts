import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import { Marked } from 'marked';
import { mediaKindOf, mediaUrl } from './media';
import { sanitizeHtml } from './sanitize';

const engine = new Marked({ gfm: true, breaks: false, async: false });

interface Parsed { parser: { parse(input: string): unknown } }

const loaded = new Map<string, Parsed | null>();
const loading = new Map<string, Promise<void>>();

export function resolveRelative(file: string, href: string): string {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  const base = href.startsWith('/') ? href.slice(1) : dir + href;
  const out: string[] = [];
  for (const part of base.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function descriptor(tag: string) {
  const key = tag.toLowerCase();
  return languages.find((l) => l.name.toLowerCase() === key || l.alias.some((a) => a.toLowerCase() === key) || l.extensions.includes(key));
}

function ensureLanguage(tag: string, ready: () => void): Parsed | null | undefined {
  const key = tag.toLowerCase();
  if (loaded.has(key)) return loaded.get(key);
  if (!loading.has(key)) {
    const desc = descriptor(key);
    if (!desc) {
      loaded.set(key, null);
      return null;
    }
    loading.set(key, desc.load().then((s) => { loaded.set(key, s.language as unknown as Parsed); }, () => { loaded.set(key, null); }).finally(() => { loading.delete(key); ready(); }));
  }
  return undefined;
}

function highlight(code: HTMLElement, tag: string, ready: () => void): void {
  const lang = ensureLanguage(tag, ready);
  if (!lang) return;
  const source = code.textContent ?? '';
  const frag = document.createDocumentFragment();
  const tree = lang.parser.parse(source) as never;
  highlightCode(source, tree, classHighlighter, (text, classes) => {
    if (!classes) { frag.appendChild(document.createTextNode(text)); return; }
    const span = document.createElement('span');
    span.className = classes;
    span.textContent = text;
    frag.appendChild(span);
  }, () => { frag.appendChild(document.createTextNode('\n')); });
  code.replaceChildren(frag);
}

function slug(text: string, used: Map<string, number>): string {
  const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-') || 'section';
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

export function renderMarkdown(text: string, path: string, ready: () => void): DocumentFragment {
  const html = engine.parse(text) as string;
  const frag = sanitizeHtml(html, {
    image: (raw) => {
      const target = resolveRelative(path, raw.split(/[?#]/)[0]);
      return target && mediaKindOf(target) === 'image' ? mediaUrl(target) : null;
    },
  });
  const used = new Map<string, number>();
  for (const h of Array.from(frag.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))) h.id = slug(h.textContent ?? '', used);
  for (const table of Array.from(frag.querySelectorAll('table'))) {
    const wrap = document.createElement('div');
    wrap.className = 'cv-md-table';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  }
  for (const input of Array.from(frag.querySelectorAll('input[type=checkbox]'))) input.closest('li')?.classList.add('cv-md-task');
  for (const code of Array.from(frag.querySelectorAll<HTMLElement>('pre > code'))) {
    const m = /language-([\w+#.-]+)/.exec(code.className);
    if (m) highlight(code, m[1], ready);
  }
  for (const a of Array.from(frag.querySelectorAll('a[href]'))) a.setAttribute('title', a.getAttribute('title') ?? a.getAttribute('href') ?? '');
  return frag;
}

function syncAttrs(from: Element, to: Element): void {
  for (const { name, value } of Array.from(to.attributes)) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  for (const { name } of Array.from(from.attributes)) if (!to.hasAttribute(name)) from.removeAttribute(name);
  if (from instanceof HTMLInputElement && to instanceof HTMLInputElement && from.checked !== to.checked) from.checked = to.checked;
}

export function patch(host: Node, next: Node): void {
  const a = Array.from(host.childNodes), b = Array.from(next.childNodes);
  let head = 0;
  while (head < a.length && head < b.length && a[head].isEqualNode(b[head])) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail].isEqualNode(b[b.length - 1 - tail])) tail++;
  const midA = a.slice(head, a.length - tail), midB = b.slice(head, b.length - tail);
  const common = Math.min(midA.length, midB.length);
  for (let i = 0; i < common; i++) {
    const x = midA[i], y = midB[i];
    if (x.nodeType === 3 && y.nodeType === 3) {
      if ((x as Text).data !== (y as Text).data) (x as Text).data = (y as Text).data;
    } else if (x.nodeType === 1 && y.nodeType === 1 && x.nodeName === y.nodeName) {
      syncAttrs(x as Element, y as Element);
      patch(x, y);
    } else {
      host.replaceChild(y, x);
    }
  }
  for (let i = common; i < midA.length; i++) host.removeChild(midA[i]);
  const anchor = tail > 0 ? a[a.length - tail] : null;
  for (let i = common; i < midB.length; i++) host.insertBefore(midB[i], anchor);
}
