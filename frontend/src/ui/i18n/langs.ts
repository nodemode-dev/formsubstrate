export const LANG_CODES = ['en'] as const;
export type Lang = typeof LANG_CODES[number];

export const LANG_NAMES: ReadonlyArray<readonly [Lang, string]> = [['en', 'English']];

export const RTL_LANGS: ReadonlySet<Lang> = new Set<Lang>([]);

export const LANG_PARENT: Partial<Record<Lang, Lang>> = {};

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANG_CODES as readonly string[]).includes(v);
