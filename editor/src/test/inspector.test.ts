import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../store";
import { createNewProject } from "../lib/project";
import { createRectArea } from "../lib/area-utils";

function resetStore() {
  const p = createNewProject();
  useStore.setState({
    project: p,
    activeViewId: p.views[0].id,
    selectedAreaId: null,
    selectedLayerId: null,
    activeTool: "select",
    past: [],
    future: [],
  });
}

// ── View CRUD ──────────────────────────────────────────────────────────────

describe("store: addView", () => {
  beforeEach(resetStore);

  it("adds a new view and switches to it", () => {
    useStore.getState().addView();
    const { project, activeViewId } = useStore.getState();
    expect(project.views).toHaveLength(2);
    expect(activeViewId).toBe(project.views[1].id);
  });

  it("pushes to undo history", () => {
    useStore.getState().addView();
    expect(useStore.getState().past).toHaveLength(1);
  });
});

describe("store: renameView", () => {
  beforeEach(resetStore);

  it("renames a view", () => {
    const { project } = useStore.getState();
    const viewId = project.views[0].id;
    useStore.getState().renameView(viewId, "Floor Plan");
    expect(useStore.getState().project.views[0].name).toBe("Floor Plan");
  });

  it("is undoable", () => {
    const { project } = useStore.getState();
    const viewId = project.views[0].id;
    const original = project.views[0].name;
    useStore.getState().renameView(viewId, "Renamed");
    useStore.getState().undo();
    expect(useStore.getState().project.views[0].name).toBe(original);
  });
});

describe("store: deleteView", () => {
  beforeEach(resetStore);

  it("does not delete the last remaining view", () => {
    const viewId = useStore.getState().project.views[0].id;
    useStore.getState().deleteView(viewId);
    expect(useStore.getState().project.views).toHaveLength(1);
  });

  it("deletes a view when more than one exists", () => {
    useStore.getState().addView();
    const { project } = useStore.getState();
    const secondId = project.views[1].id;
    useStore.getState().deleteView(secondId);
    expect(useStore.getState().project.views).toHaveLength(1);
  });

  it("switches activeViewId when active view is deleted", () => {
    useStore.getState().addView();
    const { activeViewId } = useStore.getState();
    useStore.getState().deleteView(activeViewId);
    const { activeViewId: newId, project: p } = useStore.getState();
    expect(p.views.some((v) => v.id === newId)).toBe(true);
  });
});

describe("store: setCanvasSize", () => {
  beforeEach(resetStore);

  it("updates the shared canvas size for all views", () => {
    useStore.getState().setCanvasSize(1280, 720);
    const { canvasSize } = useStore.getState().project.settings;
    expect(canvasSize.width).toBe(1280);
    expect(canvasSize.height).toBe(720);
  });
});

describe("store: setViewport", () => {
  beforeEach(resetStore);

  it("patches viewport properties", () => {
    const { project } = useStore.getState();
    const viewId = project.views[0].id;
    useStore.getState().setViewport(viewId, { panEnabled: false, maxZoom: 6 });
    const vp = useStore.getState().project.views[0].viewport;
    expect(vp.panEnabled).toBe(false);
    expect(vp.maxZoom).toBe(6);
  });
});

// ── Layer CRUD ─────────────────────────────────────────────────────────────

describe("store: addLayer", () => {
  beforeEach(resetStore);

  it("adds a layer to the specified view", () => {
    const { project } = useStore.getState();
    const viewId = project.views[0].id;
    useStore.getState().addLayer(viewId);
    expect(useStore.getState().project.views[0].layers).toHaveLength(1);
  });

  it("sets selectedLayerId to the new layer", () => {
    const { project } = useStore.getState();
    useStore.getState().addLayer(project.views[0].id);
    const { selectedLayerId, project: p } = useStore.getState();
    expect(selectedLayerId).toBe(p.views[0].layers[0].id);
  });

  it("is undoable", () => {
    const { project } = useStore.getState();
    useStore.getState().addLayer(project.views[0].id);
    useStore.getState().undo();
    expect(useStore.getState().project.views[0].layers).toHaveLength(0);
  });
});

describe("store: renameLayer", () => {
  beforeEach(resetStore);

  it("renames an existing layer", () => {
    const { project } = useStore.getState();
    useStore.getState().addLayer(project.views[0].id);
    const layerId = useStore.getState().project.views[0].layers[0].id;
    useStore.getState().renameLayer(layerId, "Annotations");
    expect(useStore.getState().project.views[0].layers[0].name).toBe("Annotations");
  });
});

describe("store: deleteLayer", () => {
  beforeEach(resetStore);

  it("does not delete the only layer", () => {
    const { project } = useStore.getState();
    useStore.getState().addLayer(project.views[0].id);
    const layerId = useStore.getState().project.views[0].layers[0].id;
    useStore.getState().deleteLayer(layerId);
    expect(useStore.getState().project.views[0].layers).toHaveLength(1);
  });

  it("deletes a layer when more than one exists", () => {
    const { project } = useStore.getState();
    const viewId = project.views[0].id;
    useStore.getState().addLayer(viewId);
    useStore.getState().addLayer(viewId);
    const firstId = useStore.getState().project.views[0].layers[0].id;
    useStore.getState().deleteLayer(firstId);
    expect(useStore.getState().project.views[0].layers).toHaveLength(1);
  });
});

describe("store: toggleLayerVisibility", () => {
  beforeEach(resetStore);

  it("toggles layer visibility", () => {
    const { project } = useStore.getState();
    useStore.getState().addLayer(project.views[0].id);
    const layerId = useStore.getState().project.views[0].layers[0].id;
    expect(useStore.getState().project.views[0].layers[0].visible).toBe(true);
    useStore.getState().toggleLayerVisibility(layerId);
    expect(useStore.getState().project.views[0].layers[0].visible).toBe(false);
  });
});

describe("store: toggleLayerLock", () => {
  beforeEach(resetStore);

  it("toggles layer lock", () => {
    const { project } = useStore.getState();
    useStore.getState().addLayer(project.views[0].id);
    const layerId = useStore.getState().project.views[0].layers[0].id;
    useStore.getState().toggleLayerLock(layerId);
    expect(useStore.getState().project.views[0].layers[0].locked).toBe(true);
  });
});

describe("store: setLayerOpacity", () => {
  beforeEach(resetStore);

  it("sets opacity and clamps to [0, 1]", () => {
    const { project } = useStore.getState();
    useStore.getState().addLayer(project.views[0].id);
    const layerId = useStore.getState().project.views[0].layers[0].id;
    useStore.getState().setLayerOpacity(layerId, 0.5);
    expect(useStore.getState().project.views[0].layers[0].opacity).toBe(0.5);
    useStore.getState().setLayerOpacity(layerId, 1.5);
    expect(useStore.getState().project.views[0].layers[0].opacity).toBe(1);
    useStore.getState().setLayerOpacity(layerId, -0.5);
    expect(useStore.getState().project.views[0].layers[0].opacity).toBe(0);
  });
});

describe("store: reorderLayer", () => {
  beforeEach(resetStore);

  it("moves a layer from one index to another", () => {
    const { project } = useStore.getState();
    const viewId = project.views[0].id;
    useStore.getState().addLayer(viewId);
    useStore.getState().addLayer(viewId);
    const layers0 = useStore.getState().project.views[0].layers;
    const firstId = layers0[0].id;
    const secondId = layers0[1].id;
    useStore.getState().reorderLayer(viewId, 0, 1);
    const layers1 = useStore.getState().project.views[0].layers;
    expect(layers1[0].id).toBe(secondId);
    expect(layers1[1].id).toBe(firstId);
  });

  it("no-op when fromIdx equals toIdx", () => {
    const { project } = useStore.getState();
    const viewId = project.views[0].id;
    useStore.getState().addLayer(viewId);
    const before = useStore.getState().project.views[0].layers[0].id;
    useStore.getState().reorderLayer(viewId, 0, 0);
    expect(useStore.getState().project.views[0].layers[0].id).toBe(before);
  });
});

// ── Area property updates ──────────────────────────────────────────────────

describe("store: renameArea", () => {
  beforeEach(resetStore);

  it("renames an area", () => {
    const area = createRectArea(0, 0, 100, 100);
    useStore.getState().addArea(area);
    useStore.getState().renameArea(area.id, "Main Building");
    const loc = useStore.getState().project.views[0].layers[0].areas[0];
    expect(loc.name).toBe("Main Building");
  });

  it("is undoable", () => {
    const area = createRectArea(0, 0, 100, 100);
    useStore.getState().addArea(area);
    const originalName = area.name;
    useStore.getState().renameArea(area.id, "Renamed");
    useStore.getState().undo();
    const loc = useStore.getState().project.views[0].layers[0].areas[0];
    expect(loc.name).toBe(originalName);
  });
});

describe("store: updateAreaAction", () => {
  beforeEach(resetStore);

  it("sets a URL action", () => {
    const area = createRectArea(0, 0, 100, 100);
    useStore.getState().addArea(area);
    useStore.getState().updateAreaAction(area.id, { type: "url", href: "https://example.com", target: "_blank" });
    const saved = useStore.getState().project.views[0].layers[0].areas[0].action;
    expect(saved.type).toBe("url");
    if (saved.type === "url") expect(saved.href).toBe("https://example.com");
  });
});

describe("store: updateAreaTooltip", () => {
  beforeEach(resetStore);

  it("sets tooltip content", () => {
    const area = createRectArea(0, 0, 100, 100);
    useStore.getState().addArea(area);
    useStore.getState().updateAreaTooltip(area.id, { enabled: true, title: "Hi", body: "World" });
    const saved = useStore.getState().project.views[0].layers[0].areas[0].tooltip;
    expect(saved?.enabled).toBe(true);
    expect(saved?.title).toBe("Hi");
  });
});

describe("store: area data and content template", () => {
  beforeEach(resetStore);

  it("persists metadata values on an area", () => {
    const area = createRectArea(0, 0, 100, 100);
    useStore.getState().addArea(area);
    useStore.getState().updateAreaMetadata(area.id, { price: "12", category: "retail" });
    expect(useStore.getState().project.views[0].layers[0].areas[0].metadata).toEqual({
      price: "12",
      category: "retail",
    });
  });

  it("stores a project content template", () => {
    useStore.getState().updateSettings({ contentTemplate: "<b>{{name}}</b>" });
    expect(useStore.getState().project.settings.contentTemplate).toBe("<b>{{name}}</b>");
  });
});

// ── Selection mutual exclusion ─────────────────────────────────────────────

describe("store: selection mutual exclusion", () => {
  beforeEach(resetStore);

  it("setting selectedAreaId clears selectedLayerId", () => {
    const { project } = useStore.getState();
    useStore.getState().addLayer(project.views[0].id);
    const layerId = useStore.getState().project.views[0].layers[0].id;
    useStore.getState().setSelectedLayerId(layerId);
    expect(useStore.getState().selectedLayerId).toBe(layerId);
    // Add an area, then select it
    const area = createRectArea(0, 0, 50, 50);
    useStore.getState().addArea(area);
    useStore.getState().setSelectedAreaId(area.id);
    expect(useStore.getState().selectedAreaId).toBe(area.id);
    expect(useStore.getState().selectedLayerId).toBeNull();
  });

  it("setting selectedLayerId clears selectedAreaId", () => {
    const area = createRectArea(0, 0, 50, 50);
    useStore.getState().addArea(area);
    useStore.getState().setSelectedAreaId(area.id);
    const { project } = useStore.getState();
    useStore.getState().addLayer(project.views[0].id);
    const layerId = useStore.getState().project.views[0].layers[1]?.id
      ?? useStore.getState().project.views[0].layers[0].id;
    useStore.getState().setSelectedLayerId(layerId);
    expect(useStore.getState().selectedLayerId).toBeTruthy();
    expect(useStore.getState().selectedAreaId).toBeNull();
  });
});
