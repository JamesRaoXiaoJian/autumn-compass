import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const recruitmentWorkspaceKeys = Object.freeze({
  jobs: 'autumn-compass-jobs-2027-v7',
  deletedJobIds: 'autumn-compass-deleted-job-ids-2027-v1',
  deletedJobFingerprints: 'autumn-compass-deleted-job-fingerprints-2027-v1',
});

export const recruitmentMaintenanceScopeFilename = 'recruitment-maintenance-scope.json';

const recruitmentJobFields = Object.freeze([
  'id',
  'company',
  'logo',
  'logoTone',
  'title',
  'department',
  'location',
  'type',
  'deadline',
  'url',
  'companyUrl',
  'source',
  'tags',
  'recruitmentStatus',
  'maintenanceStatus',
  'season',
  'verifiedAt',
  'evidenceUrl',
  'applicationStartDate',
  'applicationEndDate',
  'jobCode',
  'linkType',
]);

const isRecord = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const parseWorkspaceArray = (items, key, warnings) => {
  const raw = items[key];
  if (raw === undefined) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      warnings.push(`${key} 不是数组，已忽略。`);
      return [];
    }
    return parsed;
  } catch {
    warnings.push(`${key} 不是有效 JSON，已忽略。`);
    return [];
  }
};

const copyRecruitmentField = (target, source, field) => {
  if (!Object.hasOwn(source, field)) return;
  const value = source[field];
  if (field === 'tags') {
    if (Array.isArray(value)) {
      target.tags = value.filter((tag) => typeof tag === 'string');
    }
    return;
  }
  if (typeof value === 'string') target[field] = value;
};

const sanitizeJob = (job) => {
  if (!isRecord(job)) return null;
  const sanitized = Object.create(null);
  for (const field of recruitmentJobFields) copyRecruitmentField(sanitized, job, field);
  if (typeof sanitized.id !== 'string' || sanitized.id.length === 0) return null;
  if (!['自动维护', '无需维护'].includes(sanitized.maintenanceStatus)) {
    sanitized.maintenanceStatus = ['待开放', '待确认'].includes(sanitized.recruitmentStatus)
      ? '自动维护'
      : '无需维护';
  }
  sanitized.userMaintained = typeof job.userEditedAt === 'string'
    || (Array.isArray(job.editedFields) && job.editedFields.length > 0)
    || !sanitized.id.startsWith('target-');
  return sanitized;
};

const uniqueNonEmptyStrings = (values) => [
  ...new Set(values.filter((value) => typeof value === 'string' && value.length > 0)),
];

export const buildRecruitmentMaintenanceScope = (snapshot, generatedAt = new Date().toISOString()) => {
  const items = isRecord(snapshot?.items) ? snapshot.items : Object.create(null);
  const warnings = [];
  const rawJobs = parseWorkspaceArray(items, recruitmentWorkspaceKeys.jobs, warnings);
  const jobs = [];
  for (const rawJob of rawJobs) {
    const job = sanitizeJob(rawJob);
    if (job) jobs.push(job);
    else warnings.push('岗位数组包含无有效 id 的记录，已忽略。');
  }

  const deletedJobIds = uniqueNonEmptyStrings(
    parseWorkspaceArray(items, recruitmentWorkspaceKeys.deletedJobIds, warnings),
  );
  const deletedJobFingerprints = uniqueNonEmptyStrings(
    parseWorkspaceArray(items, recruitmentWorkspaceKeys.deletedJobFingerprints, warnings),
  );

  return {
    version: 2,
    generatedAt,
    workspaceRevision: Number.isSafeInteger(snapshot?.revision) ? snapshot.revision : 0,
    workspaceUpdatedAt: typeof snapshot?.updatedAt === 'string' ? snapshot.updatedAt : '',
    initialized: snapshot?.initialized === true,
    jobs,
    deletedJobIds,
    deletedJobFingerprints,
    ...(warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {}),
  };
};

const tryChmod = (filePath, mode) => {
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Windows and some mounted filesystems do not implement POSIX permissions.
  }
};

export const writeRecruitmentMaintenanceScopeAtomic = (filePath, scope) => {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(scope, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    tryChmod(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
    tryChmod(filePath, 0o600);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created or may already be renamed.
    }
    throw error;
  }
};

export class RecruitmentMaintenanceScope {
  constructor(databasePath, snapshotProvider) {
    this.filePath = path.join(path.dirname(databasePath), recruitmentMaintenanceScopeFilename);
    this.snapshotProvider = snapshotProvider;
    this.scope = null;
  }

  refresh() {
    const scope = buildRecruitmentMaintenanceScope(this.snapshotProvider());
    writeRecruitmentMaintenanceScopeAtomic(this.filePath, scope);
    this.scope = scope;
    return scope;
  }

  current() {
    // The HTTP view must stay fresh even if the optional on-disk projection
    // cannot be written (for example, a read-only custom data directory).
    const snapshot = this.snapshotProvider();
    if (this.scope?.workspaceRevision === snapshot.revision
      && this.scope?.workspaceUpdatedAt === snapshot.updatedAt) return this.scope;
    return buildRecruitmentMaintenanceScope(snapshot);
  }
}
