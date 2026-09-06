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
