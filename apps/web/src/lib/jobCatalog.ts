import type { Job } from '../types';
import { normalizeJobStatusHistory } from './jobStatus';

export const jobCatalogRevisionStorageKey = 'autumn-compass-job-catalog-revision-v1';

function parseStrictRevision(value: string | null) {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Number.isSafeInteger(parsed) && (parsed as number) >= 0 ? parsed as number : null;
  } catch {
    return null;
  }
}

export function parseStoredJobCatalogRevision(value: string | null) {
  return parseStrictRevision(value) ?? 0;
}

export function shouldApplyJobCatalogRevision(bundledRevision: number, storedRevision: number) {
  return Number.isSafeInteger(bundledRevision)
    && bundledRevision > 0
    && bundledRevision > storedRevision;
}

export function mergeJobCatalogRevisionValues(localValue: string | null, remoteValue: string | null) {
  const localRevision = parseStrictRevision(localValue);
  const remoteRevision = parseStrictRevision(remoteValue);
  if (localRevision === null || remoteRevision === null) {
    throw new Error('岗位目录版本格式无效');
  }
  return JSON.stringify(Math.max(localRevision, remoteRevision));
}

export function normalizeJob(job: Job): Job {
  const statusHistory = normalizeJobStatusHistory(job.statusHistory);
  return {
    ...job,
    statusHistory: statusHistory.length > 0 ? statusHistory : undefined,
    applicationStartDate: job.applicationStartDate || '',
    applicationEndDate: job.applicationEndDate || job.deadline || '',
    dateSourceNote: job.dateSourceNote || '起止日期未核验',
    jobCode: job.jobCode || '',
    companyUrl: job.companyUrl || '',
    referralUrl: job.referralUrl || '',
    referralCode: job.referralCode || '',
    referralNote: job.referralNote || '',
    linkType: job.linkType || (job.url ? '岗位列表' : '暂无有效岗位'),
    maintenanceStatus: job.maintenanceStatus
      || (['待开放', '待确认'].includes(job.recruitmentStatus) ? '自动维护' : '无需维护'),
  };
}

export function mergeCatalogJobs(initialJobs: Job[], storedJobs: Job[]) {
  const storedById = new Map(storedJobs.map((job) => [job.id, job]));
  const merged = initialJobs.map((initial) => {
    const stored = storedById.get(initial.id);
    if (!stored) return normalizeJob(initial);

    // Older documents recorded only that a job was edited, not which fields
    // changed. Preserve the complete legacy record rather than guessing and
    // overwriting a possible user edit.
    if (stored.userEditedAt && !stored.editedFields) {
      return normalizeJob({ ...initial, ...stored });
    }

    const editedValues = stored.editedFields
      ? Object.fromEntries(stored.editedFields.map((field) => [field, stored[field]])) as Partial<Job>
      : {};
    return normalizeJob({
      ...initial,
      ...editedValues,
      // Workflow and personal application material always belong to the user,
      // including values that originated in an older private seed. Public
      // catalog refreshes must never clear them merely because they are no
      // longer bundled in source.
      status: stored.status,
      statusHistory: stored.statusHistory,
      priority: stored.priority,
      appliedAt: stored.status === '收藏' ? undefined : stored.appliedAt,
      nextStep: stored.nextStep,
      notes: stored.notes,
      referralUrl: stored.referralUrl,
      referralCode: stored.referralCode,
      referralNote: stored.referralNote,
      userEditedAt: stored.userEditedAt,
      editedFields: stored.editedFields,
    });
  });
  const knownIds = new Set(initialJobs.map((job) => job.id));
  return [...merged, ...storedJobs.filter((job) => !knownIds.has(job.id)).map(normalizeJob)];
}
