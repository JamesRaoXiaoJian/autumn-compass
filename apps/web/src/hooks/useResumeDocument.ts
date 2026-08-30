import { useEffect, useState } from 'react';
import {
  setWorkspaceItem,
  workspaceEventTouchesKey,
  workspaceUpdatedEvent,
} from '../lib/workspaceSync';
import type { ResumeDocument, ResumeProfile } from '../types';

const storageKey = 'autumn-compass-resume-document-v4';
const previousStorageKey = 'autumn-compass-resume-document-v3';
const legacyProfileKey = 'autumn-compass-profile-v2';
const databaseName = 'autumn-compass';
const storeName = 'resume_documents';

export type ResumeStorageStatus = 'loading' | 'saved' | 'error';

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeDatabaseBackup(document: ResumeDocument) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(document, 'active');
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

function readLocalDocument(initialDocument: ResumeDocument) {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved) as ResumeDocument;
      return { ...initialDocument, ...parsed, profile: { ...initialDocument.profile, ...parsed.profile } };
    }
    const previous = window.localStorage.getItem(previousStorageKey);
    if (previous) {
      const parsed = JSON.parse(previous) as ResumeDocument;
      return { ...initialDocument, ...parsed, version: initialDocument.version, profile: { ...initialDocument.profile, ...parsed.profile } };
    }
    const legacyProfile = window.localStorage.getItem(legacyProfileKey);
    if (!legacyProfile) return initialDocument;
    return {
      ...initialDocument,
      profile: { ...initialDocument.profile, ...(JSON.parse(legacyProfile) as Partial<ResumeProfile>) },
    };
  } catch {
    return initialDocument;
  }
}

export function useResumeDocument(initialDocument: ResumeDocument) {
  const [document, setDocument] = useState<ResumeDocument>(() => readLocalDocument(initialDocument));
  const [storageStatus, setStorageStatus] = useState<ResumeStorageStatus>('saved');

  useEffect(() => {
    setStorageStatus('loading');
    const timer = window.setTimeout(() => {
      Promise.all([
        setWorkspaceItem(storageKey, JSON.stringify(document)),
        writeDatabaseBackup(document),
      ])
        .then(() => setStorageStatus('saved'))
        .catch(() => setStorageStatus('error'));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [document]);

  useEffect(() => {
    const handleWorkspaceUpdate = (event: CustomEvent) => {
      if (!workspaceEventTouchesKey(event, storageKey)) return;
      setDocument(readLocalDocument(initialDocument));
    };
    window.addEventListener(workspaceUpdatedEvent, handleWorkspaceUpdate);
    return () => window.removeEventListener(workspaceUpdatedEvent, handleWorkspaceUpdate);
  }, [initialDocument]);

  return [document, setDocument, storageStatus] as const;
}
