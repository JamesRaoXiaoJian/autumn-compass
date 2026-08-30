export type MarkdownUrlKind = 'link' | 'image';

const absoluteScheme = /^[A-Za-z][A-Za-z\d+.-]*:/u;
const unsafeUrlCharacters = /[\u0000-\u001F\u007F\\]/u;

export function normalizeMarkdownUrl(
  value: string | null | undefined,
  kind: MarkdownUrlKind,
): string | null {
  const url = value?.trim() || '';
  if (!url || unsafeUrlCharacters.test(url) || url.startsWith('//')) return null;

  if (url.startsWith('#')) {
    return kind === 'link' && /^#[A-Za-z0-9_:.~-]+$/u.test(url) ? url : null;
  }

  if (!absoluteScheme.test(url)) return url;

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    if (kind === 'link' && parsed.protocol === 'mailto:') return parsed.href;
  } catch {
    return null;
  }

  return null;
}

export function markdownUrlTransform(url: string, key: string) {
  if (key === 'src') return normalizeMarkdownUrl(url, 'image') || '';
  if (key === 'href') return normalizeMarkdownUrl(url, 'link') || '';
  return '';
}

export function normalizeMarkdownTitle(value: string | null | undefined) {
  return (value || '')
    .trim()
    .replace(/\s*[\r\n]+\s*/gu, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/u, '')
    .trim();
}

export function normalizeMarkdownPreview(value: string | null | undefined) {
  return (value || '')
    .replace(/```[\s\S]*?```/gu, ' `代码片段` ')
    .replace(/~~~[\s\S]*?~~~/gu, ' `代码片段` ')
    .replace(/\$\$[\s\S]*?\$\$/gu, ' 公式 ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^\s{0,3}>\s?/gmu, '')
    .replace(/^\s*[-+*]\s+\[[ xX]\]\s+/gmu, '')
    .replace(/^\s*[-+*]\s+/gmu, '')
    .replace(/^\s*\d+[.)]\s+/gmu, '')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gmu, ' ')
    .replace(/\s*\|\s*/gu, ' · ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 280);
}
