import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createNewProject } from "../lib/project";

// Storage operations run strictly in call order; stored records are decoded before use (#166).

const idb = vi.hoisted(() => ({
  log: [] as string[],
  value: undefined as unknown,
  gates: [] as Array<() => void>,
}));

vi.mock("idb-keyval", () => {
  // Each operation waits for its gate, so tests control completion order.
  const gated = <T>(name: string, run: () => T) => new Promise<T>((resolve) => {
    idb.log.push(`start ${name}`);
    idb.gates.push(() => { idb.log.push(`end ${name}`); resolve(run()); });
  });
  return {
    createStore: () => "store",
    get: () => gated("get", () => idb.value),
    set: (_key: string, value: unknown) => gated("set", () => { idb.value = value; }),
    del: () => gated("del", () => { idb.value = undefined; }),
  };
});

const { readDraft, writeDraft, removeDraft, decodeDraft, CorruptDraftError } = await import("../lib/draft-storage");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB ??= {};
});

beforeEach(() => {
  idb.log = [];
  idb.value = undefined;
  idb.gates = [];
});

describe("draft storage", () => {
  it("does not start a removal until an earlier write has finished", async () => {
    const write = writeDraft(createNewProject("A"));
    const remove = removeDraft();
    await flush();
    expect(idb.log).toEqual(["start set"]);
    idb.gates.shift()!();
    await write;
    await flush();
    expect(idb.log).toEqual(["start set", "end set", "start del"]);
    idb.gates.shift()!();
    await remove;
    expect(idb.value).toBeUndefined(); // the old write cannot resurrect the draft
  });

  it("keeps running after a failed operation", async () => {
    const write = writeDraft(createNewProject("A"));
    const read = readDraft();
    await flush();
    idb.gates.shift()!();
    await write;
    await flush();
    idb.gates.shift()!();
    expect((await read)?.project.project.name).toBe("A");
  });

  it("decodes valid drafts and rejects malformed records without deleting them", async () => {
    const project = createNewProject("Valid");
    expect(decodeDraft({ project, savedAt: "2026-10-05T00:00:00.000Z" }).project.project.name).toBe("Valid");
    for (const bad of [null, "text", { project, savedAt: "never" }, { project: { schemaVersion: "9" }, savedAt: "2026-10-05T00:00:00.000Z" }]) {
      expect(() => decodeDraft(bad)).toThrow(CorruptDraftError);
    }

    idb.value = { project: { views: "broken" }, savedAt: "2026-10-05T00:00:00.000Z" };
    const read = readDraft();
    await flush();
    idb.gates.shift()!();
    await expect(read).rejects.toBeInstanceOf(CorruptDraftError);
    expect(idb.value).toBeDefined();
  });
});
