import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { App } from "../App";
import { createRectArea, moveGeometry, resizePathToBounds, snapGeometryToGrid } from "../lib/area-utils";
import { createNewProject } from "../lib/project";
import { useStore } from "../store";
import { geometryBounds, type Area } from "@svg-mapper/shared";

// Path areas behave like polygons for move, snap, align, distribute, resize
// and labels (#218).

beforeAll(() => {
  // jsdom has no pointer capture.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function pathArea(id: string, d: string): Area {
  return {
    ...createRectArea(0, 0, 1, 1),
    id,
    name: id,
    geometry: { type: "path", d },
    style: {
      default: { fill: "#ff000033", stroke: "#ff0000", strokeWidth: 3 },
      hover: { fill: "#ff000066", stroke: "#ff0000", strokeWidth: 3 },
      active: { fill: "#ff000099", stroke: "#990000", strokeWidth: 4 },
    },
    action: { type: "url", href: "https://example.com/lake", target: "_blank" },
    metadata: { region: "north", population: 42 },
  };
}

function rectArea(id: string, x: number, y: number, width: number, height: number): Area {
  return { ...createRectArea(x, y, width, height), id, name: id };
}

function setStore(areas: Area[], selected: string[] = [], grid = { enabled: false, size: 10 }) {
  const project = createNewProject();
  const view = project.views[0]!;
  view.layers = [{ id: "layer_main", name: "Places", visible: true, locked: false, opacity: 1, areas }];
  project.editor = { zoom: 1, pan: { x: 0, y: 0 }, grid, guides: [], history: [] };
  useStore.setState({
    project,
    activeViewId: view.id,
    selectedAreaId: selected.at(-1) ?? null,
    selectedAreaIds: selected,
    selectedLayerId: null,
    activeTool: "select",
    screen: "design",
    past: [],
    future: [],
  });
}

function setup(areas: Area[], selected: string[], grid = { enabled: false, size: 10 }) {
  setStore(areas, selected, grid);
  const { container } = render(<App />);
  const svg = container.querySelector<SVGSVGElement>("svg[tabindex]")!;
  return { container, svg };
}

const area = (id: string) =>
  useStore.getState().project.views.flatMap((view) => view.layers.flatMap((layer) => layer.areas)).find((candidate) => candidate.id === id)!;
const bounds = (id: string) => geometryBounds(area(id).geometry)!;
const history = () => useStore.getState().past.length;

function drag(start: Element, svg: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(start, { clientX: from[0], clientY: from[1], pointerId: 1, button: 0 });
  fireEvent.pointerMove(svg, { clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2, pointerId: 1 });
  fireEvent.pointerMove(svg, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(svg, { clientX: to[0], clientY: to[1], pointerId: 1 });
}

const LAKE = "M100 100 C100 40 220 40 220 100 Q220 160 160 160 A60 60 0 0 1 100 100 Z";

describe("moving a path area", () => {
  it("is one undo step that preserves id, style, action and metadata", () => {
    setStore([pathArea("lake", LAKE)]);
    const before = structuredClone(area("lake"));
    const start = bounds("lake");

    act(() => useStore.getState().moveAreas(["lake"], 15, -5));
    const moved = area("lake");
    expect(history()).toBe(1);
    expect(moved.geometry.type).toBe("path");
    expect(bounds("lake").x).toBeCloseTo(start.x + 15, 2);
    expect(bounds("lake").y).toBeCloseTo(start.y - 5, 2);
    expect(bounds("lake").width).toBeCloseTo(start.width, 2);
    expect({ ...moved, geometry: undefined }).toEqual({ ...before, geometry: undefined });

    act(() => useStore.getState().undo());
    expect(area("lake")).toEqual(before);
    expect(history()).toBe(0);
  });

  it("moveArea moves a single path", () => {
    setStore([pathArea("p", "M0 0 L10 0 L10 10 Z")]);
    act(() => useStore.getState().moveArea("p", 5, 5));
    expect(area("p").geometry).toEqual({ type: "path", d: "M5 5 L15 5 L15 15 Z" });
    expect(history()).toBe(1);
  });

  it("a canvas drag moves a path in one undo entry", () => {
    const { container, svg } = setup([pathArea("p", "M10 10 L60 10 L60 60 Z")], ["p"]);
    drag(container.querySelector('path[style*="move"]')!, svg, [40, 20], [70, 60]);
    expect(area("p").geometry).toEqual({ type: "path", d: "M40 50 L90 50 L90 100 Z" });
    expect(history()).toBe(1);
    act(() => useStore.getState().undo());
    expect(area("p").geometry).toEqual({ type: "path", d: "M10 10 L60 10 L60 60 Z" });
  });

  it("a group drag moves paths together with other areas", () => {
    const { container, svg } = setup([rectArea("r", 0, 0, 20, 20), pathArea("p", "M100 0 L120 0 L110 20 Z")], ["r", "p"]);
    drag(container.querySelector('path[style*="move"]')!, svg, [5, 5], [15, 25]);
    expect(area("r").geometry).toMatchObject({ x: 10, y: 20 });
    expect(area("p").geometry).toEqual({ type: "path", d: "M110 20 L130 20 L120 40 Z" });
    expect(history()).toBe(1);
  });

  it("snaps the drag offset to the grid like other areas", () => {
    const { container, svg } = setup([pathArea("p", "M10 10 L60 10 L60 60 Z")], ["p"], { enabled: true, size: 10 });
    drag(container.querySelector('path[style*="move"]')!, svg, [40, 20], [52, 37]);
    expect(area("p").geometry).toEqual({ type: "path", d: "M20 30 L70 30 L70 80 Z" });
  });
});

describe("path geometry helpers", () => {
  it("moveGeometry translates and writes canonical data", () => {
    expect(moveGeometry({ type: "path", d: "m0 0 h10 v10 z" }, 1, 2)).toEqual({ type: "path", d: "M1 2 L11 2 L11 12 Z" });
  });

  it("leaves malformed or empty path data untouched", () => {
    const broken = { type: "path" as const, d: "M0 0 L" };
    expect(moveGeometry(broken, 5, 5)).toBe(broken);
    expect(snapGeometryToGrid(broken, 10)).toBe(broken);
    const empty = { type: "path" as const, d: " " };
    expect(moveGeometry(empty, 5, 5)).toBe(empty);
  });

  it("snaps on-curve points like polygon vertices", () => {
    expect(snapGeometryToGrid({ type: "path", d: "M1 2 L18 9 L12 21 Z" }, 10)).toEqual({ type: "path", d: "M0 0 L20 10 L10 20 Z" });
    expect(snapGeometryToGrid({ type: "path", d: "M1 1 C1 10 9 10 9 1" }, 10)).toEqual({ type: "path", d: "M0 0 C0 9 10 9 10 0" });
  });

  it("resizes to a bounding box exactly", () => {
    const resized = resizePathToBounds({ type: "path", d: LAKE }, { x: 0, y: 0, width: 50, height: 25 });
    const box = geometryBounds(resized)!;
    expect(box.x).toBeCloseTo(0, 2);
    expect(box.y).toBeCloseTo(0, 2);
    expect(box.width).toBeCloseTo(50, 2);
    expect(box.height).toBeCloseTo(25, 2);
  });
});

describe("aligning and distributing path areas", () => {
  it("aligns paths with other areas by their exact bounds", () => {
    setStore([rectArea("r", 40, 0, 20, 20), pathArea("p", "M100 50 C100 0 200 0 200 50 Z")]);
    act(() => useStore.getState().alignAreas(["r", "p"], "left"));
    expect(bounds("p").x).toBeCloseTo(40, 6);
    act(() => useStore.getState().alignAreas(["r", "p"], "top"));
    // The curve's real top is y=12.5, not the control point at y=0.
    expect(bounds("p").y).toBeCloseTo(0, 2);
    expect(area("r").geometry).toMatchObject({ x: 40, y: 0 });
    expect(history()).toBe(2);
  });

  it("distributes paths by their centres", () => {
    setStore([
      rectArea("a", 0, 0, 20, 20),
      pathArea("p", "M30 0 L50 0 L40 20 Z"),
      rectArea("b", 200, 0, 20, 20),
    ]);
    act(() => useStore.getState().distributeAreas(["a", "p", "b"], "horizontal"));
    expect(bounds("p").x + bounds("p").width / 2).toBeCloseTo(110, 6);
    expect(history()).toBe(1);
  });
});

describe("resizing a path area on the canvas", () => {
  it("drags a bounding-box corner as one undo step", () => {
    const { container, svg } = setup([pathArea("p", "M10 10 L110 10 L60 60 Z")], ["p"]);
    expect(container.querySelector('[data-testid="path-bounds"]')).not.toBeNull();
    const before = structuredClone(area("p"));
    // South-east corner of the bounds (10,10)-(110,60).
    drag(container.querySelector('circle[cx="110"][cy="60"]')!, svg, [110, 60], [210, 110]);
    expect(area("p").geometry).toEqual({ type: "path", d: "M10 10 L210 10 L110 110 Z" });
    expect({ ...area("p"), geometry: undefined }).toEqual({ ...before, geometry: undefined });
    expect(history()).toBe(1);
    act(() => useStore.getState().undo());
    expect(area("p")).toEqual(before);
  });

  it("shows no resize handles on a locked layer", () => {
    setStore([pathArea("p", "M10 10 L110 10 L60 60 Z")], ["p"]);
    useStore.setState((s) => {
      s.project.views[0]!.layers[0]!.locked = true;
    });
    const { container } = render(<App />);
    expect(container.querySelector('[data-testid="path-bounds"]')).toBeNull();
    expect(container.querySelector('circle[cx="110"][cy="60"]')).toBeNull();
  });
});

describe("path area labels", () => {
  it("centres the editor label on the path's exact bounds", () => {
    setStore([pathArea("p", "M0 0 C0 100 100 100 100 0 Z")]);
    useStore.setState((s) => {
      s.project.settings.areaLabels = { enabled: true, hideWhenSmaller: false };
    });
    const { container } = render(<App />);
    const label = container.querySelector<SVGTextElement>("text.clickmap-area-label")!;
    expect(label.textContent).toBe("p");
    expect(Number(label.getAttribute("x"))).toBeCloseTo(50, 6);
    expect(Number(label.getAttribute("y"))).toBeCloseTo(37.5, 6);
  });
});
