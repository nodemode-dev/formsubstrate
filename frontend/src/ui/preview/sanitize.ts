export interface SanitizeOptions {
  image(raw: string): string | null;
}

const TAGS: Record<string, readonly string[]> = {
  a: ['href', 'title'],
  abbr: ['title'],
  b: [], blockquote: [], br: [], caption: [], code: ['class'], col: [], colgroup: [], dd: [], del: [],
  details: ['open'], div: ['align'], dl: [], dt: [], em: [], figcaption: [], figure: [], hr: [],
  h1: ['align'], h2: ['align'], h3: ['align'], h4: ['align'], h5: ['align'], h6: ['align'],
  i: [], img: ['src', 'alt', 'title', 'width', 'height', 'align'], input: ['type', 'checked', 'disabled'],
  ins: [], kbd: [], li: [], mark: [], ol: ['start'], p: ['align'], pre: [], q: [], s: [], samp: [], small: [],
  span: [], strong: [], sub: [], summary: [], sup: [], table: [], tbody: [],
  td: ['colspan', 'rowspan', 'align'], tfoot: [], th: ['colspan', 'rowspan', 'align'], thead: [], tr: [],
  u: [], ul: [], var: [],
};

const DROP = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'template', 'noscript', 'svg', 'math',
  'form', 'textarea', 'select', 'option', 'button', 'link', 'meta', 'base', 'title', 'head', 'audio', 'video', 'source',
  'track', 'canvas', 'dialog', 'portal', 'slot', 'xmp', 'plaintext', 'noembed', 'noframes',
]);

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=]*$/i;
const ALIGN = new Set(['left', 'right', 'center', 'justify']);
const invisible = (c: number): boolean =>
  c <= 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0xad || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff;

export function stripUrl(raw: string): string {
  let out = '';
  for (const ch of raw) if (!invisible(ch.codePointAt(0) ?? 0)) out += ch;
  return out;
}


export function schemeOf(clean: string): string {
  const m = SCHEME.exec(clean);
  return m ? m[1].toLowerCase() : '';
}

export function safeLink(raw: string): string | null {
  const clean = stripUrl(raw);
  if (clean.startsWith('//') || clean.startsWith('\\')) return null;
  const scheme = schemeOf(clean);
  if (scheme === '' || scheme === 'http' || scheme === 'https' || scheme === 'mailto') return clean;
  return null;
}

function safeImage(raw: string, opts: SanitizeOptions): string | null {
  const clean = stripUrl(raw);
  if (clean === '' || clean.startsWith('//') || clean.startsWith('\\')) return null;
  const scheme = schemeOf(clean);
  if (scheme === 'http' || scheme === 'https') return clean;
  if (scheme === 'data') return DATA_IMAGE.test(clean) ? clean : null;
  if (scheme !== '') return null;
  return opts.image(clean);
}

function attributes(tag: string, from: Element, to: HTMLElement, opts: SanitizeOptions): boolean {
  for (const name of TAGS[tag]) {
    const value = from.getAttribute(name);
    if (value === null) continue;
    if (name === 'href') {
      const href = safeLink(value);
      if (href === null) continue;
      to.setAttribute('href', href);
      to.setAttribute('rel', 'noreferrer noopener');
    } else if (name === 'src') {
      const src = safeImage(value, opts);
      if (src === null) return false;
      to.setAttribute('src', src);
    } else if (name === 'class') {
      if (/^language-[\w+#.-]{1,32}$/.test(value)) to.setAttribute('class', value);
    } else if (name === 'align') {
      if (ALIGN.has(value.toLowerCase())) to.setAttribute('align', value.toLowerCase());
    } else if (name === 'width' || name === 'height') {
      if (/^\d{1,4}%?$/.test(value)) to.setAttribute(name, value);
    } else if (name === 'colspan' || name === 'rowspan' || name === 'start') {
      if (/^\d{1,4}$/.test(value)) to.setAttribute(name, value);
    } else if (name === 'type') {
      if (value.toLowerCase() === 'checkbox') to.setAttribute('type', 'checkbox');
    } else if (name === 'checked' || name === 'disabled' || name === 'open') {
      to.setAttribute(name, '');
    } else if (name === 'title' || name === 'alt') {
      to.setAttribute(name, value.slice(0, 500));
    }
  }
  return true;
}

function walk(from: Node, into: Node, opts: SanitizeOptions): void {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === 3) {
      into.appendChild(document.createTextNode((child as Text).data));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const node = child as Element;
    const tag = node.localName;
    if (DROP.has(tag)) continue;
    if (!Object.prototype.hasOwnProperty.call(TAGS, tag)) {
      walk(node, into, opts);
      continue;
    }
    if (tag === 'input' && node.getAttribute('type')?.toLowerCase() !== 'checkbox') continue;
    const out = document.createElement(tag);
    if (!attributes(tag, node, out, opts)) continue;
    if (tag === 'input') out.setAttribute('disabled', '');
    if (tag === 'img' && !out.hasAttribute('src')) continue;
    walk(node, out, opts);
    into.appendChild(out);
  }
}

export function sanitizeHtml(html: string, opts: SanitizeOptions): DocumentFragment {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  const out = document.createDocumentFragment();
  walk(parsed.body, out, opts);
  return out;
}
