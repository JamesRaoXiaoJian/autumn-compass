import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  setWorkspaceItem,
  workspaceEventTouchesKey,
  workspaceUpdatedEvent,
} from '../lib/workspaceSync';
import {
  jobCatalogRevisionStorageKey,
  mergeCatalogJobs,
  normalizeJob,
  parseStoredJobCatalogRevision,
  shouldApplyJobCatalogRevision,
} from '../lib/jobCatalog';
import { getJobMaintenanceFingerprints, type JobMaintenanceIdentity } from '../lib/jobIdentity';
import type { Job } from '../types';

const storageKey = 'autumn-compass-jobs-2027-v7';
const deletedJobIdsStorageKey = 'autumn-compass-deleted-job-ids-2027-v1';
const deletedJobFingerprintsStorageKey = 'autumn-compass-deleted-job-fingerprints-2027-v1';
const previousStorageKeys = ['autumn-compass-jobs-2027-v6', 'autumn-compass-jobs-2027-v5', 'autumn-compass-jobs-2027-v4', 'autumn-compass-jobs-2027-v3', 'autumn-compass-jobs-2027-v2'];

function readStringArray(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  } catch {
    return [];
  }
}

const readDeletedJobIds = () => readStringArray(deletedJobIdsStorageKey);
const readDeletedJobFingerprints = () => readStringArray(deletedJobFingerprintsStorageKey);

function mergeRetiredDeletionIds(
  deletedJobIds: string[],
  retiredJobIdentities: JobMaintenanceIdentity[],
) {
  const merged = [...new Set([
    ...deletedJobIds,
    ...retiredJobIdentities.map((job) => job.id).filter((id): id is string => Boolean(id)),
  ])];
  return merged.length === deletedJobIds.length
    && merged.every((value, index) => value === deletedJobIds[index])
    ? deletedJobIds
    : merged;
}

function mergeRetiredDeletionFingerprints(
  deletedJobFingerprints: string[],
  retiredJobIdentities: JobMaintenanceIdentity[],
) {
  const merged = [...new Set([
    ...deletedJobFingerprints,
    ...retiredJobIdentities.flatMap(getJobMaintenanceFingerprints),
  ])];
  return merged.length === deletedJobFingerprints.length
    && merged.every((value, index) => value === deletedJobFingerprints[index])
    ? deletedJobFingerprints
    : merged;
}

function filterVisibleJobs(
  jobs: Job[],
  deletedJobIds: string[],
  deletedJobFingerprints: string[],
  retiredJobIdentities: JobMaintenanceIdentity[],
) {
  const deletedIds = new Set(deletedJobIds);
  const deletedFingerprints = new Set(deletedJobFingerprints);
  const retiredIds = new Set(retiredJobIdentities.map((job) => job.id).filter(Boolean));
  const retiredFingerprints = new Set(retiredJobIdentities.flatMap(getJobMaintenanceFingerprints));
  return jobs.filter((job) => !deletedIds.has(job.id)
    && !retiredIds.has(job.id)
    && !getJobMaintenanceFingerprints(job).some((fingerprint) => (
      deletedFingerprints.has(fingerprint) || retiredFingerprints.has(fingerprint)
    )));
}

function readServerJobs(
  deletedJobIds: string[],
  deletedJobFingerprints: string[],
  retiredJobIdentities: JobMaintenanceIdentity[],
) {
  try {
    const current = window.localStorage.getItem(storageKey);
    if (current === null) return null;
    const parsed = JSON.parse(current) as unknown;
    if (!Array.isArray(parsed)) return null;
    return filterVisibleJobs(
      (parsed as Job[]).map(normalizeJob),
      deletedJobIds,
      deletedJobFingerprints,
      retiredJobIdentities,
    );
  } catch {
    return null;
  }
}

function migrateJobs(
  initialJobs: Job[],
  deletedJobIds: string[],
  deletedJobFingerprints: string[],
  retiredJobIdentities: JobMaintenanceIdentity[] = [],
) {
  try {
    const current = window.localStorage.getItem(storageKey);
    if (current) return filterVisibleJobs(
      mergeCatalogJobs(initialJobs, JSON.parse(current) as Job[]),
      deletedJobIds,
      deletedJobFingerprints,
      retiredJobIdentities,
    );

    const previous = previousStorageKeys
      .map((key) => window.localStorage.getItem(key))
      .find((value) => value !== null);
    if (!previous) return filterVisibleJobs(
      initialJobs.map(normalizeJob),
      deletedJobIds,
      deletedJobFingerprints,
      retiredJobIdentities,
    );
    return filterVisibleJobs(
      mergeCatalogJobs(initialJobs, JSON.parse(previous) as Job[]),
      deletedJobIds,
      deletedJobFingerprints,
      retiredJobIdentities,
    );
  } catch {
    return filterVisibleJobs(
      initialJobs.map(normalizeJob),
      deletedJobIds,
      deletedJobFingerprints,
      retiredJobIdentities,
    );
  }
}

interface JobCatalogState {
  deletedJobIds: string[];
  deletedJobFingerprints: string[];
  jobs: Job[];
  migrationRequired: boolean;
}

function readJobCatalogRevision() {
  return parseStoredJobCatalogRevision(window.localStorage.getItem(jobCatalogRevisionStorageKey));
}

function buildJobCatalogState(
  initialJobs: Job[],
  retiredJobIdentities: JobMaintenanceIdentity[],
  bundledCatalogRevision: number,
): JobCatalogState {
  const migrationRequired = shouldApplyJobCatalogRevision(
    bundledCatalogRevision,
    readJobCatalogRevision(),
  );
  const storedDeletedJobIds = readDeletedJobIds();
  const storedDeletedJobFingerprints = readDeletedJobFingerprints();
  if (!migrationRequired) {
    return {
      deletedJobIds: storedDeletedJobIds,
      deletedJobFingerprints: storedDeletedJobFingerprints,
      jobs: readServerJobs(storedDeletedJobIds, storedDeletedJobFingerprints, []) ?? [],
      migrationRequired: false,
    };
  }

  const deletedJobIds = mergeRetiredDeletionIds(storedDeletedJobIds, retiredJobIdentities);
  const deletedIds = new Set(deletedJobIds);
  const legacyFingerprints = [...initialJobs, ...retiredJobIdentities]
    .filter((job) => typeof job.id === 'string' && deletedIds.has(job.id))
    .flatMap(getJobMaintenanceFingerprints);
  const deletedJobFingerprints = mergeRetiredDeletionFingerprints(
    [...new Set([...storedDeletedJobFingerprints, ...legacyFingerprints])],
    retiredJobIdentities,
  );
  return {
    deletedJobIds,
    deletedJobFingerprints,
    jobs: migrateJobs(
      initialJobs,
      deletedJobIds,
      deletedJobFingerprints,
      retiredJobIdentities,
    ),
    migrationRequired: true,
  };
}

export function useJobs(
  initialJobs: Job[],
  retiredJobIdentities: JobMaintenanceIdentity[],
  bundledCatalogRevision: number,
) {
  if (!Number.isSafeInteger(bundledCatalogRevision) || bundledCatalogRevision <= 0) {
    throw new Error('jobCatalogRevision 必须是正安全整数');
  }

  const initialCatalogStateRef = useRef<JobCatalogState | null>(null);
  if (!initialCatalogStateRef.current) {
    initialCatalogStateRef.current = buildJobCatalogState(
      initialJobs,
      retiredJobIdentities,
      bundledCatalogRevision,
    );
  }
  const initialCatalogState = initialCatalogStateRef.current;
  const [deletedJobIds, setDeletedJobIdsState] = useState<string[]>(initialCatalogState.deletedJobIds);
  const [deletedJobFingerprints, setDeletedJobFingerprintsState] = useState<string[]>(
    initialCatalogState.deletedJobFingerprints,
  );
  const [jobs, setJobsState] = useState<Job[]>(initialCatalogState.jobs);
  const deletedJobIdsRef = useRef(deletedJobIds);
  const deletedJobFingerprintsRef = useRef(deletedJobFingerprints);
  const jobsRef = useRef(jobs);
  const catalogMigrationPromiseRef = useRef<Promise<void> | null>(null);

  deletedJobIdsRef.current = deletedJobIds;
  deletedJobFingerprintsRef.current = deletedJobFingerprints;
  jobsRef.current = jobs;

  const setDeletedJobIds: Dispatch<SetStateAction<string[]>> = useCallback((action) => {
    const current = deletedJobIdsRef.current;
    const next = typeof action === 'function' ? action(current) : action;
    if (next === current) return;
    deletedJobIdsRef.current = next;
    setDeletedJobIdsState(next);
    void setWorkspaceItem(deletedJobIdsStorageKey, JSON.stringify(next));
  }, []);

  const setDeletedJobFingerprints: Dispatch<SetStateAction<string[]>> = useCallback((action) => {
    const current = deletedJobFingerprintsRef.current;
    const next = typeof action === 'function' ? action(current) : action;
    if (next === current) return;
    deletedJobFingerprintsRef.current = next;
    setDeletedJobFingerprintsState(next);
    void setWorkspaceItem(deletedJobFingerprintsStorageKey, JSON.stringify(next));
  }, []);

  const setJobs: Dispatch<SetStateAction<Job[]>> = useCallback((action) => {
    const current = jobsRef.current;
    const next = typeof action === 'function' ? action(current) : action;
    if (next === current) return;
    jobsRef.current = next;
    setJobsState(next);
    void setWorkspaceItem(storageKey, JSON.stringify(next));
  }, []);

  const hydrateCatalogState = useCallback((next: JobCatalogState) => {
    deletedJobIdsRef.current = next.deletedJobIds;
    deletedJobFingerprintsRef.current = next.deletedJobFingerprints;
    jobsRef.current = next.jobs;
    setDeletedJobIdsState(next.deletedJobIds);
    setDeletedJobFingerprintsState(next.deletedJobFingerprints);
    setJobsState(next.jobs);
  }, []);

  const ensureCatalogMigration = useCallback(() => {
    if (catalogMigrationPromiseRef.current) return catalogMigrationPromiseRef.current;
    const migration = (async () => {
      const next = buildJobCatalogState(
        initialJobs,
        retiredJobIdentities,
        bundledCatalogRevision,
      );
      if (!next.migrationRequired) return;
      hydrateCatalogState(next);

      // These writes intentionally remain per-key so recruitment migration can
      // never replace interviews, notes, or resume data. The marker is last:
      // after any interruption, an older marker makes the migration retryable.
      await setWorkspaceItem(deletedJobIdsStorageKey, JSON.stringify(next.deletedJobIds));
      await setWorkspaceItem(
        deletedJobFingerprintsStorageKey,
        JSON.stringify(next.deletedJobFingerprints),
      );
      // A workflow edit or remote refresh may have landed while the tombstone
      // writes were awaiting acknowledgement. Rebuild immediately before the
      // jobs write so that edit becomes part of the migration value instead of
      // being replaced by the earlier snapshot.
      const latest = buildJobCatalogState(
        initialJobs,
        retiredJobIdentities,
        bundledCatalogRevision,
      );
      hydrateCatalogState(latest);
      await setWorkspaceItem(storageKey, JSON.stringify(latest.jobs));
      if (shouldApplyJobCatalogRevision(bundledCatalogRevision, readJobCatalogRevision())) {
        await setWorkspaceItem(
          jobCatalogRevisionStorageKey,
          JSON.stringify(bundledCatalogRevision),
        );
      }
    })().catch(() => {
      // The workspace sync layer retains failed mutations in its durable
      // outbox and exposes the actionable error. Leaving the marker behind is
      // intentional: the catalog migration will be safe to retry.
    });
    catalogMigrationPromiseRef.current = migration;
    void migration.finally(() => {
      if (catalogMigrationPromiseRef.current === migration) {
        catalogMigrationPromiseRef.current = null;
      }
    });
    return migration;
  }, [bundledCatalogRevision, hydrateCatalogState, initialJobs, retiredJobIdentities]);

  useEffect(() => {
    void ensureCatalogMigration();
  }, [ensureCatalogMigration]);

  useEffect(() => {
    const handleWorkspaceUpdate = (event: CustomEvent) => {
      if (!workspaceEventTouchesKey(event, storageKey)
        && !workspaceEventTouchesKey(event, deletedJobIdsStorageKey)
        && !workspaceEventTouchesKey(event, deletedJobFingerprintsStorageKey)
        && !workspaceEventTouchesKey(event, jobCatalogRevisionStorageKey)) return;
      const next = buildJobCatalogState(
        initialJobs,
        retiredJobIdentities,
        bundledCatalogRevision,
      );
      // Hydrating a canonical remote snapshot is read-only. A newer bundled
      // catalog is the sole case that schedules the ordered migration above.
      hydrateCatalogState(next);
      if (next.migrationRequired) void ensureCatalogMigration();
    };
    window.addEventListener(workspaceUpdatedEvent, handleWorkspaceUpdate);
    return () => window.removeEventListener(workspaceUpdatedEvent, handleWorkspaceUpdate);
  }, [
    bundledCatalogRevision,
    ensureCatalogMigration,
    hydrateCatalogState,
    initialJobs,
    retiredJobIdentities,
  ]);

  const deleteJob = (id: string) => {
    const deleted = jobsRef.current.find((job) => job.id === id);
    if (deleted) {
      const nextFingerprints = getJobMaintenanceFingerprints(deleted);
      setDeletedJobFingerprints((fingerprints) => [...new Set([...fingerprints, ...nextFingerprints])]);
    }
    setJobs((current) => current.filter((job) => job.id !== id));
    setDeletedJobIds((current) => current.includes(id) ? current : [...current, id]);
  };

  const restoreJobTracking = (job: Job) => {
    const fingerprints = new Set(getJobMaintenanceFingerprints(job));
    setDeletedJobIds((current) => current.filter((id) => id !== job.id));
    setDeletedJobFingerprints((current) => current.filter((value) => !fingerprints.has(value)));
  };

  return [jobs, setJobs, deleteJob, restoreJobTracking] as const;
}
