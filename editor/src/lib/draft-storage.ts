import { createStore, del, get, set, type UseStore } from "idb-keyval";
import type { ProjectFile } from "@svg-mapper/shared";
import { assertProjectFile, dropRetiredFields } from "./project";

// One local recovery draft: database "svg-mapper", store "drafts", key "current".
const DATABASE = "svg-mapper";
const STORE = "drafts";
const KEY = "current";

export interface StoredDraft {
  project: ProjectFile;
  savedAt: string;
}

/** A stored record exists but is not a readable draft. It is left in place until discarded. */
export class CorruptDraftError extends Error {
  constructor(detail: string) {
    super(`The stored draft could not be read (${detail}).`);
    this.name = "CorruptDraftError";
  }
}

let store: UseStore | undefined;
function draftStore(): UseStore {
  if (!globalThis.indexedDB) throw new Error("Local draft storage is unavailable in this browser.");
  store ??= createStore(DATABASE, STORE);
  return store;
}

// Every read, write and removal runs in call order, so an older write can
// never land after a later removal or write (#166).
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}

/** Structural check of a stored record; throws CorruptDraftError when it cannot be restored. */
export function decodeDraft(value: unknown): StoredDraft {
  if (typeof value !== "object" || value === null) throw new CorruptDraftError("not an object");
  const record = value as { project?: unknown; savedAt?: unknown };
  if (typeof record.savedAt !== "string" || Number.isNaN(Date.parse(record.savedAt))) {
    throw new CorruptDraftError("missing save time");
  }
  try {
    assertProjectFile(record.project);
  } catch (cause) {
    throw new CorruptDraftError(cause instanceof Error ? cause.message : "invalid project");
  }
  return { project: dropRetiredFields(record.project), savedAt: record.savedAt };
}

export function readDraft(): Promise<StoredDraft | undefined> {
  return serialized(async () => {
    const value: unknown = await get(KEY, draftStore());
    return value === undefined ? undefined : decodeDraft(value);
  });
}

export function writeDraft(project: ProjectFile): Promise<void> {
  const draft: StoredDraft = { project, savedAt: new Date().toISOString() };
  return serialized(() => set(KEY, draft, draftStore()));
}

export function removeDraft(): Promise<void> {
  return serialized(() => del(KEY, draftStore()));
}
