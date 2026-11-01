import type { Extension } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { rust } from '@codemirror/lang-rust';
import { languages } from '@codemirror/language-data';

const EAGER: Record<string, () => Extension> = {
  json: () => json(),
  jsonc: () => json(),
  py: () => python(),
  pyi: () => python(),
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  html: () => html(),
  htm: () => html(),
  css: () => css(),
  md: () => markdown(),
  markdown: () => markdown(),
  yaml: () => yaml(),
  yml: () => yaml(),
  rs: () => rust(),
};

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
  if (eager) return { now: eager(), later: Promise.resolve(null) };
  const base = baseName(path);
  const desc = ext ? languages.find((l) => l.extensions.includes(ext)) : languages.find((l) => l.filename?.test(base));
  if (!desc) return { now: [], later: Promise.resolve(null) };
  return { now: [], later: desc.load().then((s) => s.extension).catch(() => null) };
}
