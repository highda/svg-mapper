import { beforeEach, describe, expect, it } from "vitest";
import type { Area, Layer } from "@svg-mapper/shared";
import { canEditGeometry, canEditLayerContents, useStore } from "../store";
import { createNewProject } from "../lib/project";
import { createRectArea } from "../lib/area-utils";

// Locks hold at every mutation boundary, not only in the UI (#164).

function rect(id: string, x: number, y: number, extra: Partial<Area> = {}): Area {
  return { ...createRectArea(x, y, 20, 20), id, name: id, ...extra };
}

function layer(id: string, locked: boolean, areas: Area[]): Layer {
  return { id, name: id, visible: true, locked, opacity: 1, areas };
}

/** open: free + image-locked areas; frozen: a locked layer. */
function setup(layers?: Layer[]) {
  const project = createNewProject();
  const view = project.views[0]!;
  view.layers = layers ?? [
    layer("open", false, [
      rect("free_a", 10, 10),
      rect("free_b", 100, 40),
      rect("pinned", 200, 80, { image: { assetId: "asset_1", locked: true } }),
    ]),
    layer("frozen", true, [rect("held", 300, 120)]),
  ];
  useStore.setState({
    project,
    activeViewId: view.id,
    selectedAreaId: null,
    selectedAreaIds: [],
    selectedLayerId: null,
    clipboardArea: null,
    lockNotice: null,
    past: [],
    future: [],
  });
}

const store = () => useStore.getState();
const areaById = (id: string) =>
  store().project.views.flatMap((view) => view.layers.flatMap((candidate) => candidate.areas)).find((area) => area.id === id);
const geometry = (id: string) => areaById(id)!.geometry;
const layerAreas = (id: string) =>
  store().project.views.flatMap((view) => view.layers).find((candidate) => candidate.id === id)!.areas.map((area) => area.id);

beforeEach(() => setup());

describe("lock policy helpers", () => {
  it("freeze geometry for locked layers and position-locked images only", () => {
    expect(canEditGeometry({ locked: false }, {})).toBe(true);
    expect(canEditGeometry({ locked: true }, {})).toBe(false);
    expect(canEditGeometry({ locked: false }, { image: { locked: true } })).toBe(false);
    expect(canEditGeometry({ locked: false }, { image: { locked: false } })).toBe(true);
    expect(canEditLayerContents({ locked: true })).toBe(false);
    expect(canEditLayerContents({ locked: false })).toBe(true);
  });
});

describe("geometry commands on mixed locked/unlocked selections", () => {
  it("moveAreas moves only editable areas, explains the skip, and undoes in one step", () => {
    const before = { held: geometry("held"), pinned: geometry("pinned"), a: geometry("free_a") };
    store().moveAreas(["free_a", "pinned", "held"], 15, 5);

    expect(geometry("free_a")).toMatchObject({ x: 25, y: 15 });
    expect(geometry("pinned")).toEqual(before.pinned);
    expect(geometry("held")).toEqual(before.held);
    expect(store().past).toHaveLength(1);
    expect(store().lockNotice).toBe("2 locked areas were left unchanged.");

    store().undo();
    expect(geometry("free_a")).toEqual(before.a);
    expect(store().past).toHaveLength(0);
  });

  it("refuses a move made only of locked areas without a history entry", () => {
    store().moveAreas(["held"], 15, 5);
    expect(geometry("held")).toMatchObject({ x: 300, y: 120 });
    expect(store().past).toHaveLength(0);
    expect(store().lockNotice).toBe("Layer “frozen” is locked; its geometry was left unchanged.");

    store().moveArea("pinned", 5, 5);
    expect(geometry("pinned")).toMatchObject({ x: 200, y: 80 });
    expect(store().lockNotice).toBe("Image position is locked; its geometry was left unchanged.");
    expect(store().past).toHaveLength(0);
  });

  it("align and distribute leave locked areas in place in one undo entry", () => {
    store().alignAreas(["free_a", "free_b", "pinned", "held"], "left");
    expect(geometry("free_b")).toMatchObject({ x: 10, y: 40 });
    expect(geometry("pinned")).toMatchObject({ x: 200, y: 80 });
    expect(geometry("held")).toMatchObject({ x: 300, y: 120 });
    expect(store().past).toHaveLength(1);
    expect(store().lockNotice).toBe("2 locked areas were left unchanged.");
    store().undo();
    expect(geometry("free_b")).toMatchObject({ x: 100, y: 40 });

    // Two editable areas cannot be distributed; the locked ones do not count.
    store().distributeAreas(["free_a", "free_b", "pinned", "held"], "horizontal");
    expect(store().past).toHaveLength(0);
    expect(geometry("pinned")).toMatchObject({ x: 200, y: 80 });
  });

  it("updateAreaGeometry refuses locked layers and position-locked images", () => {
    store().updateAreaGeometry("held", { type: "rect", x: 0, y: 0, width: 99, height: 99 });
    store().updateAreaGeometry("pinned", { type: "rect", x: 0, y: 0, width: 99, height: 99 });
    expect(geometry("held")).toMatchObject({ x: 300, width: 20 });
    expect(geometry("pinned")).toMatchObject({ x: 200, width: 20 });
    expect(store().past).toHaveLength(0);
    expect(store().lockNotice).toMatch(/Image position is locked/);

    store().updateAreaGeometry("free_a", { type: "rect", x: 0, y: 0, width: 99, height: 99 });
    expect(geometry("free_a")).toMatchObject({ width: 99 });
    expect(store().lockNotice).toBeNull();
  });
});

describe("structural edits in locked layers", () => {
  it("refuses delete, duplicate, reorder and layer deletion while locked", () => {
    store().deleteArea("held");
    store().duplicateArea("held");
    store().reorderArea("held", 1);
    store().deleteLayer("frozen");
    expect(layerAreas("frozen")).toEqual(["held"]);
    expect(store().past).toHaveLength(0);
    expect(store().lockNotice).toBe("Layer “frozen” is locked. Unlock it before deleting it.");

    store().duplicateAreas(["free_a", "held"]);
    expect(layerAreas("frozen")).toEqual(["held"]);
    expect(layerAreas("open")).toHaveLength(4);
    expect(store().lockNotice).toBe("1 area in a locked layer was not duplicated.");
  });

  it("allows structural edits of a position-locked image in an unlocked layer", () => {
    store().duplicateArea("pinned");
    expect(layerAreas("open")).toHaveLength(4);
    store().deleteArea("pinned");
    expect(layerAreas("open")).not.toContain("pinned");
  });
});

describe("insertion never silently enters a locked layer", () => {
  it("refuses drawing, image placement and paste into a selected locked layer", () => {
    store().copyArea("free_a");
    store().setSelectedLayerId("frozen");
    store().addArea(rect("drawn", 0, 0));
    expect(store().lockNotice).toBe("The new area was not added. Layer “frozen” is locked. Unlock it or select another layer.");
    store().setSelectedLayerId("frozen");
    store().pasteArea();
    expect(store().lockNotice).toMatch(/^free_a was not pasted\. Layer “frozen” is locked/);
    useStore.setState((s) => {
      s.project.assets.push({ id: "asset_2", name: "logo.png", type: "image", mimeType: "image/png", src: "data:image/png;base64,", width: 10, height: 10 } as never);
    });
    store().setSelectedLayerId("frozen");
    store().addImageElement("asset_2");
    expect(store().lockNotice).toMatch(/^logo\.png was not placed\. Layer “frozen” is locked/);

    expect(layerAreas("frozen")).toEqual(["held"]);
    expect(layerAreas("open")).toHaveLength(3);
    expect(store().past).toHaveLength(0);
  });

  it("falls back to the first unlocked layer, never to a locked first layer", () => {
    setup([layer("frozen", true, [rect("held", 0, 0)]), layer("open", false, [])]);
    store().addArea(rect("drawn", 0, 0));
    store().copyArea("held");
    store().pasteArea();
    expect(layerAreas("frozen")).toEqual(["held"]);
    expect(layerAreas("open")).toHaveLength(2);
    expect(layerAreas("open")[0]).toBe("drawn");
    expect(store().lockNotice).toBeNull();
  });

  it("refuses insertion when every layer is locked", () => {
    setup([layer("frozen", true, [])]);
    store().addArea(rect("drawn", 0, 0));
    expect(layerAreas("frozen")).toEqual([]);
    expect(store().past).toHaveLength(0);
    expect(store().lockNotice).toBe("The new area was not added. Every layer in this view is locked. Unlock a layer or add a new one.");
  });
});

describe("locked content stays selectable and unlockable", () => {
  it("selects locked areas, edits their properties, and unlocks them", () => {
    store().setSelectedAreaIds(["held", "pinned"]);
    expect(store().selectedAreaIds).toEqual(["held", "pinned"]);

    store().renameArea("held", "Held area");
    store().updateAreaInteraction("held", { disabled: true });
    expect(areaById("held")).toMatchObject({ name: "Held area", disabled: true });

    store().toggleLayerLock("frozen");
    store().updateAreaImage("pinned", { assetId: "asset_1", locked: false });
    store().moveAreas(["held", "pinned"], 10, 10);
    expect(geometry("held")).toMatchObject({ x: 310, y: 130 });
    expect(geometry("pinned")).toMatchObject({ x: 210, y: 90 });
    expect(store().lockNotice).toBeNull();
  });
});
