const hasExtensionApi = typeof chrome !== 'undefined' && Boolean(chrome.storage?.local && chrome.tabs && chrome.scripting);

const previewStore: Record<string, unknown> = {};

export async function storageGet(keys: string[]) {
  if (hasExtensionApi) return chrome.storage.local.get(keys);
  return Object.fromEntries(keys.map((key) => [key, previewStore[key]]));
}

export async function storageSet(values: Record<string, unknown>) {
  if (hasExtensionApi) return chrome.storage.local.set(values);
  Object.assign(previewStore, values);
}

export async function queryActiveTab(): Promise<{ id?: number; url?: string }> {
  if (hasExtensionApi) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || {};
  }
  return { id: 1, url: 'https://jobs.example.com/campus/apply' };
}

export async function sendToTab<T>(tabId: number, payload: object): Promise<T> {
  if (hasExtensionApi) {
    // `activeTab` grants temporary access only after the user opens the popup.
    // Inject on demand so the extension never runs persistently across sites.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tabId, payload) as Promise<T>;
  }
  if ('type' in payload && payload.type === 'SCAN_FORM') {
    return { ok: true, total: 12, matched: 8, fields: [] } as T;
  }
  return { ok: true, total: 12, matched: 8, filled: 8, skipped: 4, fields: [] } as T;
}
