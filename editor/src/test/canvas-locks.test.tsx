import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "../App";
import { createRectArea } from "../lib/area-utils";
import { createNewProject } from "../lib/project";
import { useStore } from "../store";
import type { Area, Layer } from "@svg-mapper/shared";

// Canvas drags and resize handles honour layer and image locks (#164).

beforeAll(() => {
  // jsdom has no pointer capture.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function rect(id: string, x: number, y: number, extra: Partial<Area> = {}): Area {
  return { ...createRectArea(x, y, 40, 40), id, name: id, ...extra };
}

function setup(selected: string[]) {
  const project = createNewProject();
  const view = project.views[0]!;
  const layers: Layer[] = [
    { id: "open", name: "Open", visible: true, locked: false, opacity: 1, areas: [
      rect("free", 10, 10),
      rect("pinned", 100, 10, { image: { assetId: "missing", locked: true } }),
      rect("off", 200, 10, { disabled: true }),
    ] },
    { id: "frozen", name: "Frozen", visible: true, locked: true, opacity: 1, areas: [rect("held", 300, 10)] },
  ];
  view.layers = layers;
  project.editor = { zoom: 1, pan: { x: 0, y: 0 }, grid: { enabled: false, size: 10 }, guides: [], history: [] };
  useStore.setState({
    project,
    activeViewId: view.id,
    selectedAreaId: selected.at(-1) ?? null,
    selectedAreaIds: selected,
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

const geometry = (id: string) =>
  useStore.getState().project.views.flatMap((view) => view.layers.flatMap((layer) => layer.areas)).find((area) => area.id === id)!.geometry;
const history = () => useStore.getState().past.length;

describe("canvas locks", () => {
  it("a mixed drag previews and commits only unlocked areas, in one undo entry", () => {
    const { container, svg } = setup(["free", "pinned", "held"]);
    const shape = container.querySelector('path[style*="move"]')!;
    fireEvent.pointerDown(shape, { clientX: 20, clientY: 20, pointerId: 1, button: 0 });
    fireEvent.pointerMove(svg, { clientX: 50, clientY: 60, pointerId: 1 });
    // Mid-drag preview never touches locked geometry.
    expect(geometry("free")).toMatchObject({ x: 40, y: 50 });
    expect(geometry("pinned")).toMatchObject({ x: 100, y: 10 });
    expect(geometry("held")).toMatchObject({ x: 300, y: 10 });
    fireEvent.pointerUp(svg, { clientX: 50, clientY: 60, pointerId: 1 });

    expect(geometry("free")).toMatchObject({ x: 40, y: 50 });
    expect(geometry("pinned")).toMatchObject({ x: 100, y: 10 });
    expect(geometry("held")).toMatchObject({ x: 300, y: 10 });
    expect(history()).toBe(1);
    expect(screen.getByTestId("lock-notice").textContent).toBe("2 locked areas were left unchanged.");

    act(() => useStore.getState().undo());
    expect(geometry("free")).toMatchObject({ x: 10, y: 10 });
    expect(geometry("held")).toMatchObject({ x: 300, y: 10 });
  });

  it("locked areas are selectable but cannot be dragged or resized", () => {
    const { container, svg } = setup([]);
    const locked = container.querySelectorAll('path[data-locked="true"]');
    expect(locked).toHaveLength(2);

    // Clicking a locked layer's area selects it and shows no resize handles.
    fireEvent.pointerDown(locked[1]!, { clientX: 310, clientY: 20, pointerId: 1, button: 0 });
    fireEvent.pointerMove(svg, { clientX: 360, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 360, clientY: 60, pointerId: 1 });
    expect(useStore.getState().selectedAreaIds).toEqual(["held"]);
    expect(geometry("held")).toMatchObject({ x: 300, y: 10 });
    expect(history()).toBe(0);
    expect(container.querySelector('circle[style*="crosshair"]')).toBeNull();
    expect(screen.getByTestId("lock-notice").textContent).toBe("Layer “Frozen” is locked; its geometry was left unchanged.");

    // The inspector shows the geometry but will not edit it.
    expect(screen.getByText("Layer “Frozen” is locked. Unlock it to move or resize this area.")).toBeTruthy();
    const fieldset = screen.getByText(/Unlock it to move or resize/).closest("fieldset")!;
    expect(fieldset.disabled).toBe(true);

    // A position-locked image is selectable too.
    fireEvent.pointerDown(locked[0]!, { clientX: 110, clientY: 20, pointerId: 1, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 110, clientY: 20, pointerId: 1 });
    expect(useStore.getState().selectedAreaIds).toEqual(["pinned"]);
    expect(container.querySelector('circle[style*="crosshair"]')).toBeNull();
  });

  it("a disabled visitor hotspot is still selectable and editable", () => {
    const { container, svg } = setup([]);
    // Draggable shapes in paint order: free, off.
    const disabled = container.querySelectorAll('path[style*="move"]')[1]!;
    fireEvent.pointerDown(disabled, { clientX: 210, clientY: 20, pointerId: 1, button: 0 });
    fireEvent.pointerMove(svg, { clientX: 220, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 220, clientY: 30, pointerId: 1 });
    expect(useStore.getState().selectedAreaIds).toEqual(["off"]);
    expect(geometry("off")).toMatchObject({ x: 210, y: 20 });
    expect(container.querySelectorAll('circle[style*="crosshair"]').length).toBeGreaterThan(0);
  });
});
