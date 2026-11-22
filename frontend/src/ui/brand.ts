const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="5" width="24" height="6" rx="3" fill="currentColor"/><rect x="4" y="13" width="24" height="6" rx="3" fill="currentColor" fill-opacity="0.7"/><rect x="4" y="21" width="24" height="6" rx="3" fill="currentColor" fill-opacity="0.4"/></svg>';

export const BRAND_NAME = 'Substrate';

export function brandMark(size: number, label = BRAND_NAME): string {
  return MARK.replace('<svg ', `<svg class="cv-mark" width="${size}" height="${size}" role="img" aria-label="${label}" `);
}

export function brandWordmark(size = 16): string {
  return `<span class="cv-wordmark">${brandMark(size)}<span class="cv-wordmark-text">${BRAND_NAME}</span></span>`;
}
