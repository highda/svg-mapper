import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Area } from "@svg-mapper/shared";
import { App } from "../App";
import { createRectArea } from "../lib/area-utils";
import { createNewProject } from "../lib/project";
import { useStore } from "../store";

// Commits keep focus and slider capture, and never drop unrelated settings (#165).

vi.mock("../lib/alpha-mask", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/alpha-mask")>()),
  createAlphaHitMask: vi.fn(async () => ({ width: 2, height: 1, threshold: 0.2, data: "AA" })),
}));

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function setup(mutate?: (area: Area, project: ReturnType<typeof createNewProject>) => void) {
  const project = createNewProject();
  const area = { ...createRectArea(10, 10, 40, 40), id: "area_a", name: "A" };
  project.views[0]!.layers = [{ id: "layer_a", name: "Places", visible: true, locked: false, opacity: 1, areas: [area] }];
  mutate?.(area, project);
  useStore.setState({
    project,
    activeViewId: project.views[0]!.id,
    selectedAreaId: area.id,
    selectedAreaIds: [area.id],
    selectedLayerId: null,
    activeTool: "select",
    screen: "design",
    past: [],
    future: [],
  });
  render(<App />);
}

const area = () => useStore.getState().project.views[0]!.layers[0]!.areas[0]!;

describe("inspector commits", () => {
  it("keeps focus on the next field after committing a color", () => {
    setup();
    const fill = screen.getByLabelText("Default fill CSS color");
    const next = screen.getByLabelText("Default stroke CSS color");
    fill.focus();
    fireEvent.change(fill, { target: { value: "#ff0000" } });
    act(() => next.focus()); // Tab: blur commits the fill
    expect(area().style.default.fill).toBe("#ff0000");
    expect(next.isConnected).toBe(true);
    expect(document.activeElement).toBe(next);
  });

  it("keeps the same opacity slider through a drag of commits", () => {
    setup();
    const slider = screen.getByLabelText("Default fill opacity");
    for (const value of ["80", "60", "40"]) fireEvent.change(slider, { target: { value } });
    expect(slider.isConnected).toBe(true);
    expect(screen.getByLabelText("Default fill opacity")).toBe(slider);
  });

  it("shows restored and externally changed values without stale drafts", () => {
    setup();
    const fill = screen.getByLabelText<HTMLInputElement>("Default fill CSS color");
    const original = fill.value;
    fireEvent.change(fill, { target: { value: "#00ff00" } });
    fireEvent.blur(fill);
    act(() => useStore.getState().undo());
    act(() => useStore.getState().setSelectedAreaId("area_a"));
    expect(screen.getByLabelText<HTMLInputElement>("Default fill CSS color").value).toBe(original);
    act(() => useStore.getState().redo());
    act(() => useStore.getState().setSelectedAreaId("area_a"));
    expect(screen.getByLabelText<HTMLInputElement>("Default fill CSS color").value).toBe("#00ff00");

    // A geometry change from the canvas shows in the X field.
    act(() => useStore.getState().updateAreaGeometry("area_a", { type: "rect", x: 77, y: 10, width: 40, height: 40 }));
    expect(screen.getByDisplayValue("77")).toBeInTheDocument();
  });
});

describe("semantic settings patches", () => {
  it("zoom toggles and position changes keep step, reset and wheel settings", () => {
    setup((_area, project) => {
      project.settings.zoomControls = { enabled: true, position: "top-right", step: 0.5, resetBehavior: "fit", wheelMode: "ctrl" };
    });
    act(() => useStore.getState().setSelectedAreaId(null));
    fireEvent.change(screen.getByLabelText("Zoom Controls Position"), { target: { value: "bottom-left" } });
    fireEvent.click(screen.getByLabelText("Show zoom controls"));
    expect(useStore.getState().project.settings.zoomControls).toEqual({
      enabled: false, position: "bottom-left", step: 0.5, resetBehavior: "fit", wheelMode: "ctrl",
    });
  });

  it("toggling a tooltip keeps its image", () => {
    setup((a) => { a.tooltip = { enabled: true, title: "T", body: "B", imageUrl: "https://example.test/t.png" }; });
    const toggle = screen.getByLabelText("Enable tooltip");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByLabelText("Enable tooltip"));
    expect(area().tooltip).toEqual({ enabled: true, title: "T", body: "B", imageUrl: "https://example.test/t.png" });
  });

  it("alpha-mask generation keeps image fit, opacity, rotation, visibility and lock", async () => {
    setup((a, project) => {
      project.assets.push({ id: "asset_png", name: "Pin", type: "image/png", src: "data:image/png;base64,AAAA", width: 2, height: 1 } as never);
      a.image = { assetId: "asset_png", fit: "cover", opacity: 0.5, rotation: 30, visible: false, locked: true };
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Generate alpha mask" })));
    expect(area().image).toMatchObject({ assetId: "asset_png", fit: "cover", opacity: 0.5, rotation: 30, visible: false, locked: true });
    expect(area().image?.hitMask).toBeDefined();
  });

  it("batch style edits detach linked presets like direct edits", () => {
    setup();
    const store = () => useStore.getState();
    const style = structuredClone(area().style);
    const presetId = store().createSharedStyle("Preset", style);
    act(() => store().applySharedStyle(["area_a"], presetId, true));
    expect(area().sharedStyleId).toBe(presetId);

    const edited = { ...style, default: { ...style.default, fill: "#123456" } };
    act(() => store().updateAreas(["area_a"], { style: edited }));
    expect(area().sharedStyleId).toBeUndefined();
    act(() => store().updateSharedStyle(presetId, "Preset", { ...style, default: { ...style.default, fill: "#abcdef" } }));
    expect(area().style.default.fill).toBe("#123456");
  });
});
