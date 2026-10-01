import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "../App";
import { createRectArea } from "../lib/area-utils";
import { createNewProject } from "../lib/project";
import { useStore } from "../store";

// Shortcut dispatch order, focus/dialog guards and view-consistent selection (#162).

function setup() {
  const project = createNewProject();
  const first = project.views[0]!;
  const area = createRectArea(10, 10, 40, 40);
  area.name = "First area";
  first.layers = [{ id: "layer_first", name: "Places", visible: true, locked: false, opacity: 1, areas: [area] }];
  const second = structuredClone(first);
  second.id = "view_second";
  second.slug = "second";
  second.name = "Second view";
  second.layers[0]!.id = "layer_second";
  second.layers[0]!.areas = [{ ...createRectArea(5, 5, 20, 20), id: "area_second", name: "Second area" }];
  project.views.push(second);
  useStore.setState({
    project,
    activeViewId: first.id,
    selectedAreaId: area.id,
    selectedAreaIds: [area.id],
    selectedLayerId: null,
    activeTool: "select",
    clipboardArea: null,
    screen: "design",
    past: [],
    future: [],
  });
  render(<App />);
  return { area, first, second };
}

const areaCount = () => useStore.getState().project.views[0]!.layers[0]!.areas.length;

afterEach(() => {
  // Unmount so earlier App instances do not keep their window listeners.
  cleanup();
  document.body.replaceChildren();
});

describe("editor shortcuts", () => {
  it("Ctrl/Cmd+C then V copies and pastes the area without changing the tool", () => {
    setup();
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const before = areaCount();
      const copy = fireEvent.keyDown(window, { key: "c", ...modifier });
      expect(copy).toBe(false); // handled: default prevented
      expect(useStore.getState().clipboardArea?.name).toMatch(/^First area/);
      fireEvent.keyDown(window, { key: "v", ...modifier });
      expect(areaCount()).toBe(before + 1);
      expect(useStore.getState().activeTool).toBe("select");
    }
  });

  it("keeps native copy when nothing is selected", () => {
    setup();
    act(() => useStore.setState({ selectedAreaId: null, selectedAreaIds: [] }));
    expect(fireEvent.keyDown(window, { key: "c", ctrlKey: true })).toBe(true);
    expect(useStore.getState().activeTool).toBe("select");
  });

  it("still switches tools with plain letters and runs undo/redo", () => {
    setup();
    const before = areaCount();
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(areaCount()).toBe(before + 1);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(areaCount()).toBe(before);
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(areaCount()).toBe(before + 1);
    fireEvent.keyDown(window, { key: "c" });
    expect(useStore.getState().activeTool).toBe("circle");
    fireEvent.keyDown(window, { key: "r" });
    expect(useStore.getState().activeTool).toBe("rect");
    // Alt-modified letters are not tool shortcuts.
    fireEvent.keyDown(window, { key: "v", altKey: true });
    expect(useStore.getState().activeTool).toBe("rect");
  });

  it("leaves keys in selects, editable content and buttons alone", () => {
    setup();
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const button = document.createElement("button");
    document.body.append(select, editable, button);

    fireEvent.keyDown(select, { key: "c" });
    fireEvent.keyDown(editable, { key: "r" });
    expect(useStore.getState().activeTool).toBe("select");
    // Space on a button activates it instead of starting a canvas pan.
    expect(fireEvent.keyDown(button, { key: " " })).toBe(true);
    // Space from the workspace still pans (default prevented).
    expect(fireEvent.keyDown(window, { key: " " })).toBe(false);
  });

  it("blocks editing shortcuts while a dialog is open", () => {
    setup();
    fireEvent.keyDown(document.body, { key: "?" });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    const before = areaCount();
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(useStore.getState().activeTool).toBe("select");
    expect(areaCount()).toBe(before);
    // "?" still closes the help it opened.
    fireEvent.keyDown(document.body, { key: "?" });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });
});

describe("hierarchy selection follows the owning view", () => {
  it("activates the view of a selected area or layer from another view", () => {
    const { first, second } = setup();
    useStore.getState().setSelectedAreaId("area_second");
    expect(useStore.getState().activeViewId).toBe(second.id);
    useStore.getState().setSelectedLayerId(first.layers[0]!.id);
    expect(useStore.getState().activeViewId).toBe(first.id);
    // A multi-selection never spans views.
    useStore.getState().setSelectedAreaIds([first.layers[0]!.areas[0]!.id, "area_second"]);
    expect(useStore.getState().activeViewId).toBe(second.id);
    expect(useStore.getState().selectedAreaIds).toEqual(["area_second"]);
  });
});
