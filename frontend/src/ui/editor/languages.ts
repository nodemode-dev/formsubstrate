import type { Extension } from '@codemirror/state';
import { languages } from '@codemirror/language-data';

type Pack = 'json' | 'python' | 'javascript' | 'html' | 'css' | 'markdown' | 'yaml' | 'rust';
type Make = () => Extension;

const PACKS: Record<Pack, () => Promise<Record<string, Make>>> = {
  json: () => import('@codemirror/lang-json').then((m) => ({ json: () => m.json() })),
  python: () => import('@codemirror/lang-python').then((m) => ({ python: () => m.python() })),
  javascript: () => import('@codemirror/lang-javascript').then((m) => ({
    js: () => m.javascript(),
    jsx: () => m.javascript({ jsx: true }),
    ts: () => m.javascript({ typescript: true }),
    tsx: () => m.javascript({ typescript: true, jsx: true }),
  })),
  html: () => import('@codemirror/lang-html').then((m) => ({ html: () => m.html() })),
  css: () => import('@codemirror/lang-css').then((m) => ({ css: () => m.css() })),
  markdown: () => import('@codemirror/lang-markdown').then((m) => ({ markdown: () => m.markdown() })),
  yaml: () => import('@codemirror/lang-yaml').then((m) => ({ yaml: () => m.yaml() })),
  rust: () => import('@codemirror/lang-rust').then((m) => ({ rust: () => m.rust() })),
};

const EAGER: Record<string, [Pack, string]> = {
  json: ['json', 'json'],
  jsonc: ['json', 'json'],
  py: ['python', 'python'],
  pyi: ['python', 'python'],
  js: ['javascript', 'js'],
  mjs: ['javascript', 'js'],
  cjs: ['javascript', 'js'],
  jsx: ['javascript', 'jsx'],
  ts: ['javascript', 'ts'],
  mts: ['javascript', 'ts'],
  cts: ['javascript', 'ts'],
  tsx: ['javascript', 'tsx'],
  html: ['html', 'html'],
  htm: ['html', 'html'],
  css: ['css', 'css'],
  md: ['markdown', 'markdown'],
  markdown: ['markdown', 'markdown'],
  yaml: ['yaml', 'yaml'],
  yml: ['yaml', 'yaml'],
  rs: ['rust', 'rust'],
};

const ready = new Map<Pack, Record<string, Make>>();
const loading = new Map<Pack, Promise<Record<string, Make>>>();

function loadPack(pack: Pack): Promise<Record<string, Make>> {
  const have = ready.get(pack);
  if (have) return Promise.resolve(have);
  let p = loading.get(pack);
  if (!p) {
    p = PACKS[pack]().then((made) => { ready.set(pack, made); return made; });
    loading.set(pack, p);
  }
  return p;
}

export function preloadPacks(): Array<() => Promise<unknown>> {
  return (Object.keys(PACKS) as Pack[]).filter((p) => p !== 'rust').map((p) => () => loadPack(p));
}

export interface ResolvedLanguage { now: Extension; later: Promise<Extension | null> }

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function extOf(path: string): string {
  const base = baseName(path);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function isMarkdownPath(path: string): boolean {
  const e = extOf(path);
  return e === 'md' || e === 'markdown';
}

export function languageFor(path: string): ResolvedLanguage {
  const ext = extOf(path);
  const eager = EAGER[ext];
  if (eager) {
    const [pack, key] = eager;
    const made = ready.get(pack);
    if (made) return { now: made[key](), later: Promise.resolve(null) };
    return { now: [], later: loadPack(pack).then((m) => m[key]()).catch(() => null) };
  }
  const base = baseName(path);
  const desc = ext ? languages.find((l) => l.extensions.includes(ext)) : languages.find((l) => l.filename?.test(base));
  if (!desc) return { now: [], later: Promise.resolve(null) };
  return { now: [], later: desc.load().then((s) => s.extension).catch(() => null) };
}
