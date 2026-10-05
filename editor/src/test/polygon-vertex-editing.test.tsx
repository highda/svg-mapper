import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Area } from "@svg-mapper/shared";
import { App } from "../App";
import { createPolygonArea } from "../lib/area-utils";
import { createNewProject, parseProjectFile, serializeProjectFile, toDefinition } from "../lib/project";
import { useStore } from "../store";
import { useVertexSelection } from "../store/vertex-selection";
import { create, __setInlinedCSS } from "../../../renderer/src/renderer";

// Drawn polygons are editable point by point without redrawing them (#176).

beforeAll(() => {
  // jsdom has no pointer capture or ResizeObserver.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const SQUARE: [number, number][] = [[100, 100], [200, 100], [200, 200], [100, 200]];

function polygon(points: [number, number][] = SQUARE): Area {
  return {
    ...createPolygonArea(points.map((p) => [...p] as [number, number])),
    id: "poly",
    name: "Lobby",
    action: { type: "url", href: "https://example.test/lobby", target: "_blank" },
    tooltip: { enabled: true, title: "Lobby" },
    metadata: { floor: 1 },
  };
}

function setup(area: Area = polygon(), options: { locked?: boolean; grid?: boolean } = {}) {
  const project = createNewProject();
  const view = project.views[0]!;
  view.layers = [{ id: "layer_main", name: "Places", visible: true, locked: options.locked ?? false, opacity: 1, areas: [area] }];
  project.editor = { zoom: 1, pan: { x: 0, y: 0 }, grid: { enabled: options.grid ?? false, size: 10 }, guides: [], history: [] };
  useVertexSelection.getState().clear();
  useStore.setState({
    project,
    activeViewId: view.id,
    selectedAreaId: area.id,
    selectedAreaIds: [area.id],
    selectedLayerId: null,
    activeTool: "select",
    screen: "design",
    lockNotice: null,
    past: [],
    future: [],
  });
  const { container } = render(<App />);
  const svg = container.querySelector<SVGSVGElement>("svg[tabindex]")!;
  return { container, svg };
}

const current = () => useStore.getState().project.views[0]!.layers[0]!.areas[0]!;
const points = () => (current().geometry as { points: [number, number][] }).points;
const history = () => useStore.getState().past.length;
const vertex = (container: Element, index: number) => container.querySelector(`[data-testid="vertex-handle"][data-vertex-index="${index}"]`)!;
const midpoint = (container: Element, edge: number) => container.querySelector(`[data-testid="vertex-insert-handle"][data-edge-index="${edge}"]`)!;

function drag(start: Element, svg: Element, from: [number, number], to: [number, number], finish: "up" | "escape" = "up") {
  fireEvent.pointerDown(start, { clientX: from[0], clientY: from[1], pointerId: 1, button: 0 });
  fireEvent.pointerMove(svg, { clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2, pointerId: 1 });
  fireEvent.pointerMove(svg, { clientX: to[0], clientY: to[1], pointerId: 1 });
  if (finish === "up") fireEvent.pointerUp(svg, { clientX: to[0], clientY: to[1], pointerId: 1 });
  else fireEvent.keyDown(window, { key: "Escape" });
}

describe("polygon vertex editing on the canvas", () => {
  it("drags one vertex as one undo entry and keeps everything else about the area", () => {
    const { container, svg } = setup();
    const before = current();
    drag(vertex(container, 2), svg, [200, 200], [237, 251]);
    expect(points()).toEqual([[100, 100], [200, 100], [237, 251], [100, 200]]);
    expect(history()).toBe(1);
    const after = current();
    expect(after.id).toBe("poly");
    expect(after.name).toBe("Lobby");
    expect(after.action).toEqual(before.action);
    expect(after.style).toEqual(before.style);
    expect(after.tooltip).toEqual(before.tooltip);
    expect(after.metadata).toEqual(before.metadata);

    act(() => useStore.getState().undo());
    expect(points()).toEqual(SQUARE);
    act(() => useStore.getState().redo());
    expect(points()).toEqual([[100, 100], [200, 100], [237, 251], [100, 200]]);
  });

  it("previews during the drag and Escape restores the vertex without history", () => {
    const { container, svg } = setup();
    fireEvent.pointerDown(vertex(container, 0), { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(svg, { clientX: 60, clientY: 70, pointerId: 1 });
    expect(points()[0]).toEqual([60, 70]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(points()).toEqual(SQUARE);
    expect(history()).toBe(0);
  });

  it("snaps a dragged vertex to the grid", () => {
    const { container, svg } = setup(polygon(), { grid: true });
    drag(vertex(container, 1), svg, [200, 100], [233, 87]);
    expect(points()[1]).toEqual([230, 90]);
  });

  it("picks a vertex on a plain click without creating history", () => {
    const { container, svg } = setup();
    drag(vertex(container, 3), svg, [100, 200], [101, 201]);
    expect(points()).toEqual(SQUARE);
    expect(history()).toBe(0);
    expect(vertex(container, 3).getAttribute("data-active")).toBe("true");
  });

  it("inserts a vertex from an edge midpoint by click or drag, one undo entry each", () => {
    const { container, svg } = setup();
    drag(midpoint(container, 0), svg, [150, 100], [150, 100]);
    expect(points()).toEqual([[100, 100], [150, 100], [200, 100], [200, 200], [100, 200]]);
    expect(history()).toBe(1);
    expect(vertex(container, 1).getAttribute("data-active")).toBe("true");

    // The closing edge (last vertex back to the first) gains a dragged point.
    drag(midpoint(container, 4), svg, [100, 150], [70, 160]);
    expect(points()).toEqual([[100, 100], [150, 100], [200, 100], [200, 200], [100, 200], [70, 160]]);
    expect(history()).toBe(2);
    act(() => useStore.getState().undo());
    expect(points()).toHaveLength(5);
  });

  it("nudges, removes and releases the picked vertex from the keyboard", () => {
    const { container, svg } = setup();
    drag(vertex(container, 1), svg, [200, 100], [200, 100]);
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    fireEvent.keyDown(svg, { key: "ArrowDown", shiftKey: true });
    expect(points()[1]).toEqual([201, 110]);
    expect(history()).toBe(2);

    fireEvent.keyDown(svg, { key: "Delete" });
    expect(points()).toEqual([[100, 100], [200, 200], [100, 200]]);
    expect(current().id).toBe("poly");
    expect(history()).toBe(3);

    // Three points is the minimum: Delete explains instead of removing the area.
    fireEvent.keyDown(svg, { key: "Backspace" });
    expect(points()).toHaveLength(3);
    expect(current().id).toBe("poly");
    expect(screen.getByTestId("vertex-notice").textContent).toContain("at least 3 points");
    expect(history()).toBe(3);

    // Escape lets go of the point; Delete then removes the area as before.
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(container.querySelector('[data-testid="vertex-handle"][data-active="true"]')).toBeNull();
    expect(useStore.getState().selectedAreaIds).toEqual(["poly"]);
    fireEvent.keyDown(svg, { key: "Delete" });
    expect(useStore.getState().project.views[0]!.layers[0]!.areas).toHaveLength(0);
  });

  it("shows no handles for a polygon on a locked layer and refuses its edits", () => {
    const { container } = setup(polygon(), { locked: true });
    expect(container.querySelector('[data-testid="vertex-handle"]')).toBeNull();
    expect(container.querySelector('[data-testid="vertex-insert-handle"]')).toBeNull();
    expect(screen.getByLabelText("Point 1 X").matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Add a point after point 1" }).matches(":disabled")).toBe(true);
    act(() => useStore.getState().updateAreaGeometry("poly", { type: "polygon", points: SQUARE.slice(1) }));
    expect(points()).toEqual(SQUARE);
    expect(useStore.getState().lockNotice).toContain("is locked");
  });

  it("shows handles only while exactly one polygon is selected", () => {
    const other: Area = { ...polygon([[300, 300], [400, 300], [350, 380]]), id: "other" };
    const { container } = setup();
    expect(container.querySelectorAll('[data-testid="vertex-handle"]')).toHaveLength(4);
    act(() => {
      useStore.setState((s) => { s.project.views[0]!.layers[0]!.areas.push(other as never); });
      useStore.getState().setSelectedAreaIds(["poly", "other"]);
    });
    expect(container.querySelector('[data-testid="vertex-handle"]')).toBeNull();
  });
});

describe("polygon point list in the Inspector", () => {
  it("edits exact coordinates as one undo entry per commit", () => {
    setup();
    const x = screen.getByLabelText<HTMLInputElement>("Point 2 X");
    fireEvent.change(x, { target: { value: "260" } });
    fireEvent.blur(x);
    expect(points()[1]).toEqual([260, 100]);
    expect(history()).toBe(1);
    const y = screen.getByLabelText<HTMLInputElement>("Point 2 Y");
    fireEvent.change(y, { target: { value: "40" } });
    fireEvent.blur(y);
    expect(points()[1]).toEqual([260, 40]);
    expect(history()).toBe(2);
    act(() => useStore.getState().undo());
    expect(points()[1]).toEqual([260, 100]);
  });

  it("adds and removes points with buttons and keeps the minimum of three", () => {
    setup(polygon([[0, 0], [100, 0], [50, 80]]));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Remove point 1" }).disabled).toBe(true);
    expect(screen.getByText("A polygon keeps at least 3 points.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add a point after point 3" }));
    expect(points()).toEqual([[0, 0], [100, 0], [50, 80], [25, 40]]);
    expect(history()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove point 1" }));
    expect(points()).toEqual([[100, 0], [50, 80], [25, 40]]);
    expect(history()).toBe(2);
  });

  it("snaps an added midpoint to the grid", () => {
    setup(polygon([[0, 0], [100, 0], [55, 85]]), { grid: true });
    fireEvent.click(screen.getByRole("button", { name: "Add a point after point 2" }));
    // Midpoint (77.5, 42.5) snaps to (80, 40).
    expect(points()[2]).toEqual([80, 40]);
  });
});

describe("edited polygons agree everywhere", () => {
  it("saves, reloads and renders the edited coordinates", () => {
    const { container, svg } = setup();
    drag(vertex(container, 2), svg, [200, 200], [240, 260]);
    drag(midpoint(container, 0), svg, [150, 100], [150, 60]);
    const edited = points();
    expect(edited).toEqual([[100, 100], [150, 60], [200, 100], [240, 260], [100, 200]]);

    // Design: the canvas shape is drawn from the edited points.
    expect(container.querySelector('path[style*="move"]')!.getAttribute("d")).toBe("M100,100 L150,60 L200,100 L240,260 L100,200Z");

    // Saved file: the points round-trip unchanged.
    const reloaded = parseProjectFile(serializeProjectFile(useStore.getState().project));
    expect((reloaded.views[0]!.layers[0]!.areas[0]!.geometry as { points: unknown }).points).toEqual(edited);

    // Preview/export runtime: the renderer draws the same polygon.
    __setInlinedCSS("");
    const host = document.createElement("div");
    document.body.appendChild(host);
    create({ container: host, definition: toDefinition(useStore.getState().project) });
    expect(host.querySelector("polygon")!.getAttribute("points")).toBe("100,100 150,60 200,100 240,260 100,200");
    host.remove();
  });
});
