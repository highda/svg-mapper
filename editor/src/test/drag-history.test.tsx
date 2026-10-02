import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { App } from "../App";
import { createCircleArea, createRectArea } from "../lib/area-utils";
import { createNewProject } from "../lib/project";
import { useStore } from "../store";
import type { Area } from "@svg-mapper/shared";

// One drag is one undo entry; cancelled drags roll back; undo keeps a valid view (#163).

beforeAll(() => {
  // jsdom has no pointer capture.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function setup(areas: Area[], selected: string[]) {
  const project = createNewProject();
  const view = project.views[0]!;
  view.layers = [{ id: "layer_main", name: "Places", visible: true, locked: false, opacity: 1, areas }];
  project.editor = { zoom: 1, pan: { x: 0, y: 0 }, grid: { enabled: false, size: 10 }, guides: [], history: [] };
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
  const { container } = render(<App />);
  const svg = container.querySelector<SVGSVGElement>("svg[tabindex]") ?? container.querySelector<SVGSVGElement>("main svg")!;
  return { container, svg };
}

const geometry = (id: string) =>
  useStore.getState().project.views.flatMap((view) => view.layers.flatMap((layer) => layer.areas)).find((area) => area.id === id)!.geometry;
const history = () => useStore.getState().past.length;

function rectArea(id: string, x: number, y: number, width: number, height: number): Area {
  return { ...createRectArea(x, y, width, height), id, name: id };
}

function drag(start: Element, svg: Element, from: [number, number], to: [number, number], finish: "up" | "cancel" = "up") {
  fireEvent.pointerDown(start, { clientX: from[0], clientY: from[1], pointerId: 1, button: 0 });
  fireEvent.pointerMove(svg, { clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2, pointerId: 1 });
  fireEvent.pointerMove(svg, { clientX: to[0], clientY: to[1], pointerId: 1 });
  if (finish === "up") fireEvent.pointerUp(svg, { clientX: to[0], clientY: to[1], pointerId: 1 });
  else fireEvent.pointerCancel(svg, { pointerId: 1 });
}

describe("atomic drag history", () => {
  it("one undo restores a resized rectangle and redo restores the result", () => {
    const { container, svg } = setup([rectArea("r1", 10, 10, 150, 105)], ["r1"]);
    const before = geometry("r1");
    const handle = container.querySelector('circle[cx="160"][cy="115"]')!;
    drag(handle, svg, [160, 115], [195, 140]);
    const after = geometry("r1");
    expect(after).toMatchObject({ width: 185, height: 130 });
    expect(history()).toBe(1);

    act(() => useStore.getState().undo());
    expect(geometry("r1")).toEqual(before);
    act(() => useStore.getState().redo());
    expect(geometry("r1")).toEqual(after);
  });

  it("one undo restores a resized circle", () => {
    const circle = { ...createCircleArea(100, 100, 40), id: "c1", name: "c1" };
    const { container, svg } = setup([circle], ["c1"]);
    const before = geometry("c1");
    const handle = container.querySelector('circle[cx="140"][cy="100"]')!;
    drag(handle, svg, [140, 100], [170, 100]);
    const after = geometry("c1");
    expect(after).not.toEqual(before);
    expect(history()).toBe(1);
    act(() => useStore.getState().undo());
    expect(geometry("c1")).toEqual(before);
    act(() => useStore.getState().redo());
    expect(geometry("c1")).toEqual(after);
  });

  it("a group drag is one undo entry", () => {
    const { container, svg } = setup([rectArea("a", 10, 10, 40, 40), rectArea("b", 100, 10, 40, 40)], ["a", "b"]);
    const shape = container.querySelector('path[style*="move"]')!;
    drag(shape, svg, [20, 20], [50, 60]);
    expect(geometry("a")).toMatchObject({ x: 40, y: 50 });
    expect(geometry("b")).toMatchObject({ x: 130, y: 50 });
    expect(history()).toBe(1);
    act(() => useStore.getState().undo());
    expect(geometry("a")).toMatchObject({ x: 10, y: 10 });
    expect(geometry("b")).toMatchObject({ x: 100, y: 10 });
  });

  it("clicks without movement create no history", () => {
    const { container, svg } = setup([rectArea("r1", 10, 10, 150, 105)], ["r1"]);
    drag(container.querySelector('circle[cx="160"][cy="115"]')!, svg, [160, 115], [160, 115]);
    drag(container.querySelector('path[style*="move"]')!, svg, [20, 20], [20, 20]);
    expect(history()).toBe(0);
  });

  it.each([
    ["pointercancel", (svg: Element) => fireEvent.pointerCancel(svg, { pointerId: 1 })],
    ["lost pointer capture", (svg: Element) => fireEvent.lostPointerCapture(svg, { pointerId: 1 })],
    ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
    ["window blur", () => fireEvent.blur(window)],
  ] as const)("%s rolls a drag back to its baseline without history", (_name, interrupt) => {
    const { container, svg } = setup([rectArea("r1", 10, 10, 150, 105)], ["r1"]);
    const before = geometry("r1");
    const handle = container.querySelector('circle[cx="160"][cy="115"]')!;
    fireEvent.pointerDown(handle, { clientX: 160, clientY: 115, pointerId: 1, button: 0 });
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 150, pointerId: 1 });
    expect(geometry("r1")).not.toEqual(before);
    interrupt(svg);
    expect(geometry("r1")).toEqual(before);
    // The drag is over: later movement and release change nothing.
    fireEvent.pointerMove(svg, { clientX: 260, clientY: 190, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 260, clientY: 190, pointerId: 1 });
    expect(geometry("r1")).toEqual(before);
    expect(history()).toBe(0);
    // Escape during the drag did not also clear the selection.
    expect(useStore.getState().selectedAreaId).toBe("r1");
  });
});

describe("undo keeps a valid active view", () => {
  const activeExists = () => {
    const { project, activeViewId } = useStore.getState();
    return project.views.some((view) => view.id === activeViewId);
  };

  it("after add, duplicate and delete view", () => {
    setup([rectArea("r1", 10, 10, 40, 40)], []);
    const store = () => useStore.getState();
    const first = store().activeViewId;

    act(() => store().addView());
    act(() => store().undo());
    expect(activeExists()).toBe(true);
    act(() => store().redo());
    expect(activeExists()).toBe(true);

    act(() => store().duplicateView(first));
    act(() => store().setActiveViewId(store().project.views.at(-1)!.id));
    act(() => store().undo());
    expect(activeExists()).toBe(true);
    act(() => store().redo());
    expect(activeExists()).toBe(true);

    const last = store().project.views.at(-1)!.id;
    act(() => store().setActiveViewId(last));
    act(() => store().deleteView(last));
    expect(activeExists()).toBe(true);
    act(() => store().undo());
    expect(activeExists()).toBe(true);
    act(() => store().redo());
    expect(activeExists()).toBe(true);
  });
});
