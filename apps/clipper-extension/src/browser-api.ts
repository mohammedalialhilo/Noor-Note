function checked<T>(value: T, resolve: (value: T) => void, reject: (reason: Error) => void): void {
  const error = chrome.runtime.lastError;
  if (error) reject(new Error(error.message)); else resolve(value);
}
export const browserApi = {
  activeTab: () => new Promise<chrome.tabs.Tab>((resolve, reject) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) { reject(new Error('Open a page to clip first.')); return; }
    checked(tab, resolve, reject);
  })),
  inject: (tabId: number, file: string) => new Promise<void>((resolve, reject) => chrome.scripting.executeScript({ target: { tabId }, files: [file] }, () => checked(undefined, resolve, reject))),
  messageTab: <T>(tabId: number, message: unknown) => new Promise<T>((resolve, reject) => chrome.tabs.sendMessage(tabId, message, (value: T) => checked(value, resolve, reject))),
  messageRuntime: <T>(message: unknown) => new Promise<T>((resolve, reject) => chrome.runtime.sendMessage(message, (value: T) => checked(value, resolve, reject))),
  get: <T>(key: string) => new Promise<T | undefined>((resolve, reject) => chrome.storage.local.get(key, (result) => checked(result[key] as T | undefined, resolve, reject))),
  all: () => new Promise<Record<string, unknown>>((resolve, reject) => chrome.storage.local.get(null, (result) => checked(result, resolve, reject))),
  set: (key: string, value: unknown) => new Promise<void>((resolve, reject) => chrome.storage.local.set({ [key]: value }, () => checked(undefined, resolve, reject))),
  remove: (key: string) => new Promise<void>((resolve, reject) => chrome.storage.local.remove(key, () => checked(undefined, resolve, reject))),
  removeMany: (keys: string[]) => new Promise<void>((resolve, reject) => chrome.storage.local.remove(keys, () => checked(undefined, resolve, reject))),
  createTab: (url: string) => new Promise<chrome.tabs.Tab>((resolve, reject) => chrome.tabs.create({ url }, (tab) => checked(tab, resolve, reject))),
  permission: (origin: string) => new Promise<boolean>((resolve, reject) => chrome.permissions.request({ origins: [origin] }, (granted) => checked(granted, resolve, reject))),
  captureVisible: (windowId?: number) => new Promise<string>((resolve, reject) => {
    const callback = (dataUrl: string) => checked(dataUrl, resolve, reject);
    if (windowId === undefined) chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 72 }, callback);
    else chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 72 }, callback);
  }),
};
