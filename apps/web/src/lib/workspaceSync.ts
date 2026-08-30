import {
  jobCatalogRevisionStorageKey,
  mergeJobCatalogRevisionValues,
} from './jobCatalog';

const workspaceKeyPrefix = 'autumn-compass-';
const legacyOutboxStorageKey = '__autumn_compass_sync_outbox_v1';
const outboxEntryPrefix = '__autumn_compass_sync_outbox_v2__:';
const resumeStorageKey = 'autumn-compass-resume-document-v4';
const resumeCandidateKeys = [resumeStorageKey, 'autumn-compass-resume-document-v3', 'autumn-compass-profile-v2'];
const resumeDatabaseName = 'autumn-compass';
const resumeStoreName = 'resume_documents';

export const workspaceUpdatedEvent = 'autumn-compass:workspace-updated';
export const workspaceSyncStatusEvent = 'autumn-compass:workspace-sync-status';

export type WorkspaceSyncState = 'idle' | 'bootstrapping' | 'syncing' | 'online' | 'reconnecting' | 'error';

export interface WorkspaceSyncStatus {
  state: WorkspaceSyncState;
  message: string;
  pendingWrites: number;
  canDiscardLocalChanges: boolean;
}

export interface WorkspaceUpdatedDetail {
  changedKeys: string[];
  revision: number;
  source: 'bootstrap' | 'local' | 'remote';
  fullReplace: boolean;
}

interface WorkspaceSnapshot {
  items: Record<string, string>;
  revision: number;
  updatedAt: string;
  initialized: boolean;
  clientId: string | null;
}

interface WorkspaceEventPayload {
  type: string;
  revision: number;
  updatedAt: string;
  clientId: string | null;
  changedKeys: string[];
  fullReplace: boolean;
}

type MutationValue = string | null;

interface PendingMutation {
  value: MutationValue;
  baseValue: MutationValue | undefined;
  baseRevision: number | undefined;
  conflicted: boolean;
  waiters: Array<{ resolve: () => void }>;
}

interface PersistedMutation {
  key: string;
  value: MutationValue;
  baseValue?: MutationValue;
  baseRevision?: number;
}

export class WorkspaceInitializationRequiredError extends Error {
  constructor() {
    super('服务器和本浏览器均未发现可迁移的工作区数据');
    this.name = 'WorkspaceInitializationRequiredError';
  }
}

export class WorkspaceReplaceError extends Error {
  constructor(
    public readonly serverUpdated: boolean,
    public readonly outcomeUnknown: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceReplaceError';
  }
}

class WorkspaceApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details: Record<string, unknown> | null,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceApiError';
  }
}

class WorkspaceConcurrentEditError extends Error {
  constructor(public readonly key: string) {
    super(`另一台设备同时修改了 ${key} 中的同一条数据；已停止自动覆盖服务器版本`);
    this.name = 'WorkspaceConcurrentEditError';
  }
}

declare global {
  interface WindowEventMap {
    'autumn-compass:workspace-updated': CustomEvent<WorkspaceUpdatedDetail>;
    'autumn-compass:workspace-sync-status': CustomEvent<WorkspaceSyncStatus>;
  }
}

const pendingMutations = new Map<string, PendingMutation>();
// A mutation response proves the server accepted a revision, but it does not
// prove this browser has applied every intervening remote change. Keep those
// facts separate so a local write cannot suppress a pending remote refresh.
let knownServerRevision = 0;
let appliedSnapshotRevision = 0;
let canonicalItems: Record<string, string> = {};
let eventSource: EventSource | null = null;
let flushPromise: Promise<boolean> | null = null;
let remoteRefreshPromise: Promise<void> | null = null;
let remoteRevisionRequested = 0;
let retryTimer: number | undefined;
let realtimeReconnectTimer: number | undefined;
let realtimeConnectionDegraded = false;
const realtimeReconnectGraceMs = 4000;
const outboxTakeoverTimers = new Map<string, number>();
let outboxStorageListener: ((event: StorageEvent) => void) | null = null;
let bulkReplacing = false;
let hasUnresolvedConflict = false;
let status: WorkspaceSyncStatus = {
  state: 'idle', message: '', pendingWrites: 0, canDiscardLocalChanges: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkspaceKey(key: string) {
  return key.startsWith(workspaceKeyPrefix);
}

function createClientId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const clientId = createClientId();

function describeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return '无法连接服务器同步接口';
}

function setStatus(state: WorkspaceSyncState, message = '') {
  const effectiveState = state === 'online' && realtimeConnectionDegraded ? 'reconnecting' : state;
  const effectiveMessage = effectiveState === 'reconnecting' && !message
    ? '实时更新连接正在重试；修改仍会直接保存到服务器。'
    : message;
  const nextStatus: WorkspaceSyncStatus = {
    state: effectiveState,
    message: effectiveMessage,
    pendingWrites: pendingMutations.size,
    canDiscardLocalChanges: hasUnresolvedConflict && pendingMutations.size > 0,
  };
  if (status.state === nextStatus.state
    && status.message === nextStatus.message
    && status.pendingWrites === nextStatus.pendingWrites
    && status.canDiscardLocalChanges === nextStatus.canDiscardLocalChanges) return;
  status = nextStatus;
  window.dispatchEvent(new CustomEvent<WorkspaceSyncStatus>(workspaceSyncStatusEvent, { detail: status }));
}

function clearRealtimeReconnectTimer() {
  if (realtimeReconnectTimer !== undefined) window.clearTimeout(realtimeReconnectTimer);
  realtimeReconnectTimer = undefined;
}

function markRealtimeConnectionReady() {
  clearRealtimeReconnectTimer();
  realtimeConnectionDegraded = false;
}

function scheduleRealtimeReconnectNotice() {
  if (realtimeReconnectTimer !== undefined || realtimeConnectionDegraded) return;
  realtimeReconnectTimer = window.setTimeout(() => {
    realtimeReconnectTimer = undefined;
    realtimeConnectionDegraded = true;
    if (status.state !== 'error' && status.state !== 'syncing' && status.state !== 'bootstrapping') {
      setStatus('reconnecting', '实时更新连接正在重试；修改仍会直接保存到服务器。');
    }
  }, realtimeReconnectGraceMs);
}

export function getWorkspaceSyncStatus() {
  return status;
}

function collectWorkspaceItems() {
  const items: Record<string, string> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !isWorkspaceKey(key)) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) items[key] = value;
  }
  return items;
}

async function readResumeDatabaseCandidate() {
  if (resumeCandidateKeys.some((key) => window.localStorage.getItem(key) !== null)) return null;
  if (!('indexedDB' in window)) return null;
  try {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(resumeDatabaseName, 1);
      request.onupgradeneeded = () => {
        const openedDatabase = request.result;
        if (!openedDatabase.objectStoreNames.contains(resumeStoreName)) openedDatabase.createObjectStore(resumeStoreName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return await new Promise<string | null>((resolve, reject) => {
      const transaction = database.transaction(resumeStoreName, 'readonly');
      const request = transaction.objectStore(resumeStoreName).get('active');
      request.onsuccess = () => {
        try {
          resolve(request.result === undefined ? null : JSON.stringify(request.result));
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => database.close();
    });
  } catch {
    return null;
  }
}

async function collectBootstrapCandidates() {
  const items = collectWorkspaceItems();
  const resumeCandidate = await readResumeDatabaseCandidate();
  if (resumeCandidate) items[resumeStorageKey] = resumeCandidate;
  return items;
}

function validateItems(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new Error('服务器返回了无效的工作区数据');
  const items: Record<string, string> = {};
  for (const [key, itemValue] of Object.entries(value)) {
    if (!isWorkspaceKey(key) || typeof itemValue !== 'string') {
      throw new Error('服务器返回了无效的工作区条目');
    }
    items[key] = itemValue;
  }
  return items;
}

function validateSnapshot(value: unknown): WorkspaceSnapshot {
  if (!isRecord(value)
    || !Number.isInteger(value.revision)
    || (value.revision as number) < 0
    || typeof value.updatedAt !== 'string'
    || typeof value.initialized !== 'boolean'
    || (value.clientId !== null && typeof value.clientId !== 'string')) {
    throw new Error('服务器返回了无效的工作区快照');
  }
  return {
    items: validateItems(value.items),
    revision: value.revision as number,
    updatedAt: value.updatedAt,
    initialized: value.initialized,
    clientId: value.clientId as string | null,
  };
}

async function readJson(response: Response) {
  const value = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const errorValue = isRecord(value) ? value.error : null;
    const serverMessage = typeof errorValue === 'string'
      ? errorValue
      : isRecord(errorValue) && typeof errorValue.message === 'string'
        ? errorValue.message
        : '';
    const errorCode = isRecord(errorValue) && typeof errorValue.code === 'string' ? errorValue.code : 'HTTP_ERROR';
    const errorDetails = isRecord(errorValue) && isRecord(errorValue.details) ? errorValue.details : null;
    throw new WorkspaceApiError(
      response.status,
      errorCode,
      errorDetails,
      serverMessage || `服务器同步请求失败（HTTP ${response.status}）`,
    );
  }
  return value;
}

const missingJsonValue = Symbol('missing-json-value');
type MergeableJson = null | boolean | number | string | MergeableJson[] | { [key: string]: MergeableJson };
type MergeNode = MergeableJson | typeof missingJsonValue;

function isJsonObject(value: MergeNode): value is { [key: string]: MergeableJson } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonNodeEqual(left: MergeNode, right: MergeNode) {
  if (left === missingJsonValue || right === missingJsonValue) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

function isEntityArray(value: MergeNode): value is Array<{ id: string; [key: string]: MergeableJson }> {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!isJsonObject(item) || typeof item.id !== 'string' || item.id.length === 0 || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

function mergeJsonNode(base: MergeNode, local: MergeNode, remote: MergeNode): MergeNode {
  if (jsonNodeEqual(local, remote)) return local;
  if (jsonNodeEqual(local, base)) return remote;
  if (jsonNodeEqual(remote, base)) return local;

  if (isJsonObject(base) && isJsonObject(local) && isJsonObject(remote)) {
    const merged: { [key: string]: MergeableJson } = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const next = mergeJsonNode(
        Object.hasOwn(base, key) ? base[key] : missingJsonValue,
        Object.hasOwn(local, key) ? local[key] : missingJsonValue,
        Object.hasOwn(remote, key) ? remote[key] : missingJsonValue,
      );
      if (next !== missingJsonValue) merged[key] = next;
    }
    return merged;
  }

  if (isEntityArray(base) && isEntityArray(local) && isEntityArray(remote)) {
    const baseById = new Map(base.map((item) => [item.id, item]));
    const localById = new Map(local.map((item) => [item.id, item]));
    const remoteById = new Map(remote.map((item) => [item.id, item]));
    const orderedIds = [...new Set([...remote.map((item) => item.id), ...local.map((item) => item.id)])];
    const merged: Array<{ id: string; [key: string]: MergeableJson }> = [];
    for (const id of orderedIds) {
      const next = mergeJsonNode(
        baseById.get(id) ?? missingJsonValue,
        localById.get(id) ?? missingJsonValue,
        remoteById.get(id) ?? missingJsonValue,
      );
      if (next === missingJsonValue) continue;
      if (!isJsonObject(next) || next.id !== id) throw new Error('实体数组合并结果无效');
      merged.push(next as { id: string; [key: string]: MergeableJson });
    }
    return merged;
  }

  throw new Error('同一字段在多台设备上发生并发修改');
}

function parseMutationValue(value: MutationValue): MergeNode {
  if (value === null) return missingJsonValue;
  return JSON.parse(value) as MergeableJson;
}

function mergeMutationValue(
  key: string,
  baseValue: MutationValue | undefined,
  localValue: MutationValue,
  remoteValue: MutationValue,
) {
  // An old outbox without a baseline is still safe to discard when the server
  // already contains the exact desired bytes. Any other legacy case must stop
  // instead of guessing which side is newer.
  if (localValue === remoteValue) return localValue;
  if (baseValue === undefined) throw new Error('旧离线队列缺少可验证的基线版本');
  if (remoteValue === baseValue) return localValue;
  if (key === jobCatalogRevisionStorageKey) {
    // Catalog versions are a one-way fence. The higher bundle may have
    // completed its ordered data writes before this marker raced with an older
    // tab, so the marker itself must never move backwards.
    return mergeJobCatalogRevisionValues(localValue, remoteValue);
  }
  if (key === 'autumn-compass-deleted-job-ids-2027-v1'
    || key === 'autumn-compass-deleted-job-fingerprints-2027-v1') {
    const localIds = localValue === null ? [] : JSON.parse(localValue) as unknown;
    const remoteIds = remoteValue === null ? [] : JSON.parse(remoteValue) as unknown;
    if (!Array.isArray(localIds) || !localIds.every((id) => typeof id === 'string')
      || !Array.isArray(remoteIds) || !remoteIds.every((id) => typeof id === 'string')) {
      throw new Error('岗位删除记录格式无效');
    }
    return JSON.stringify([...new Set([...remoteIds, ...localIds])]);
  }
  const merged = mergeJsonNode(
    parseMutationValue(baseValue),
    parseMutationValue(localValue),
    parseMutationValue(remoteValue),
  );
  return merged === missingJsonValue ? null : JSON.stringify(merged);
}

function parseLegacyOutbox(raw: string | null) {
  const mutations = new Map<string, Omit<PersistedMutation, 'key'>>();
  if (!raw) return mutations;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return mutations;
  for (const item of parsed) {
    if (!isRecord(item) || typeof item.key !== 'string' || !isWorkspaceKey(item.key)) continue;
    if (item.value !== null && typeof item.value !== 'string') continue;
    if (item.baseValue !== undefined && item.baseValue !== null && typeof item.baseValue !== 'string') continue;
    if (item.baseRevision !== undefined && (!Number.isSafeInteger(item.baseRevision) || (item.baseRevision as number) < 0)) continue;
    mutations.set(item.key, {
      value: item.value as MutationValue,
      baseValue: item.baseValue as MutationValue | undefined,
      baseRevision: item.baseRevision as number | undefined,
    });
  }
  return mutations;
}

function outboxEntryStorageKey(key: string) {
  return `${outboxEntryPrefix}${encodeURIComponent(key)}`;
}

function parseOutboxEntry(raw: string | null): PersistedMutation | null {
  if (!raw) return null;
  const item = JSON.parse(raw) as unknown;
  if (!isRecord(item) || typeof item.key !== 'string' || !isWorkspaceKey(item.key)) return null;
  if (item.value !== null && typeof item.value !== 'string') return null;
  if (item.baseValue !== undefined && item.baseValue !== null && typeof item.baseValue !== 'string') return null;
  if (item.baseRevision !== undefined && (!Number.isSafeInteger(item.baseRevision) || (item.baseRevision as number) < 0)) return null;
  return {
    key: item.key,
    value: item.value as MutationValue,
    baseValue: item.baseValue as MutationValue | undefined,
    baseRevision: item.baseRevision as number | undefined,
  };
}

function readDurableOutbox() {
  const mutations = new Map<string, Omit<PersistedMutation, 'key'>>();
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const storageKey = window.localStorage.key(index);
    if (!storageKey?.startsWith(outboxEntryPrefix)) continue;
    try {
      const mutation = parseOutboxEntry(window.localStorage.getItem(storageKey));
      if (!mutation || storageKey !== outboxEntryStorageKey(mutation.key)) continue;
      mutations.set(mutation.key, {
        value: mutation.value,
        baseValue: mutation.baseValue,
        baseRevision: mutation.baseRevision,
      });
    } catch {
      // Ignore malformed internal records; they never become workspace data.
    }
  }
  return mutations;
}

function writeDurableMutation(mutation: PersistedMutation) {
  window.localStorage.setItem(outboxEntryStorageKey(mutation.key), JSON.stringify(mutation));
}

function removeDurableMutation(completed: PersistedMutation) {
  const storageKey = outboxEntryStorageKey(completed.key);
  const current = parseOutboxEntry(window.localStorage.getItem(storageKey));
  if (current?.value === completed.value) window.localStorage.removeItem(storageKey);
}

function persistOutbox(completed?: PersistedMutation) {
  try {
    // Each workspace key owns an independent durable record, avoiding the
    // read/merge/write race of one shared JSON map across browser tabs.
    if (completed) removeDurableMutation(completed);
    for (const [key, mutation] of pendingMutations) {
      writeDurableMutation({
        key,
        value: mutation.value,
        baseValue: mutation.baseValue,
        baseRevision: mutation.baseRevision,
      });
    }
  } catch {
    // The in-memory outbox remains authoritative until durable storage is
    // writable again. A failed persistence attempt must not block the API write.
  }
}

function restoreOutbox() {
  let durable = new Map<string, Omit<PersistedMutation, 'key'>>();
  let legacyLocal = new Map<string, Omit<PersistedMutation, 'key'>>();
  let legacySession = new Map<string, Omit<PersistedMutation, 'key'>>();
  try {
    durable = readDurableOutbox();
  } catch {
    // Keep going: a legacy session queue may still be recoverable.
  }
  try {
    legacyLocal = parseLegacyOutbox(window.localStorage.getItem(legacyOutboxStorageKey));
  } catch {
    // A damaged local queue must not hide a valid session queue.
  }
  try {
    legacySession = parseLegacyOutbox(window.sessionStorage.getItem(legacyOutboxStorageKey));
  } catch {
    // A damaged session queue must not hide a valid local queue.
  }

  // Import legacy sessionStorage entries that do not already have a newer
  // durable counterpart. This preserves old offline edits on upgrade while
  // preferring the cross-tab localStorage value on same-key conflicts.
  const merged = new Map(legacySession);
  for (const [key, mutation] of legacyLocal) merged.set(key, mutation);
  for (const [key, mutation] of durable) merged.set(key, mutation);
  for (const [key, mutation] of merged) {
    pendingMutations.set(key, {
      value: mutation.value,
      baseValue: mutation.baseValue,
      baseRevision: mutation.baseRevision,
      conflicted: false,
      waiters: [],
    });
  }

  try {
    for (const [key, mutation] of merged) writeDurableMutation({ key, ...mutation });
    // Remove the old queue only after its merged replacement is durable.
    window.localStorage.removeItem(legacyOutboxStorageKey);
    window.sessionStorage.removeItem(legacyOutboxStorageKey);
  } catch {
    // Leave sessionStorage intact so migration can be retried on a later load.
  }
}

restoreOutbox();

function scheduleOutboxTakeover(storageKey: string, rawValue: string | null) {
  const existingTimer = outboxTakeoverTimers.get(storageKey);
  if (existingTimer !== undefined) window.clearTimeout(existingTimer);
  outboxTakeoverTimers.delete(storageKey);
  if (rawValue === null) return;

  const timer = window.setTimeout(() => {
    outboxTakeoverTimers.delete(storageKey);
    void (async () => {
      try {
        // The originating tab normally removes its record immediately after
        // the server acknowledgement. Before adopting a surviving record,
        // apply every known remote revision and merge from the persisted
        // baseline. Otherwise a stale outbox could be sent at the latest
        // global revision and silently overwrite a newer same-key value.
        if (knownServerRevision > appliedSnapshotRevision) {
          await queueRemoteRefresh(knownServerRevision);
        }
        const mutation = parseOutboxEntry(window.localStorage.getItem(storageKey));
        if (!mutation || storageKey !== outboxEntryStorageKey(mutation.key)) return;
        if (pendingMutations.has(mutation.key)) return;

        const remoteValue = canonicalValue(mutation.key);
        let mergedValue: MutationValue;
        try {
          mergedValue = mergeMutationValue(
            mutation.key,
            mutation.baseValue,
            mutation.value,
            remoteValue,
          );
        } catch {
          pendingMutations.set(mutation.key, {
            value: mutation.value,
            baseValue: mutation.baseValue,
            baseRevision: mutation.baseRevision,
            conflicted: true,
            waiters: [],
          });
          hasUnresolvedConflict = true;
          writeOptimisticLocalValue(mutation.key, mutation.value);
          dispatchWorkspaceUpdate([mutation.key], 'local');
          setStatus('error', '检测到另一标签遗留的修改与服务器版本冲突；已停止自动覆盖。');
          return;
        }

        if (mergedValue === remoteValue) {
          removeDurableMutation(mutation);
          return;
        }
        pendingMutations.set(mutation.key, {
          value: mergedValue,
          baseValue: remoteValue,
          baseRevision: appliedSnapshotRevision,
          conflicted: false,
          waiters: [],
        });
        persistOutbox();
        writeOptimisticLocalValue(mutation.key, mergedValue);
        dispatchWorkspaceUpdate([mutation.key], 'local');
        void flushPendingMutations();
      } catch {
        // Malformed internal records are ignored and never sent to the API.
      }
    })();
  }, 1500);
  outboxTakeoverTimers.set(storageKey, timer);
}

function attachOutboxStorageListener() {
  if (outboxStorageListener) return;
  outboxStorageListener = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage || !event.key?.startsWith(outboxEntryPrefix)) return;
    scheduleOutboxTakeover(event.key, event.newValue);
  };
  window.addEventListener('storage', outboxStorageListener);
}

function detachOutboxStorageListener() {
  if (outboxStorageListener) window.removeEventListener('storage', outboxStorageListener);
  outboxStorageListener = null;
  for (const timer of outboxTakeoverTimers.values()) window.clearTimeout(timer);
  outboxTakeoverTimers.clear();
}

function overlayPendingMutations() {
  for (const [key, mutation] of pendingMutations) {
    if (mutation.value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, mutation.value);
  }
}

function replaceLocalWorkspace(items: Record<string, string>) {
  const previous = collectWorkspaceItems();
  const changedKeys = new Set<string>();
  for (const [key, value] of Object.entries(previous)) {
    if (!(key in items)) {
      window.localStorage.removeItem(key);
      changedKeys.add(key);
    } else if (items[key] !== value) {
      changedKeys.add(key);
    }
  }
  for (const [key, value] of Object.entries(items)) {
    if (previous[key] !== value) changedKeys.add(key);
    window.localStorage.setItem(key, value);
  }
  return [...changedKeys];
}

function dispatchWorkspaceUpdate(changedKeys: string[], source: WorkspaceUpdatedDetail['source'], fullReplace = false) {
  window.dispatchEvent(new CustomEvent<WorkspaceUpdatedDetail>(workspaceUpdatedEvent, {
    detail: { changedKeys, revision: appliedSnapshotRevision, source, fullReplace },
  }));
}

async function fetchWorkspace() {
  const response = await fetch('/api/workspace', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  return validateSnapshot(await readJson(response));
}

function scheduleRetry() {
  if (retryTimer !== undefined) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    void flushPendingMutations();
  }, 5000);
}

function valueFromSnapshot(snapshot: WorkspaceSnapshot, key: string): MutationValue {
  return Object.hasOwn(snapshot.items, key) ? snapshot.items[key] : null;
}

function canonicalValue(key: string): MutationValue {
  return Object.hasOwn(canonicalItems, key) ? canonicalItems[key] : null;
}

function setCanonicalValue(key: string, value: MutationValue) {
  if (value === null) delete canonicalItems[key];
  else canonicalItems[key] = value;
}

function reconcilePendingMutations(snapshot: WorkspaceSnapshot) {
  const conflicts: string[] = [];
  for (const [key, mutation] of [...pendingMutations]) {
    const remoteValue = valueFromSnapshot(snapshot, key);
    let mergedValue: MutationValue;
    try {
      mergedValue = mergeMutationValue(key, mutation.baseValue, mutation.value, remoteValue);
    } catch {
      mutation.conflicted = true;
      conflicts.push(key);
      continue;
    }
    if (mergedValue === remoteValue) {
      pendingMutations.delete(key);
      mutation.waiters.forEach(({ resolve }) => resolve());
      persistOutbox({ key, value: mutation.value });
      continue;
    }
    mutation.value = mergedValue;
    mutation.baseValue = remoteValue;
    mutation.baseRevision = snapshot.revision;
    mutation.conflicted = false;
    persistOutbox();
  }
  hasUnresolvedConflict = conflicts.length > 0;
  return conflicts;
}

function writeOptimisticLocalValue(key: string, value: MutationValue) {
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
}

async function sendMutation(key: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const mutationAtSend = pendingMutations.get(key);
    if (!mutationAtSend) return undefined;
    const value = mutationAtSend.value;
    const baseRevision = appliedSnapshotRevision;
    try {
      const response = await fetch('/api/workspace/item', {
        method: value === null ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(value === null
          ? { key, clientId, baseRevision }
          : { key, value, clientId, baseRevision }),
      });
      const result = await readJson(response);
      if (!isRecord(result) || !Number.isInteger(result.revision) || (result.revision as number) < 0) {
        throw new Error('服务器返回了无效的写入结果');
      }
      const acknowledgedRevision = result.revision as number;
      knownServerRevision = Math.max(knownServerRevision, acknowledgedRevision);
      // A newer canonical GET may finish before this older write response.
      // Never roll applied state or the canonical key back for a late ACK.
      if (acknowledgedRevision >= appliedSnapshotRevision) {
        appliedSnapshotRevision = acknowledgedRevision;
        setCanonicalValue(key, value);
        writeOptimisticLocalValue(key, pendingMutations.get(key)?.value ?? value);
      }
      return { value, revision: acknowledgedRevision };
    } catch (error) {
      if (!(error instanceof WorkspaceApiError) || error.code !== 'REVISION_CONFLICT' || attempt === 2) throw error;
      const conflictRevision = error.details?.currentRevision;
      if (Number.isSafeInteger(conflictRevision) && (conflictRevision as number) >= 0) {
        knownServerRevision = Math.max(knownServerRevision, conflictRevision as number);
      }
      const snapshot = await refreshFromServer('remote', knownServerRevision);
      const latest = pendingMutations.get(key);
      if (!latest) return undefined;
      const remoteValue = valueFromSnapshot(snapshot, key);
      let mergedValue: MutationValue;
      try {
        mergedValue = mergeMutationValue(key, latest.baseValue, latest.value, remoteValue);
      } catch {
        throw new WorkspaceConcurrentEditError(key);
      }
      latest.value = mergedValue;
      latest.baseValue = remoteValue;
      writeOptimisticLocalValue(key, mergedValue);
      persistOutbox();
      dispatchWorkspaceUpdate([key], 'local');
      if (mergedValue === remoteValue) return { value: remoteValue, revision: snapshot.revision };
    }
  }
  throw new Error('服务器工作区持续发生并发更新，请稍后重试');
}

async function flushPendingMutations(throwOnError = false) {
  if (flushPromise) {
    const succeeded = await flushPromise;
    if (!succeeded && throwOnError) throw new Error(status.message || '工作区修改尚未写入服务器');
    return succeeded;
  }

  flushPromise = (async () => {
    if (!pendingMutations.size) {
      setStatus('online');
      return true;
    }
    if (knownServerRevision > appliedSnapshotRevision) {
      await queueRemoteRefresh(knownServerRevision);
    }
    if (hasUnresolvedConflict) {
      setStatus('error', '另一台设备同时修改了同一条数据；本机修改仍保留，请重试或明确选择使用服务器版本。');
      return false;
    }
    setStatus('syncing', '正在将修改写入服务器');
    try {
      while (pendingMutations.size) {
        const entry = pendingMutations.entries().next().value as [string, PendingMutation] | undefined;
        if (!entry) break;
        const [key, mutationBeforeSend] = entry;
        if (hasUnresolvedConflict || mutationBeforeSend.conflicted) {
          hasUnresolvedConflict = true;
          break;
        }
        const acknowledgement = await sendMutation(key);
        if (acknowledgement === undefined) continue;
        const sentValue = acknowledgement.value;
        const latest = pendingMutations.get(key);
        if (latest && latest.value === sentValue && !latest.conflicted) {
          pendingMutations.delete(key);
          latest.waiters.forEach(({ resolve }) => resolve());
          persistOutbox({ key, value: sentValue });
        } else if (latest
          && !latest.conflicted
          && acknowledgement.revision >= appliedSnapshotRevision
          && (latest.baseRevision === undefined || acknowledgement.revision >= latest.baseRevision)) {
          // A newer local edit arrived while the previous value was in flight.
          // The acknowledged value is now its three-way merge baseline.
          latest.baseValue = sentValue;
          latest.baseRevision = acknowledgement.revision;
          persistOutbox();
        }
      }
      if (knownServerRevision > appliedSnapshotRevision) {
        await queueRemoteRefresh(knownServerRevision);
      }
      if (hasUnresolvedConflict) {
        setStatus('error', '另一台设备同时修改了同一条数据；本机修改仍保留，请重试或明确选择使用服务器版本。');
        return false;
      }
      hasUnresolvedConflict = false;
      setStatus('online');
      return true;
    } catch (error) {
      if (error instanceof WorkspaceConcurrentEditError) hasUnresolvedConflict = true;
      setStatus('error', `修改已保留在本浏览器，但尚未写入服务器：${describeError(error)}`);
      scheduleRetry();
      return false;
    }
  })();

  const succeeded = await flushPromise;
  flushPromise = null;
  if (!succeeded && throwOnError) throw new Error(status.message || '工作区修改尚未写入服务器');
  return succeeded;
}

function enqueueMutation(key: string, value: MutationValue, baseValue: MutationValue) {
  return new Promise<void>((resolve) => {
    const previous = pendingMutations.get(key);
    pendingMutations.set(key, {
      value,
      baseValue: previous ? previous.baseValue : baseValue,
      baseRevision: previous ? previous.baseRevision : appliedSnapshotRevision,
      conflicted: previous?.conflicted ?? false,
      waiters: [...(previous?.waiters || []), { resolve }],
    });
    persistOutbox();
    if (!bulkReplacing) void flushPendingMutations();
  });
}

export function setWorkspaceItem(key: string, value: string) {
  if (!isWorkspaceKey(key)) throw new Error(`拒绝同步非工作区键：${key}`);
  const alreadyPending = pendingMutations.get(key);
  if (alreadyPending?.value === value) {
    return new Promise<void>((resolve) => alreadyPending.waiters.push({ resolve }));
  }
  const visibleValue = window.localStorage.getItem(key);
  if (visibleValue === value && !alreadyPending) return Promise.resolve();
  window.localStorage.setItem(key, value);
  return enqueueMutation(key, value, canonicalValue(key));
}

export function removeWorkspaceItem(key: string) {
  if (!isWorkspaceKey(key)) throw new Error(`拒绝同步非工作区键：${key}`);
  const alreadyPending = pendingMutations.get(key);
  if (alreadyPending?.value === null) {
    return new Promise<void>((resolve) => alreadyPending.waiters.push({ resolve }));
  }
  const visibleValue = window.localStorage.getItem(key);
  if (visibleValue === null && !alreadyPending) return Promise.resolve();
  window.localStorage.removeItem(key);
  return enqueueMutation(key, null, canonicalValue(key));
}

export async function replaceWorkspaceItems(items: Record<string, string>, options: { baseRevision?: number } = {}) {
  const validatedItems = validateItems(items);
  setStatus('syncing', '正在用备份替换服务器工作区');
  bulkReplacing = true;
  let serverUpdated = false;
  try {
    if (pendingMutations.size) await flushPendingMutations(true);
    const response = await fetch('/api/workspace', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        items: validatedItems,
        clientId,
        // A destructive replacement may only be authorized against a snapshot
        // this browser has actually applied. An SSE notification alone must
        // never "pre-approve" overwriting unseen remote data.
        baseRevision: options.baseRevision ?? appliedSnapshotRevision,
      }),
    });
    const snapshot = validateSnapshot(await readJson(response));
    serverUpdated = true;
    knownServerRevision = Math.max(knownServerRevision, snapshot.revision);
    if (snapshot.revision < knownServerRevision) {
      // Another client wrote after this replacement but before its response was
      // applied locally. Fetch the newer canonical snapshot instead of rolling
      // this browser back to the replacement revision.
      await refreshFromServer('remote', knownServerRevision);
    } else {
      appliedSnapshotRevision = snapshot.revision;
      canonicalItems = { ...snapshot.items };
      reconcilePendingMutations(snapshot);
      const changedKeys = replaceLocalWorkspace(snapshot.items);
      overlayPendingMutations();
      dispatchWorkspaceUpdate(changedKeys, 'local', true);
    }
    bulkReplacing = false;
    if (pendingMutations.size) await flushPendingMutations(true);
    setStatus('online');
  } catch (error) {
    bulkReplacing = false;
    if (pendingMutations.size) void flushPendingMutations();
    const outcomeUnknown = !serverUpdated && !(error instanceof WorkspaceApiError);
    const message = serverUpdated
      ? `服务器已完成替换，但当前浏览器刷新失败：${describeError(error)}`
      : outcomeUnknown
        ? `恢复请求的最终结果暂时无法确认，请重新连接并读取服务器工作区后核对：${describeError(error)}`
      : `服务器工作区替换失败：${describeError(error)}`;
    setStatus('error', message);
    throw new WorkspaceReplaceError(serverUpdated, outcomeUnknown, message);
  }
}

export function captureWorkspaceReplaceRevision() {
  if (pendingMutations.size || hasUnresolvedConflict || bulkReplacing) {
    throw new Error('当前仍有本机修改尚未确认写入服务器，请等待同步完成后重试');
  }
  if (knownServerRevision > appliedSnapshotRevision || remoteRefreshPromise) {
    throw new Error('服务器刚有新修改，当前页面尚未应用；请等待同步完成并重新确认恢复操作');
  }
  return appliedSnapshotRevision;
}

export async function readCanonicalWorkspaceItems() {
  setStatus('syncing', '正在读取服务器工作区');
  try {
    if (pendingMutations.size) await flushPendingMutations(true);
    const snapshot = await refreshFromServer('remote');
    setStatus('online');
    return { ...snapshot.items };
  } catch (error) {
    setStatus('error', `无法读取服务器工作区：${describeError(error)}`);
    throw error;
  }
}

export async function initializeEmptyWorkspace() {
  await replaceWorkspaceItems({}, { baseRevision: 0 });
}

async function refreshFromServer(source: WorkspaceUpdatedDetail['source'], minimumRevision = 0) {
  // A write response or a newer SSE event may advance the known revision while
  // this GET is in flight. Never apply that older full snapshot: fetch again so
  // a successful local write cannot be visually rolled back by a stale response.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await fetchWorkspace();
    if (!snapshot.initialized) {
      throw new Error('服务器工作区尚未初始化；请重新载入页面并从本机缓存恢复');
    }
    const requiredRevision = Math.max(minimumRevision, knownServerRevision);
    if (snapshot.revision < requiredRevision) {
      if (attempt < 2) continue;
      throw new Error('服务器 revision 发生回退；已停止覆盖本机缓存');
    }
    canonicalItems = { ...snapshot.items };
    const changedKeys = replaceLocalWorkspace(snapshot.items);
    knownServerRevision = Math.max(knownServerRevision, snapshot.revision);
    appliedSnapshotRevision = snapshot.revision;
    reconcilePendingMutations(snapshot);
    overlayPendingMutations();
    // Treat a canonical GET as a full refresh even when this tab's localStorage
    // already contains the new bytes (same-origin tabs share localStorage, but
    // their React state does not update automatically).
    dispatchWorkspaceUpdate(changedKeys, source, true);
    return snapshot;
  }
  throw new Error('无法取得服务器最新工作区');
}

async function queueRemoteRefresh(revision: number) {
  remoteRevisionRequested = Math.max(remoteRevisionRequested, revision);
  knownServerRevision = Math.max(knownServerRevision, revision);
  if (remoteRefreshPromise) return remoteRefreshPromise;
  remoteRefreshPromise = (async () => {
    try {
      while (remoteRevisionRequested > appliedSnapshotRevision) {
        const requested = remoteRevisionRequested;
        await refreshFromServer('remote', requested);
        if (appliedSnapshotRevision < requested) continue;
      }
      if (hasUnresolvedConflict) {
        setStatus('error', '检测到本机待保存修改与服务器版本冲突；已停止自动覆盖。');
      } else {
        setStatus(pendingMutations.size ? 'syncing' : 'online');
      }
    } catch (error) {
      setStatus('error', `无法读取服务器上的最新修改：${describeError(error)}`);
    } finally {
      remoteRefreshPromise = null;
    }
  })();
  return remoteRefreshPromise;
}

function parseWorkspaceEvent(event: MessageEvent<string>): WorkspaceEventPayload | null {
  try {
    const value = JSON.parse(event.data) as unknown;
    if (!isRecord(value)
      || typeof value.type !== 'string'
      || !Number.isInteger(value.revision)
      || typeof value.updatedAt !== 'string'
      || (value.clientId !== null && typeof value.clientId !== 'string')
      || !Array.isArray(value.changedKeys)
      || !value.changedKeys.every((key) => typeof key === 'string' && isWorkspaceKey(key))
      || typeof value.fullReplace !== 'boolean') return null;
    return value as unknown as WorkspaceEventPayload;
  } catch {
    return null;
  }
}

export async function bootstrapWorkspace() {
  setStatus('bootstrapping', '正在连接服务器并读取工作区');
  try {
    const response = await fetch('/api/workspace/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: await collectBootstrapCandidates(), clientId }),
    });
    const snapshot = validateSnapshot(await readJson(response));
    if (!snapshot.initialized) throw new WorkspaceInitializationRequiredError();
    canonicalItems = { ...snapshot.items };
    reconcilePendingMutations(snapshot);
    const changedKeys = replaceLocalWorkspace(snapshot.items);
    knownServerRevision = snapshot.revision;
    appliedSnapshotRevision = snapshot.revision;
    overlayPendingMutations();
    if (pendingMutations.size && !hasUnresolvedConflict) await flushPendingMutations(true);
    dispatchWorkspaceUpdate(changedKeys, 'bootstrap', true);
    if (hasUnresolvedConflict) {
      setStatus('error', '检测到本浏览器的离线修改与服务器版本冲突；已停止自动覆盖。');
    } else {
      setStatus('online');
    }
  } catch (error) {
    if (error instanceof WorkspaceInitializationRequiredError) {
      setStatus('idle', error.message);
      throw error;
    }
    setStatus('error', `无法载入服务器工作区：${describeError(error)}`);
    throw error;
  }
}

export function startWorkspaceSync() {
  if (eventSource) return () => stopWorkspaceSync();
  attachOutboxStorageListener();
  eventSource = new EventSource(`/api/events?clientId=${encodeURIComponent(clientId)}`);
  eventSource.addEventListener('ready', (event) => {
    markRealtimeConnectionReady();
    let readyRevision = knownServerRevision;
    let readyInitialized = true;
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as unknown;
      if (isRecord(payload) && Number.isInteger(payload.revision) && (payload.revision as number) >= 0) {
        readyRevision = payload.revision as number;
        if (typeof payload.initialized === 'boolean') readyInitialized = payload.initialized;
      }
    } catch {
      // A malformed ready event does not make the already bootstrapped workspace unsafe.
    }
    if (!readyInitialized) {
      setStatus('error', '服务器工作区尚未初始化；请重新载入页面并从本机缓存恢复');
      return;
    }
    knownServerRevision = Math.max(knownServerRevision, readyRevision);
    setStatus(
      hasUnresolvedConflict
        ? 'error'
        : pendingMutations.size || readyRevision > appliedSnapshotRevision
          ? 'syncing'
          : 'online',
      hasUnresolvedConflict ? '检测到本机待保存修改与服务器版本冲突；已停止自动覆盖。' : '',
    );
    if (readyRevision > appliedSnapshotRevision) void queueRemoteRefresh(readyRevision);
    if (pendingMutations.size) void flushPendingMutations();
  });
  eventSource.addEventListener('workspace', (event) => {
    const payload = parseWorkspaceEvent(event as MessageEvent<string>);
    if (!payload) return;
    if (payload.clientId === clientId) {
      knownServerRevision = Math.max(knownServerRevision, payload.revision);
      return;
    }
    knownServerRevision = Math.max(knownServerRevision, payload.revision);
    if (payload.revision <= appliedSnapshotRevision) return;
    void queueRemoteRefresh(payload.revision);
  });
  eventSource.onerror = () => {
    // EventSource reconnects automatically. A short proxy/tunnel interruption
    // does not mean a save failed, so only expose a separate reconnecting state
    // when the stream has remained unavailable beyond the grace period.
    scheduleRealtimeReconnectNotice();
  };
  return () => stopWorkspaceSync();
}

export function stopWorkspaceSync() {
  eventSource?.close();
  eventSource = null;
  clearRealtimeReconnectTimer();
  realtimeConnectionDegraded = false;
  detachOutboxStorageListener();
}

export async function retryWorkspaceSync() {
  if (retryTimer !== undefined) {
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  setStatus('syncing', '正在重新连接服务器');
  try {
    await refreshFromServer('remote');
    if (hasUnresolvedConflict) throw new WorkspaceConcurrentEditError([...pendingMutations.keys()][0] || 'workspace');
    if (pendingMutations.size) await flushPendingMutations(true);
    stopWorkspaceSync();
    startWorkspaceSync();
    setStatus('online');
  } catch (error) {
    setStatus('error', `重新连接失败：${describeError(error)}`);
    throw error;
  }
}

export async function discardPendingWorkspaceChanges() {
  setStatus('syncing', '正在读取服务器版本');
  try {
    const snapshot = await fetchWorkspace();
    if (!snapshot.initialized) throw new Error('服务器工作区尚未初始化');
    const discarded = [...pendingMutations].map(([key, mutation]) => ({
      key,
      value: mutation.value,
      waiters: mutation.waiters,
    }));
    pendingMutations.clear();
    for (const mutation of discarded) {
      mutation.waiters.forEach(({ resolve }) => resolve());
      persistOutbox({ key: mutation.key, value: mutation.value });
    }
    hasUnresolvedConflict = false;
    knownServerRevision = Math.max(knownServerRevision, snapshot.revision);
    appliedSnapshotRevision = snapshot.revision;
    canonicalItems = { ...snapshot.items };
    const changedKeys = replaceLocalWorkspace(snapshot.items);
    dispatchWorkspaceUpdate(changedKeys, 'remote', true);
    if (snapshot.revision < knownServerRevision) await queueRemoteRefresh(knownServerRevision);
    setStatus('online');
  } catch (error) {
    setStatus('error', `无法载入服务器版本：${describeError(error)}`);
    throw error;
  }
}

export function workspaceEventTouchesKey(event: CustomEvent<WorkspaceUpdatedDetail>, key: string) {
  return event.detail.fullReplace || event.detail.changedKeys.includes(key);
}
