import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Action, Area } from "@svg-mapper/shared";
import { App } from "../App";
import { RightSidebar } from "../components/layout/RightSidebar";
import { ExportScreen } from "../screens/ExportScreen";
import { createRectArea } from "../lib/area-utils";
import { createNewProject } from "../lib/project";
import { projectSnapshot, useStore } from "../store";

// Labelled inspector fields, the accessibility editor and modal dialog
// keyboard semantics (#174).

const draftMocks = vi.hoisted(() => ({
  readDraft: vi.fn(),
  writeDraft: vi.fn(),
  removeDraft: vi.fn(),
}));

vi.mock("../lib/draft-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/draft-storage")>()),
  ...draftMocks,
}));

beforeEach(() => {
  vi.clearAllMocks();
  draftMocks.readDraft.mockResolvedValue(undefined);
  draftMocks.writeDraft.mockResolvedValue(undefined);
  draftMocks.removeDraft.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function setup(mutate?: (area: Area) => void, selected = true) {
  const project = createNewProject();
  const area: Area = { ...createRectArea(10, 10, 40, 40), id: "area_a", name: "Cafe" };
  mutate?.(area);
  project.views[0]!.layers = [{ id: "layer_a", name: "Places", visible: true, locked: false, opacity: 1, areas: [area] }];
  useStore.setState({
    project,
    savedSnapshot: projectSnapshot(project),
    activeViewId: project.views[0]!.id,
    selectedAreaId: selected ? area.id : null,
    selectedAreaIds: selected ? [area.id] : [],
    selectedLayerId: null,
    activeTool: "select",
    screen: "design",
    past: [],
    future: [],
  });
  return project;
}

const storedArea = () => useStore.getState().project.views[0]!.layers[0]!.areas[0]!;

function expectNamedFields() {
  const inspector = screen.getByRole("complementary", { name: "Inspector" });
  const fields = Array.from(inspector.querySelectorAll<HTMLElement>("input, select, textarea"));
  expect(fields.length).toBeGreaterThan(0);
  for (const field of fields) expect(field, field.outerHTML.slice(0, 120)).toHaveAccessibleName();
}

describe("inspector field names", () => {
  const actions: Action[] = [
    { type: "none" },
    { type: "url", href: "https://example.com", target: "_blank" },
    { type: "popup", content: { title: "Hi" }, position: "auto" },
    { type: "goToView", targetViewId: "x", transition: "fade" },
    { type: "toggleLayer", targetLayerId: "layer_a" },
    { type: "customEvent", eventName: "map:go" },
  ];

  it.each(actions.map((action) => [action.type, action] as const))("names every area field with a %s action", (_type, action) => {
    setup((area) => {
      area.action = action;
      area.tooltip = { enabled: true, title: "T", body: "B" };
      area.metadata = { floor: "1" };
    });
    render(<RightSidebar />);
    expectNamedFields();
  });

  it("names every view and layer field", () => {
    setup(undefined, false);
    render(<RightSidebar />);
    expectNamedFields();
    cleanup();
    act(() => useStore.setState({ selectedLayerId: "layer_a" }));
    render(<RightSidebar />);
    expectNamedFields();
  });

  it("uses the visible row label as the field name", () => {
    setup((area) => { area.action = { type: "url", href: "", target: "_blank" }; });
    render(<RightSidebar />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Cafe");
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue("url");
    expect(screen.getByRole("combobox", { name: "Trigger" })).toHaveValue("both");
    expect(screen.getByRole("spinbutton", { name: "X" })).toHaveValue(10);
  });

  it("ties an invalid URL to its visible error", () => {
    setup((area) => { area.action = { type: "url", href: "", target: "_blank" }; });
    render(<RightSidebar />);
    const url = screen.getByRole("textbox", { name: "URL" });
    fireEvent.change(url, { target: { value: "javascript:alert(1)" } });
    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(url).toHaveAccessibleDescription(/./);
    const errorId = url.getAttribute("aria-describedby")!;
    expect(document.getElementById(errorId)).toBeVisible();
  });

  it("ties an invalid custom-event payload to its error", () => {
    setup((area) => { area.action = { type: "customEvent", eventName: "map:go" }; });
    render(<RightSidebar />);
    const payload = screen.getByRole("textbox", { name: "Custom event JSON payload" });
    fireEvent.change(payload, { target: { value: "{" } });
    expect(payload).toHaveAccessibleDescription("Enter valid JSON before leaving this field.");
  });
});

describe("area accessibility editor", () => {
  it("sets, previews and clears the accessible name", () => {
    setup();
    render(<RightSidebar />);
    const field = screen.getByRole("textbox", { name: "Accessible name" });
    expect(field).toHaveAccessibleDescription(/announce “Cafe”/);
    fireEvent.change(field, { target: { value: "  Cafe, ground floor  " } });
    fireEvent.blur(field);
    expect(storedArea().accessibility).toEqual({ ariaLabel: "Cafe, ground floor", tabIndex: 0 });
    expect(screen.getByRole("textbox", { name: "Accessible name" })).toHaveAccessibleDescription(/announce “Cafe, ground floor”/);

    const cleared = screen.getByRole("textbox", { name: "Accessible name" });
    fireEvent.change(cleared, { target: { value: "" } });
    fireEvent.blur(cleared);
    expect(storedArea().accessibility).toBeUndefined();
  });

  it("removes an area from the Tab order without raw tabindex numbers", () => {
    setup();
    render(<RightSidebar />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Skip when pressing Tab" }));
    expect(storedArea().accessibility).toEqual({ ariaLabel: "", tabIndex: -1 });
    fireEvent.click(screen.getByRole("checkbox", { name: "Skip when pressing Tab" }));
    expect(storedArea().accessibility).toBeUndefined();
  });
});

describe("modal dialogs", () => {
  it("help: focus moves in, Tab stays inside, Escape closes and restores focus", async () => {
    setup();
    const user = userEvent.setup();
    render(<App />);
    await act(() => Promise.resolve());
    const opener = screen.getByRole("button", { name: "Samples" });
    opener.focus();
    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/Shortcuts work/);
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Editing shortcuts stay off behind the dialog.
    await user.keyboard("r");
    expect(useStore.getState().activeTool).toBe("select");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("replace: Escape cancels without touching unsaved work", async () => {
    setup();
    const user = userEvent.setup();
    render(<App />);
    await act(() => Promise.resolve());
    act(() => useStore.getState().setProjectName("Unsaved work"));
    const newButton = screen.getByRole("button", { name: "New" });
    await user.click(newButton);
    const dialog = screen.getByRole("dialog", { name: "Save changes first?" });
    expect(dialog).toHaveAccessibleDescription(/replace the current project/);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useStore.getState().project.project.name).toBe("Unsaved work");
    await waitFor(() => expect(document.activeElement).toBe(newButton));
  });

  it("samples → replace: focus returns to Samples when the opener is gone", async () => {
    setup();
    const user = userEvent.setup();
    render(<App />);
    await act(() => Promise.resolve());
    act(() => useStore.getState().setProjectName("Unsaved work"));
    const samples = screen.getByRole("button", { name: "Samples" });
    await user.click(samples);
    expect(screen.getByRole("dialog", { name: "Start a map" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Blank map/ }));
    expect(screen.getByRole("dialog", { name: "Save changes first?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(samples));
    expect(useStore.getState().project.project.name).toBe("Unsaved work");
  });

  it("recovery: requires an explicit choice", async () => {
    const draft = createNewProject("Recovered map");
    draftMocks.readDraft.mockResolvedValue({ project: draft, savedAt: "2026-09-06T00:00:00.000Z" });
    setup();
    const user = userEvent.setup();
    render(<App />);
    const dialog = await screen.findByRole("dialog", { name: "Recover local draft?" });
    expect(dialog).toHaveAccessibleDescription(/Recovered map/);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Restore draft" })));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Recover local draft?" })).toBeInTheDocument();
    // Background shortcuts cannot replace or export the project meanwhile.
    await user.keyboard("{Control>}e{/Control}");
    expect(useStore.getState().screen).toBe("design");
    await user.click(screen.getByRole("button", { name: "Restore draft" }));
    expect(useStore.getState().project.project.name).toBe("Recovered map");
  });

  it("export warnings: Escape cancels and focus returns to Download ZIP", async () => {
    setup(); // an area without an action is a warning, not an error
    const user = userEvent.setup();
    render(<ExportScreen />);
    const download = screen.getByRole("button", { name: "Download ZIP" });
    await user.click(download);
    const dialog = screen.getByRole("dialog", { name: "Export with warnings?" });
    expect(dialog).toHaveAccessibleDescription(/1 warning/);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Export anyway" }));
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(download));
  });
});
