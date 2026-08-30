export function normalizeOptionalWebUrl(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim() || '';
  if (!trimmedValue) return '';

  try {
    const parsedUrl = new URL(trimmedValue);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return null;
    return parsedUrl.href;
  } catch {
    return null;
  }
}

export function getSafeWebUrl(value: string | null | undefined) {
  return normalizeOptionalWebUrl(value) || '';
}

export function firstSafeWebUrl(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const safeUrl = getSafeWebUrl(value);
    if (safeUrl) return safeUrl;
  }
  return '';
}
