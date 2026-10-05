import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { createNewProject } from "../lib/project";
import { projectSnapshot, useStore } from "../store";

// Recovery status follows the exact durably written revision (#166).

const storage = vi.hoisted(() => ({
  readDraft: vi.fn(),
  writeDraft: vi.fn(),
  removeDraft: vi.fn(),
}));

vi.mock("../lib/draft-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/draft-storage")>()),
  ...storage,
}));

const { CorruptDraftError } = await import("../lib/draft-storage");

/** A write the test completes explicitly. */
function deferredWrite() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  storage.writeDraft.mockImplementationOnce(() => promise);
  return {
    resolve: () => act(async () => { resolve(); await settle(); }),
    reject: (error: unknown) => act(async () => { reject(error); await settle(); }),
  };
}

/** Let promise chains (then/catch/finally) run to completion. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function resetProject() {
  const project = createNewProject("Original");
  useStore.setState({ project, savedSnapshot: projectSnapshot(project), activeViewId: project.views[0]!.id, screen: "design", past: [], future: [] });
  return project;
}

async function mount() {
  render(<App />);
  await act(async () => { await settle(); });
}

function unloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

const status = () => screen.getByText(/Unsaved changes|Downloaded version/).textContent;
const rename = (name: string) => act(() => useStore.getState().setProjectName(name));
const tick = (ms = 500) => act(async () => { vi.advanceTimersByTime(ms); await settle(); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  for (const mock of Object.values(storage)) mock.mockReset();
  storage.readDraft.mockResolvedValue(undefined);
  storage.writeDraft.mockResolvedValue(undefined);
  storage.removeDraft.mockResolvedValue(undefined);
  resetProject();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("draft revision tracking", () => {
  it("debounces edits into one write and protects a second edit right after it", async () => {
    await mount();
    rename("A");
    await tick(200);
    rename("AB");
    const write = deferredWrite();
    await tick();
    expect(storage.writeDraft).toHaveBeenCalledTimes(1);
    expect(status()).toMatch(/saving draft/);
    expect(unloadPrevented()).toBe(true);

    await write.resolve();
    expect(status()).toMatch(/local draft saved/);
    expect(unloadPrevented()).toBe(false);

    // A second edit is pending at once, before any timer fires.
    rename("ABC");
    expect(status()).not.toMatch(/local draft saved/);
    expect(unloadPrevented()).toBe(true);
    await tick();
    expect(status()).toMatch(/local draft saved/);
  });

  it("protects an edit made in the same task as unload, before React re-renders", async () => {
    await mount();
    rename("A");
    await tick();
    expect(unloadPrevented()).toBe(false);
    useStore.getState().setProjectName("B"); // no act(): unload fires before any render
    expect(unloadPrevented()).toBe(true);
    await act(async () => {});
  });

  it("ignores a write that completes after the project was replaced", async () => {
    const original = resetProject();
    await mount();
    rename("Edited");
    const editedSnapshot = projectSnapshot(useStore.getState().project);
    const stale = deferredWrite();
    await tick();

    // Replace the document with a clean copy of the original; the draft is removed.
    act(() => useStore.getState().loadProject(JSON.stringify(original)));
    await act(async () => { await Promise.resolve(); });
    expect(storage.removeDraft).toHaveBeenCalled();
    await stale.resolve();

    // Same content as the stale write, but nothing durable backs it now.
    storage.writeDraft.mockImplementationOnce(() => new Promise(() => {}));
    rename("Edited");
    expect(projectSnapshot(useStore.getState().project)).toBe(editedSnapshot);
    expect(status()).not.toMatch(/local draft saved/);
    expect(unloadPrevented()).toBe(true);
  });

  it("reports a quota failure and recovers on the next edit", async () => {
    await mount();
    rename("A");
    const failing = deferredWrite();
    await tick();
    await failing.reject(new DOMException("Quota exceeded", "QuotaExceededError"));
    expect(status()).toMatch(/draft failed/);
    expect(screen.getByRole("alert")).toHaveTextContent(/Quota exceeded/);
    expect(unloadPrevented()).toBe(true);

    rename("AB");
    await tick();
    expect(status()).toMatch(/local draft saved/);
    expect(screen.queryByText(/Quota exceeded/)).toBeNull();
  });

  it("keeps a corrupt stored draft until it is discarded, without crashing", async () => {
    storage.readDraft.mockRejectedValue(new CorruptDraftError("$.views: expected array"));
    await mount();
    expect(screen.getByText(/stored draft could not be read/)).toBeInTheDocument();
    expect(storage.removeDraft).not.toHaveBeenCalled();

    rename("New work");
    await tick();
    expect(storage.writeDraft).not.toHaveBeenCalled();
    expect(unloadPrevented()).toBe(true);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Discard stored draft" })));
    expect(storage.removeDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/stored draft could not be read/)).toBeNull();
    await tick();
    expect(storage.writeDraft).toHaveBeenCalledTimes(1);
    expect(status()).toMatch(/local draft saved/);
  });
});
