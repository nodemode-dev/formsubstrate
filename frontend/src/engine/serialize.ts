import type { GraphDoc } from './state';
import { validateDoc } from './state';

export function docToText(doc: GraphDoc): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

export type ParseResult =
  | { ok: true; doc: GraphDoc }
  | { ok: false; errors: string[] };

export function textToDoc(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`JSON parse error: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const errors = validateDoc(raw);
  if (errors.length) return { ok: false, errors };
  return { ok: true, doc: raw as GraphDoc };
}
