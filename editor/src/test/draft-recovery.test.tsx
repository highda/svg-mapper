import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { createNewProject } from "../lib/project";
import { projectSnapshot, useStore } from "../store";

const draftMocks = vi.hoisted(() => ({
  readDraft: vi.fn(),
  writeDraft: vi.fn(),
  removeDraft: vi.fn(),
}));

vi.mock("../lib/draft-storage", () => draftMocks);

function resetProject() {
  const project = createNewProject();
  useStore.setState({
    project,
    savedSnapshot: projectSnapshot(project),
    activeViewId: project.views[0].id,
    screen: "design",
    past: [],
    future: [],
  });
}

describe("local draft protection", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    draftMocks.readDraft.mockResolvedValue(undefined);
    draftMocks.writeDraft.mockResolvedValue(undefined);
    draftMocks.removeDraft.mockResolvedValue(undefined);
    resetProject();
  });

  it("marks meaningful edits dirty and lets Cancel preserve them", async () => {
    render(<App />);
    await act(() => Promise.resolve());

    useStore.getState().setProjectName("My careful work");
    expect(await screen.findByText(/Unsaved changes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByRole("dialog", { name: "Save changes first?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useStore.getState().project.project.name).toBe("My careful work");
  });

  it("replaces a clean project immediately", async () => {
    render(<App />);
    await act(() => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.queryByRole("dialog", { name: "Save changes first?" })).not.toBeInTheDocument();
  });

  it("keeps dirty work when an opened file is invalid", async () => {
    render(<App />);
    await act(() => Promise.resolve());
    act(() => useStore.getState().setProjectName("Keep me"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["not json"], "broken.json", { type: "application/json" })] } });
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));

    expect(useStore.getState().project.project.name).toBe("Keep me");
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(/Unexpected token|not valid JSON/i);
  });

  it("restores a multi-view draft containing embedded image data", async () => {
    const draft = createNewProject("Recovered map");
    draft.views.push({ ...draft.views[0], id: "second-view", name: "Second view" });
    draft.assets.push({ id: "image", type: "image/png", name: "Map", src: "data:image/png;base64,AAAA", width: 1, height: 1, inline: true });
    draftMocks.readDraft.mockResolvedValue({ project: draft, savedAt: "2026-09-06T00:00:00.000Z" });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore draft" }));

    expect(useStore.getState().project.views).toHaveLength(2);
    expect(useStore.getState().project.assets[0].src).toContain("data:image/png");
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
  });

  it("reports quota failures without claiming recovery succeeded", async () => {
    draftMocks.writeDraft.mockRejectedValue(new DOMException("Quota exceeded", "QuotaExceededError"));
    render(<App />);
    await act(() => Promise.resolve());
    act(() => useStore.getState().setProjectName("Large image project"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Quota exceeded"), { timeout: 1500 });
    expect(screen.getByRole("alert")).toHaveTextContent("Download the project");
  });
});
