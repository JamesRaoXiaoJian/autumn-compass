import type { Job } from '../types';

export type JobMaintenanceIdentity = Pick<Job, 'company' | 'title' | 'jobCode' | 'url'> & { id?: string };

const referralParameters = new Set([
  'recommendcode', 'referralcode', 'referral_code', 'shareid', 'sharesource',
  'share_token', 'token', 'recommend_code',
]);

function normalizeToken(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/gu, '');
}

function jobCodeCandidates(value: string) {
  const normalized = value.normalize('NFKC').trim();
  const candidates = [
    ...(normalized.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu) || []),
    ...(normalized.match(/\b\d{12,}\b/gu) || []),
    ...normalized.split(/[\s/,;|]+/gu),
  ].map(normalizeToken).filter(Boolean);
  return [...new Set(candidates)];
}

function filteredParameters(parameters: URLSearchParams) {
  const kept = [...parameters.entries()]
    .filter(([key]) => !referralParameters.has(key.toLocaleLowerCase('en-US')))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ));
  const result = new URLSearchParams();
  kept.forEach(([key, value]) => result.append(key, value));
  return result.toString();
}

export function normalizeJobDetailUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    const search = filteredParameters(parsed.searchParams);
    let hash = parsed.hash.slice(1);
    if (hash) {
      const queryIndex = hash.indexOf('?');
      const hashPath = queryIndex >= 0 ? hash.slice(0, queryIndex) : hash;
      const hashQuery = queryIndex >= 0 ? filteredParameters(new URLSearchParams(hash.slice(queryIndex + 1))) : '';
      hash = `${hashPath}${hashQuery ? `?${hashQuery}` : ''}`;
    }
    const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/u, '') : parsed.pathname;
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}${search ? `?${search}` : ''}${hash ? `#${hash}` : ''}`;
  } catch {
    return normalizeToken(value);
  }
}

export function getJobMaintenanceFingerprints(job: JobMaintenanceIdentity) {
  const company = normalizeToken(job.company);
  const fingerprints = job.jobCode?.trim()
    ? jobCodeCandidates(job.jobCode).map((code) => `code:${company}:${code}`)
    : [];
  if (job.url.trim()) fingerprints.push(`url:${normalizeJobDetailUrl(job.url)}`);
  if (!fingerprints.length) fingerprints.push(`role:${company}:${normalizeToken(job.title)}`);
  return [...new Set(fingerprints)];
}
