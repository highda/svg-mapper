import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../store";
import { serializeProjectFile, createNewProject } from "../lib/project";

function resetStore() {
  useStore.setState({ project: createNewProject(), openError: null, screen: "design" });
}

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
    useStore.getState().loadProject('{"foo":"bar"}');
    expect(useStore.getState().openError).toBeTruthy();
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
});
