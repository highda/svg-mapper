import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../store";
import { createNewProject } from "../lib/project";
import { createRectArea, createPolygonArea, moveGeometry } from "../lib/area-utils";
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
