import type { Job, JobStatus, JobStatusChange } from '../types';

export const jobStatusOptions: readonly JobStatus[] = ['收藏', '已投递', '笔试', '面试', 'Offer', '已结束'];
const jobStatusSet = new Set<string>(jobStatusOptions);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && jobStatusSet.has(value);
}

function isJobStatusChange(value: unknown): value is JobStatusChange {
  return isRecord(value)
    && (value.fromStatus === null || isJobStatus(value.fromStatus))
    && isJobStatus(value.toStatus)
    && isCanonicalIsoInstant(value.changedAt);
}

export function isJobStatusHistory(value: unknown): value is JobStatusChange[] {
  return Array.isArray(value) && value.every(isJobStatusChange);
}

export function normalizeJobStatusHistory(value: unknown): JobStatusChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isJobStatusChange).map((change) => ({ ...change }));
}

export function appendJobStatusTransition(
  history: unknown,
  fromStatus: JobStatus | null,
  toStatus: JobStatus,
  changedAt = new Date().toISOString(),
) {
  const normalized = normalizeJobStatusHistory(history);
  if (fromStatus === toStatus) return normalized;
  if (!isCanonicalIsoInstant(changedAt)) throw new TypeError('岗位状态变更时间必须是标准 ISO 时刻');
  return [...normalized, { fromStatus, toStatus, changedAt }];
}

export function getCurrentJobStatusChange(
  job: Pick<Job, 'status' | 'statusHistory'>,
) {
  const history = normalizeJobStatusHistory(job.statusHistory);
  const latest = history.at(-1);
  return latest?.toStatus === job.status ? latest : undefined;
}

function getCalendarParts(changedAt: string, timeZone?: string) {
  if (!isCanonicalIsoInstant(changedAt)) return undefined;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(changedAt)).map((part) => [part.type, part.value]),
    );
    if (!parts.year || !parts.month || !parts.day) return undefined;
    return {
      year: parts.year,
      month: parts.month.padStart(2, '0'),
      day: parts.day.padStart(2, '0'),
    };
  } catch {
    return undefined;
  }
}

export function formatJobStatusChangeDate(changedAt: string, timeZone?: string) {
  const parts = getCalendarParts(changedAt, timeZone);
  return parts ? `${parts.month}/${parts.day}` : '';
}

export function formatJobStatusChangeFullDate(changedAt: string, timeZone?: string) {
  const parts = getCalendarParts(changedAt, timeZone);
  return parts ? `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日` : '';
}

export function getJobStatusLabel(status: JobStatus) {
  return status === '已结束' ? '流程终止' : status;
}
