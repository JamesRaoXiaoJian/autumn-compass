import { useEffect, useState } from 'react';
import {
  setWorkspaceItem,
  workspaceEventTouchesKey,
  workspaceUpdatedEvent,
} from '../lib/workspaceSync';

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = window.localStorage.getItem(key);
      return saved ? (JSON.parse(saved) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    void setWorkspaceItem(key, JSON.stringify(value));
  }, [key, value]);

  useEffect(() => {
    const handleWorkspaceUpdate = (event: CustomEvent) => {
      if (!workspaceEventTouchesKey(event, key)) return;
      try {
        const saved = window.localStorage.getItem(key);
        setValue(saved === null ? initialValue : JSON.parse(saved) as T);
      } catch {
        setValue(initialValue);
      }
    };
    window.addEventListener(workspaceUpdatedEvent, handleWorkspaceUpdate);
    return () => window.removeEventListener(workspaceUpdatedEvent, handleWorkspaceUpdate);
  }, [initialValue, key]);

  return [value, setValue] as const;
}
