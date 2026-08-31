import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../store";
import { createNewProject } from "../lib/project";
import { calculateZoomToFit, createCircleArea, createRectArea, createPolygonArea, getGeometryBbox, moveGeometry, snapGeometryToGrid, snapValue } from "../lib/area-utils";
import { sanitizeSvg } from "../lib/svg-sanitize";

function resetStore() {
  const p = createNewProject();
  useStore.setState({
    project: p,
    activeViewId: p.views[0].id,
    selectedAreaId: null,
    activeTool: "select",
    past: [],
    future: [],
  });
}

// ── SVG sanitizer ──────────────────────────────────────────────────────────

describe("sanitizeSvg", () => {
  it("strips <script> tags", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("<script");
    expect(result).toContain("rect");
  });

  it("strips event-handler attributes", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="evil()" onload="bad()" width="10" height="10"/></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onload");
    expect(result).toContain("rect");
  });

  it("strips <iframe> elements", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><iframe src="evil.html"/></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("iframe");
  });

  it("strips <foreignObject> elements", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>evil</div></foreignObject></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("foreignObject");
  });

  it("preserves safe content", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100"/></svg>`;
    const result = sanitizeSvg(svg);
    expect(result).toContain("rect");
    expect(result).toContain("viewBox");
  });
});

// ── Area utilities ─────────────────────────────────────────────────────────

describe("createRectArea", () => {
  it("creates a rect area with correct geometry", () => {
    const area = createRectArea(10, 20, 100, 50);
    expect(area.geometry.type).toBe("rect");
    if (area.geometry.type === "rect") {
      expect(area.geometry.x).toBe(10);
      expect(area.geometry.y).toBe(20);
      expect(area.geometry.width).toBe(100);
      expect(area.geometry.height).toBe(50);
    }
    expect(area.action.type).toBe("none");
    expect(area.id).toMatch(/^area_/);
  });
});

describe("createPolygonArea", () => {
  it("creates a polygon with given points", () => {
    const pts: [number, number][] = [[0, 0], [100, 0], [50, 100]];
    const area = createPolygonArea(pts);
    expect(area.geometry.type).toBe("polygon");
    if (area.geometry.type === "polygon") {
      expect(area.geometry.points).toHaveLength(3);
    }
  });
});

describe("circle authoring", () => {
  it("creates a circle and reports its complete bounds", () => {
    const area = createCircleArea(60, 40, 20);
    expect(area.geometry).toEqual({ type: "circle", cx: 60, cy: 40, r: 20 });
    expect(getGeometryBbox(area.geometry)).toEqual({ x: 40, y: 20, width: 40, height: 40 });
  });
});

describe("zoom to fit", () => {
  it("fits and centers polygon bounds in the viewport", () => {
    const bounds = getGeometryBbox({ type: "polygon", points: [[100, 200], [300, 200], [200, 300]] });
    expect(bounds).not.toBeNull();
    expect(calculateZoomToFit(bounds!, { width: 1000, height: 800 }, { width: 500, height: 400 })).toEqual({
      zoom: 2,
      pan: { x: 600, y: 300 },
    });
  });

  it("centers the full canvas without introducing pan", () => {
    expect(calculateZoomToFit(
      { x: 0, y: 0, width: 1000, height: 500 },
      { width: 1000, height: 500 },
      { width: 1000, height: 500 },
    )).toEqual({ zoom: 0.8, pan: { x: 0, y: 0 } });
  });
});

describe("moveGeometry", () => {
  it("translates rect", () => {
    const geo = { type: "rect" as const, x: 10, y: 20, width: 100, height: 50 };
    const moved = moveGeometry(geo, 5, -3);
    if (moved.type === "rect") {
      expect(moved.x).toBe(15);
      expect(moved.y).toBe(17);
    }
  });

  it("translates polygon", () => {
    const geo = { type: "polygon" as const, points: [[0, 0], [10, 0]] as [number, number][] };
    const moved = moveGeometry(geo, 2, 4);
    if (moved.type === "polygon") {
      expect(moved.points[0]).toEqual([2, 4]);
      expect(moved.points[1]).toEqual([12, 4]);
    }
  });
});

describe("grid snapping", () => {
  it("rounds values to the nearest grid point", () => {
    expect(snapValue(14, 10)).toBe(10);
    expect(snapValue(16, 10)).toBe(20);
    expect(snapValue(16, 0)).toBe(16);
  });

  it("snaps rect bounds and polygon vertices", () => {
    expect(snapGeometryToGrid({ type: "rect", x: 14, y: 16, width: 33, height: 27 }, 10)).toMatchObject({
      x: 10, y: 20, width: 40, height: 20,
    });
    expect(snapGeometryToGrid({ type: "polygon", points: [[4, 6], [24, 27]] }, 10)).toMatchObject({
      points: [[0, 10], [20, 30]],
    });
  });
});

// ── Store: area CRUD ───────────────────────────────────────────────────────

describe("store: addArea", () => {
  beforeEach(resetStore);

  it("adds an area to the active view's first layer (creating one if absent)", () => {
    const area = createRectArea(0, 0, 100, 100);
    useStore.getState().addArea(area);

    const view = useStore.getState().project.views[0];
    expect(view.layers).toHaveLength(1);
    expect(view.layers[0].areas).toHaveLength(1);
    expect(view.layers[0].areas[0].id).toBe(area.id);
    expect(useStore.getState().selectedAreaId).toBe(area.id);
  });

  it("pushes to undo history", () => {
    useStore.getState().addArea(createRectArea(0, 0, 50, 50));
    expect(useStore.getState().past).toHaveLength(1);
  });
});

describe("store: canvas size suggestion", () => {
  beforeEach(resetStore);

  it("suggests imported raster dimensions and applies them", () => {
    const viewId = useStore.getState().activeViewId;
    useStore.getState().importAsset({
      id: "asset_large",
      name: "floor.png",
      type: "image/png",
      src: "data:image/png;base64,",
      width: 1200,
      height: 800,
      inline: true,
    });
    useStore.getState().setViewBackground(viewId, "asset_large");
    expect(useStore.getState().canvasSizeSuggestion).toEqual({ width: 1200, height: 800 });

    useStore.getState().setCanvasSize(1200, 800);
    useStore.getState().dismissCanvasSizeSuggestion();
    expect(useStore.getState().project.settings.canvasSize).toEqual({ width: 1200, height: 800 });
    expect(useStore.getState().canvasSizeSuggestion).toBeNull();
  });

  it("does not retain a stale suggestion when dimensions already match", () => {
    const viewId = useStore.getState().activeViewId;
    for (const asset of [
      { id: "different", width: 1200, height: 800 },
      { id: "matching", width: 1600, height: 900 },
    ]) {
      useStore.getState().importAsset({
        ...asset,
        name: `${asset.id}.png`,
        type: "image/png",
        src: "data:image/png;base64,",
        inline: true,
      });
    }
    useStore.getState().setViewBackground(viewId, "different");
    useStore.getState().setViewBackground(viewId, "matching");
    expect(useStore.getState().canvasSizeSuggestion).toBeNull();
  });
});

describe("store: deleteArea", () => {
  beforeEach(resetStore);

  it("removes the area and clears selection", () => {
    const area = createRectArea(0, 0, 50, 50);
    useStore.getState().addArea(area);
    useStore.getState().deleteArea(area.id);
    const view = useStore.getState().project.views[0];
    expect(view.layers[0].areas).toHaveLength(0);
    expect(useStore.getState().selectedAreaId).toBeNull();
  });
});

describe("store: duplicateArea", () => {
  beforeEach(resetStore);

  it("creates a copy with a new ID", () => {
    const area = createRectArea(0, 0, 100, 80);
    useStore.getState().addArea(area);
    useStore.getState().duplicateArea(area.id);
    const areas = useStore.getState().project.views[0].layers[0].areas;
    expect(areas).toHaveLength(2);
    expect(areas[1].id).not.toBe(area.id);
    expect(useStore.getState().selectedAreaId).toBe(areas[1].id);
  });
});

// ── Undo / redo ────────────────────────────────────────────────────────────

describe("store: undo/redo", () => {
  beforeEach(resetStore);

  it("undo removes an added area", () => {
    const area = createRectArea(0, 0, 100, 100);
    useStore.getState().addArea(area);
    expect(useStore.getState().project.views[0].layers[0].areas).toHaveLength(1);

    useStore.getState().undo();
    // After undo the layer either doesn't exist or has no areas
    const view = useStore.getState().project.views[0];
    const totalAreas = view.layers.reduce((n, l) => n + l.areas.length, 0);
    expect(totalAreas).toBe(0);
  });

  it("redo re-applies an undone add", () => {
    const area = createRectArea(0, 0, 100, 100);
    useStore.getState().addArea(area);
    useStore.getState().undo();
    useStore.getState().redo();
    const view = useStore.getState().project.views[0];
    const totalAreas = view.layers.reduce((n, l) => n + l.areas.length, 0);
    expect(totalAreas).toBe(1);
  });

  it("adding after undo clears the redo stack", () => {
    useStore.getState().addArea(createRectArea(0, 0, 50, 50));
    useStore.getState().undo();
    useStore.getState().addArea(createRectArea(10, 10, 60, 60));
    expect(useStore.getState().future).toHaveLength(0);
  });
});

// ── Copy / paste ───────────────────────────────────────────────────────────

describe("store: copyArea / pasteArea", () => {
  beforeEach(resetStore);

  it("copyArea stores the area in clipboardArea", () => {
    const area = createRectArea(10, 20, 100, 80);
    useStore.getState().addArea(area);
    useStore.getState().copyArea(area.id);
    const { clipboardArea } = useStore.getState();
    expect(clipboardArea).not.toBeNull();
    expect(clipboardArea!.id).toBe(area.id);
  });

  it("pasteArea creates a new area with a different id and offset", () => {
    const area = createRectArea(10, 20, 100, 80);
    useStore.getState().addArea(area);
    useStore.getState().copyArea(area.id);
    useStore.getState().pasteArea();

    const view = useStore.getState().project.views[0];
    const areas = view.layers.flatMap((l) => l.areas);
    expect(areas).toHaveLength(2);
    const pasted = areas[1];
    expect(pasted.id).not.toBe(area.id);
    expect(pasted.name).toContain("copy");
    if (pasted.geometry.type === "rect" && area.geometry.type === "rect") {
      expect(pasted.geometry.x).toBe(area.geometry.x + 10);
      expect(pasted.geometry.y).toBe(area.geometry.y + 10);
    }
  });

  it("pasteArea selects the pasted area", () => {
    const area = createRectArea(0, 0, 50, 50);
    useStore.getState().addArea(area);
    useStore.getState().copyArea(area.id);
    useStore.getState().pasteArea();
    const { selectedAreaId } = useStore.getState();
    const view = useStore.getState().project.views[0];
    const areas = view.layers.flatMap((l) => l.areas);
    expect(selectedAreaId).toBe(areas[1].id);
  });

  it("pasteArea is undoable", () => {
    const area = createRectArea(0, 0, 50, 50);
    useStore.getState().addArea(area);
    useStore.getState().copyArea(area.id);
    useStore.getState().pasteArea();
    useStore.getState().undo();
    const view = useStore.getState().project.views[0];
    const areas = view.layers.flatMap((l) => l.areas);
    expect(areas).toHaveLength(1);
  });

  it("pasteArea does nothing when clipboard is empty", () => {
    useStore.getState().pasteArea();
    const view = useStore.getState().project.views[0];
    const areas = view.layers.flatMap((l) => l.areas);
    expect(areas).toHaveLength(0);
  });
});
