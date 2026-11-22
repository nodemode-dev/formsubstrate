export const LANG_CODES = ['en', 'es', 'es-MX', 'pt-BR', 'fr', 'fr-CA', 'de', 'it', 'nl', 'da', 'fi', 'nb', 'sv', 'ru', 'pl', 'cs', 'hu', 'uk', 'tr', 'el', 'sr-Latn', 'zh-CN', 'zh-TW', 'ja', 'ko', 'id', 'th', 'vi', 'ar', 'hi'] as const;
export type Lang = typeof LANG_CODES[number];

export const LANG_NAMES: ReadonlyArray<readonly [Lang, string]> = [
  ['en', 'English'], ['es', 'Español'], ['es-MX', 'Español (México)'], ['pt-BR', 'Português (Brasil)'], ['fr', 'Français'],
  ['fr-CA', 'Français (Canada)'], ['de', 'Deutsch'], ['it', 'Italiano'], ['nl', 'Nederlands'], ['da', 'Dansk'], ['fi', 'Suomi'],
  ['nb', 'Norsk bokmål'], ['sv', 'Svenska'], ['ru', 'Русский'], ['pl', 'Polski'], ['cs', 'Čeština'], ['hu', 'Magyar'],
  ['uk', 'Українська'], ['tr', 'Türkçe'], ['el', 'Ελληνικά'], ['sr-Latn', 'Srpski (latinica)'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['ja', '日本語'], ['ko', '한국어'],
  ['id', 'Bahasa Indonesia'], ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['ar', 'العربية'], ['hi', 'हिन्दी'],
];

export const RTL_LANGS: ReadonlySet<Lang> = new Set<Lang>(['ar']);

export const LANG_PARENT: Partial<Record<Lang, Lang>> = { 'es-MX': 'es', 'fr-CA': 'fr' };

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANG_CODES as readonly string[]).includes(v);
