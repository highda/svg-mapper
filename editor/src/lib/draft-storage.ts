import type { ProjectFile } from "@svg-mapper/shared";

const DATABASE = "svg-mapper";
const STORE = "drafts";
const KEY = "current";

export interface StoredDraft {
  project: ProjectFile;
  savedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("Local draft storage is unavailable in this browser."));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local draft storage."));
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error ?? new Error("Local draft operation failed."));
    tx.oncomplete = () => {
      database.close();
      resolve(result);
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error ?? new Error("Local draft operation failed."));
    };
  });
}

export function readDraft(): Promise<StoredDraft | undefined> {
  return transaction("readonly", (store) => store.get(KEY));
}

export function writeDraft(project: ProjectFile): Promise<void> {
  const draft: StoredDraft = { project, savedAt: new Date().toISOString() };
  return transaction("readwrite", (store) => store.put(draft, KEY)).then(() => undefined);
}

export function removeDraft(): Promise<void> {
  return transaction("readwrite", (store) => store.delete(KEY)).then(() => undefined);
}
