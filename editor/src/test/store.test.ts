import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../store";
import { serializeProjectFile, createNewProject } from "../lib/project";
import { createRectArea } from "../lib/area-utils";

function resetStore() {
  const project = createNewProject();
  useStore.setState({ project, activeViewId: project.views[0]!.id, openError: null, screen: "design", selectedAreaId: null, selectedAreaIds: [] });
}

describe("store: multi-selection", () => {
  beforeEach(resetStore);

  it("toggles additive area selection while keeping the last selected area primary", () => {
    const store = useStore.getState();
    store.setSelectedAreaId("area_one");
    useStore.getState().toggleSelectedAreaId("area_two");
    expect(useStore.getState().selectedAreaIds).toEqual(["area_one", "area_two"]);
    expect(useStore.getState().selectedAreaId).toBe("area_two");

    useStore.getState().toggleSelectedAreaId("area_two");
    expect(useStore.getState().selectedAreaIds).toEqual(["area_one"]);
    expect(useStore.getState().selectedAreaId).toBe("area_one");
  });

  it("clears all selected areas when a layer is selected", () => {
    useStore.getState().setSelectedAreaId("area_one");
    useStore.getState().toggleSelectedAreaId("area_two");
    useStore.getState().setSelectedLayerId("layer_one");
    expect(useStore.getState().selectedAreaIds).toEqual([]);
    expect(useStore.getState().selectedAreaId).toBeNull();
  });

  it("replaces selection with unique ordered ids and makes the last primary", () => {
    useStore.getState().setSelectedAreaIds(["area_one", "area_two", "area_one"]);
    expect(useStore.getState().selectedAreaIds).toEqual(["area_one", "area_two"]);
    expect(useStore.getState().selectedAreaId).toBe("area_two");

    useStore.getState().setSelectedAreaIds([]);
    expect(useStore.getState().selectedAreaId).toBeNull();
  });

  it("applies common style and action fields to many areas as one undo step", () => {
    const first = createRectArea(10, 20, 80, 60);
    const second = createRectArea(100, 120, 80, 60);
    second.name = "Second";
    second.metadata = { seat: "B2" };
    useStore.getState().addArea(first);
    useStore.getState().addArea(second);
    useStore.setState({ past: [], future: [] });

    const style = { ...first.style, default: { ...first.style.default, fill: "#ff0000" } };
    const action = { type: "customEvent", eventName: "seat:selected" } as const;
    useStore.getState().updateAreas([first.id, second.id, second.id], { style, action });

    const areas = useStore.getState().project.views[0]!.layers[0]!.areas;
    expect(areas.map((area) => area.style.default.fill)).toEqual(["#ff0000", "#ff0000"]);
    expect(areas.map((area) => area.action)).toEqual([action, action]);
    expect(areas[1]!.name).toBe("Second");
    expect(areas[1]!.geometry).toEqual({ type: "rect", x: 100, y: 120, width: 80, height: 60 });
    expect(areas[1]!.metadata).toEqual({ seat: "B2" });
    expect(useStore.getState().past).toHaveLength(1);

    useStore.getState().undo();
    expect(useStore.getState().project.views[0]!.layers[0]!.areas[1]!.style.default.fill).not.toBe("#ff0000");
  });

  it("applies named styles once or keeps areas linked to preset updates", () => {
    const first = createRectArea(10, 20, 80, 60);
    const second = createRectArea(100, 120, 80, 60);
    useStore.getState().addArea(first);
    useStore.getState().addArea(second);
    useStore.setState({ past: [], future: [] });

    const blue = { ...first.style, default: { ...first.style.default, fill: "#2563eb" } };
    const id = useStore.getState().createSharedStyle("Seats", blue);
    useStore.getState().applySharedStyle([first.id], id, false);
    useStore.getState().applySharedStyle([second.id], id, true);

    let areas = useStore.getState().project.views[0]!.layers[0]!.areas;
    expect(areas[0]!.sharedStyleId).toBeUndefined();
    expect(areas[1]!.sharedStyleId).toBe(id);

    const red = { ...blue, default: { ...blue.default, fill: "#dc2626" } };
    useStore.getState().updateSharedStyle(id, "Priority seats", red);
    areas = useStore.getState().project.views[0]!.layers[0]!.areas;
    expect(areas[0]!.style.default.fill).toBe("#2563eb");
    expect(areas[1]!.style.default.fill).toBe("#dc2626");

    useStore.getState().undo();
    expect(useStore.getState().project.sharedStyles[id]!.name).toBe("Seats");
    expect(useStore.getState().project.views[0]!.layers[0]!.areas[1]!.style.default.fill).toBe("#2563eb");
  });

  it("aligns, distributes, moves, and duplicates a selection as atomic operations", () => {
    const areas = [
      createRectArea(10, 20, 20, 10),
      createRectArea(80, 60, 20, 10),
      createRectArea(170, 100, 20, 10),
    ];
    areas.forEach((area) => useStore.getState().addArea(area));
    useStore.setState({ past: [], future: [], selectedAreaId: areas[1]!.id, selectedAreaIds: areas.map(({ id }) => id) });

    useStore.getState().alignAreas(areas.map(({ id }) => id), "middle");
    let geometries = useStore.getState().project.views[0]!.layers[0]!.areas.map(({ geometry }) => geometry);
    expect(geometries.map((geometry) => geometry.type === "rect" ? geometry.y : -1)).toEqual([60, 60, 60]);
    expect(useStore.getState().past).toHaveLength(1);

    useStore.getState().undo();
    useStore.getState().setSelectedAreaIds(areas.map(({ id }) => id));
    useStore.getState().distributeAreas(areas.map(({ id }) => id), "horizontal");
    geometries = useStore.getState().project.views[0]!.layers[0]!.areas.map(({ geometry }) => geometry);
    expect(geometries.map((geometry) => geometry.type === "rect" ? geometry.x : -1)).toEqual([10, 90, 170]);

    useStore.getState().moveAreas(areas.map(({ id }) => id), 5, -5);
    geometries = useStore.getState().project.views[0]!.layers[0]!.areas.map(({ geometry }) => geometry);
    expect(geometries.map((geometry) => geometry.type === "rect" ? geometry.x : -1)).toEqual([15, 95, 175]);

    useStore.getState().duplicateAreas(areas.map(({ id }) => id));
    const duplicated = useStore.getState().project.views[0]!.layers[0]!.areas;
    expect(duplicated).toHaveLength(6);
    expect(new Set(duplicated.map(({ id }) => id)).size).toBe(6);
    expect(useStore.getState().selectedAreaIds).toHaveLength(3);
    expect(duplicated.filter(({ name }) => name.endsWith(" copy"))).toHaveLength(3);
  });

  it("leaves areas in locked layers unchanged during group geometry operations", () => {
    const movable = createRectArea(10, 10, 20, 20);
    const locked = createRectArea(50, 50, 20, 20);
    useStore.getState().addArea(movable);
    useStore.setState((state) => ({
      project: {
        ...state.project,
        views: [{
          ...state.project.views[0]!,
          layers: [state.project.views[0]!.layers[0]!, {
            id: "locked_layer", name: "Locked", visible: true, locked: true, opacity: 1, areas: [locked],
          }],
        }],
      },
      past: [], future: [],
    }));

    useStore.getState().moveAreas([movable.id, locked.id], 20, 20);
    expect(useStore.getState().project.views[0]!.layers[0]!.areas[0]!.geometry).toMatchObject({ x: 30, y: 30 });
    expect(useStore.getState().project.views[0]!.layers[1]!.areas[0]!.geometry).toMatchObject({ x: 50, y: 50 });
    useStore.getState().duplicateAreas([movable.id, locked.id]);
    expect(useStore.getState().project.views[0]!.layers[0]!.areas).toHaveLength(2);
    expect(useStore.getState().project.views[0]!.layers[1]!.areas).toHaveLength(1);
  });

  it("copies a styled area across views and preserves it through save/open", () => {
    const source = createRectArea(12, 34, 56, 78);
    source.style = { ...source.style, default: { ...source.style.default, fill: "#7c3aed" } };
    source.metadata = { section: "A" };
    useStore.getState().addArea(source);
    useStore.getState().copyArea(source.id);
    useStore.getState().addView();
    const targetViewId = useStore.getState().activeViewId;
    useStore.getState().addLayer(targetViewId);
    useStore.getState().pasteArea();

    const pasted = useStore.getState().project.views[1]!.layers[0]!.areas[0]!;
    expect(pasted.id).not.toBe(source.id);
    expect(pasted.style.default.fill).toBe("#7c3aed");
    expect(pasted.metadata).toEqual({ section: "A" });

    const serialized = serializeProjectFile(useStore.getState().project);
    useStore.getState().newProject();
    useStore.getState().loadProject(serialized);
    expect(useStore.getState().project.views[1]!.layers[0]!.areas[0]).toMatchObject({
      id: pasted.id,
      metadata: { section: "A" },
    });
  });
});

describe("store: newProject", () => {
  beforeEach(resetStore);

  it("resets to a fresh project with one view", () => {
    useStore.getState().setProjectName("Old Name");
    useStore.getState().newProject();
    const { project } = useStore.getState();
    expect(project.project.name).toBe("Untitled Map");
    expect(project.views).toHaveLength(1);
  });
});

describe("store: loadProject", () => {
  beforeEach(resetStore);

  it("loads a valid JSON project file", () => {
    const p = createNewProject("Loaded Project");
    const json = serializeProjectFile(p);
    useStore.getState().loadProject(json);
    expect(useStore.getState().project.project.name).toBe("Loaded Project");
    expect(useStore.getState().openError).toBeNull();
  });

  it("sets openError on corrupt JSON", () => {
    useStore.getState().loadProject("not-json");
    expect(useStore.getState().openError).toBeTruthy();
  });

  it("sets openError on missing required fields", () => {
    const before = useStore.getState();
    before.setProjectName("Keep me");
    before.setSelectedAreaId("selection");
    useStore.setState({
      past: [createNewProject("History")],
      future: [createNewProject("Future")],
    });
    useStore.getState().loadProject('{"foo":"bar"}');
    const after = useStore.getState();
    expect(after.openError).toContain("$.schemaVersion");
    expect(after.project.project.name).toBe("Keep me");
    expect(after.selectedAreaId).toBe("selection");
    expect(after.past).toHaveLength(1);
    expect(after.future).toHaveLength(1);
  });
});

describe("store: setProjectName", () => {
  beforeEach(resetStore);

  it("updates the project name in place", () => {
    useStore.getState().setProjectName("Renamed");
    expect(useStore.getState().project.project.name).toBe("Renamed");
  });
});

describe("store: clearOpenError", () => {
  beforeEach(resetStore);

  it("clears an existing error", () => {
    useStore.getState().loadProject("bad json");
    expect(useStore.getState().openError).toBeTruthy();
    useStore.getState().clearOpenError();
    expect(useStore.getState().openError).toBeNull();
  });

  it("reports file read failures without replacing the document", () => {
    const project = useStore.getState().project;
    useStore.getState().reportOpenError("Could not read the selected project file.");
    expect(useStore.getState().openError).toBe("Could not read the selected project file.");
    expect(useStore.getState().project).toBe(project);
  });
});
