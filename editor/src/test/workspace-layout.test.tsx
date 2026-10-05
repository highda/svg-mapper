import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../App";
import { createNewProject, toDefinition } from "../lib/project";
import { createRectArea } from "../lib/area-utils";
import { projectSnapshot, useStore } from "../store";
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, loadLayoutPrefs, SECTIONS_STORAGE_KEY, useLayoutPrefs } from "../store/layout-prefs";

// Desktop workspace preferences and inspector hierarchy (#156).

function resetStores() {
  localStorage.clear();
  useLayoutPrefs.setState({ ...structuredClone(DEFAULT_LAYOUT), sections: {}, layoutRequest: 0 });
  const project = createNewProject();
  useStore.setState({
    project,
    activeViewId: project.views[0].id,
    selectedAreaId: null,
    selectedAreaIds: [],
    selectedLayerId: null,
    screen: "design",
    past: [],
    future: [],
    savedSnapshot: projectSnapshot(project),
  });
}

describe("layout preferences", () => {
  beforeEach(resetStores);
  afterEach(() => vi.restoreAllMocks());

  it("clamps stored widths and ignores unreadable values", () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ tree: { size: 5, collapsed: true }, inspector: { size: "wide" } }));
    expect(loadLayoutPrefs()).toEqual({ tree: { size: 180, collapsed: true }, inspector: { size: 304, collapsed: false } });
    localStorage.setItem(LAYOUT_STORAGE_KEY, "{not json");
    expect(loadLayoutPrefs()).toEqual(DEFAULT_LAYOUT);
  });

  it("keeps working when browser storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadLayoutPrefs()).toEqual(DEFAULT_LAYOUT);
    useLayoutPrefs.getState().toggleCollapsed("inspector");
    useLayoutPrefs.getState().setSectionOpen("area.metadata", true);
    expect(useLayoutPrefs.getState().inspector.collapsed).toBe(true);
    expect(useLayoutPrefs.getState().sections["area.metadata"]).toBe(true);
  });

  it("persists outside the project, its history and its export", () => {
    const before = useStore.getState();
    const state = useLayoutPrefs.getState();
    state.recordPanel("tree", { size: 300 });
    state.toggleCollapsed("inspector");
    state.setSectionOpen("view.css", true);

    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}")).toEqual({ tree: { size: 300, collapsed: false }, inspector: { size: 304, collapsed: true } });
    expect(JSON.parse(localStorage.getItem(SECTIONS_STORAGE_KEY) ?? "{}")).toEqual({ "view.css": true });
    const after = useStore.getState();
    expect(after.project).toBe(before.project);
    expect(after.past).toHaveLength(0);
    expect(JSON.stringify(toDefinition(after.project))).not.toMatch(/collapsed|view\.css|layout/);

    state.resetLayout();
    expect(useLayoutPrefs.getState()).toMatchObject({ ...DEFAULT_LAYOUT, sections: {} });
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}")).toEqual(DEFAULT_LAYOUT);
  });
});

describe("docked desktop workspace", () => {
  beforeEach(resetStores);

  it("labels its keyboard separators and offers show, hide and reset controls", () => {
    render(<App />);
    expect(screen.getByRole("separator", { name: "Resize views and layers panel" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("separator", { name: "Resize inspector panel" })).toHaveAttribute("tabindex", "0");

    const layout = screen.getByRole("group", { name: "Workspace layout" });
    const inspectorToggle = within(layout).getByRole("button", { name: "Inspector panel" });
    expect(inspectorToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Hide inspector panel" }));
    expect(inspectorToggle).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector('[data-panel-content="inspector"]')).toHaveAttribute("inert");
    // Collapsed content stays mounted, so drafts and scroll positions survive.
    expect(screen.getByRole("complementary", { name: "Inspector", hidden: true })).toBeInTheDocument();

    fireEvent.click(inspectorToggle);
    expect(document.querySelector('[data-panel-content="inspector"]')).not.toHaveAttribute("inert");
    fireEvent.click(within(layout).getByRole("button", { name: "Tree panel" }));
    expect(document.querySelector('[data-panel-content="tree"]')).toHaveAttribute("inert");
    fireEvent.click(within(layout).getByRole("button", { name: "Reset layout" }));
    expect(document.querySelector('[data-panel-content="tree"]')).not.toHaveAttribute("inert");
  });

  it("keeps area rows free of action controls and leads the inspector with basics and action", () => {
    const area = createRectArea(0, 0, 20, 20);
    area.name = "A rather long reception desk name";
    area.metadata = { floor: "1" };
    useStore.getState().addArea(area);
    useStore.getState().setSelectedAreaId(area.id);
    render(<App />);

    const row = screen.getByRole("treeitem", { name: /A rather long reception desk name/ });
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    expect(within(row).queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.getByRole("region", { name: "Arrange A rather long reception desk name" })).toBeInTheDocument();

    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    const titles = within(inspector).getAllByRole("heading", { level: 3 }).map((heading) => (heading.textContent ?? "").replace("▶", ""));
    const index = (title: string) => titles.findIndex((text) => text.startsWith(title));
    expect(index("Basics")).toBe(0);
    expect(index("Action")).toBe(1);
    expect(index("Details")).toBe(2);
    expect(index("Geometry")).toBeLessThan(index("Style"));
    expect(index("Style")).toBeLessThan(index("Metadata"));

    // Advanced and less-used sections are collapsed but every field still exists.
    const metadata = within(inspector).getByRole("button", { name: /^Metadata/ });
    expect(metadata).toHaveAttribute("aria-expanded", "false");
    expect(metadata).toHaveTextContent("Advanced");
    expect(screen.getByLabelText("Metadata value floor")).not.toBeVisible();
    fireEvent.click(metadata);
    expect(screen.getByLabelText("Metadata value floor")).toBeVisible();
    expect(useLayoutPrefs.getState().sections["area.metadata"]).toBe(true);

    const states = within(inspector).getByRole("button", { name: /^Hover, active, disabled/ });
    expect(states).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Hover fill CSS color")).toBeInTheDocument();
  });
});
