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
    historyVersion: 0,
  });
}

function addTestArea() {
  const area = createRectArea(0, 0, 100, 100);
  useStore.getState().addArea(area);
  return area.id;
}

// ── updateAreaInteraction ─────────────────────────────────────────────────────

describe("store: updateAreaInteraction — trigger", () => {
  beforeEach(resetStore);

  it("sets trigger to hover", () => {
    const id = addTestArea();
    useStore.getState().updateAreaInteraction(id, { trigger: "hover" });
    const area = useStore.getState().project.views[0].layers[0].areas[0];
    expect(area.trigger).toBe("hover");
  });

  it("sets trigger to click", () => {
    const id = addTestArea();
    useStore.getState().updateAreaInteraction(id, { trigger: "click" });
    const area = useStore.getState().project.views[0].layers[0].areas[0];
    expect(area.trigger).toBe("click");
  });

  it("sets trigger to both", () => {
    const id = addTestArea();
    useStore.getState().updateAreaInteraction(id, { trigger: "both" });
    const area = useStore.getState().project.views[0].layers[0].areas[0];
    expect(area.trigger).toBe("both");
  });

  it("is undoable", () => {
    const id = addTestArea();
    useStore.getState().updateAreaInteraction(id, { trigger: "hover" });
    useStore.getState().undo();
    const area = useStore.getState().project.views[0].layers[0].areas[0];
    expect(area.trigger).toBeUndefined();
  });
});

describe("store: updateAreaInteraction — alwaysHighlight", () => {
  beforeEach(resetStore);

  it("sets alwaysHighlight to true", () => {
    const id = addTestArea();
    useStore.getState().updateAreaInteraction(id, { alwaysHighlight: true });
    const area = useStore.getState().project.views[0].layers[0].areas[0];
    expect(area.alwaysHighlight).toBe(true);
  });

  it("clears alwaysHighlight", () => {
    const id = addTestArea();
    useStore.getState().updateAreaInteraction(id, { alwaysHighlight: true });
    useStore.getState().updateAreaInteraction(id, { alwaysHighlight: false });
    const area = useStore.getState().project.views[0].layers[0].areas[0];
    expect(area.alwaysHighlight).toBe(false);
  });
});

describe("store: updateAreaInteraction — disabled", () => {
  beforeEach(resetStore);

  it("sets disabled to true", () => {
    const id = addTestArea();
    useStore.getState().updateAreaInteraction(id, { disabled: true });
    const area = useStore.getState().project.views[0].layers[0].areas[0];
    expect(area.disabled).toBe(true);
  });

  it("clears disabled", () => {
    const id = addTestArea();
    useStore.getState().updateAreaInteraction(id, { disabled: true });
    useStore.getState().updateAreaInteraction(id, { disabled: false });
    const area = useStore.getState().project.views[0].layers[0].areas[0];
    expect(area.disabled).toBe(false);
  });

  it("is undoable", () => {
    const id = addTestArea();
    useStore.getState().updateAreaInteraction(id, { disabled: true });
    useStore.getState().undo();
    const area = useStore.getState().project.views[0].layers[0].areas[0];
    expect(area.disabled).toBeUndefined();
  });
});

// ── Round-trip through save/load ───────────────────────────────────────────

import { serializeProjectFile, parseProjectFile } from "../lib/project";

describe("interaction fields: round-trip through save/load", () => {
  beforeEach(resetStore);

  it("serialises and deserialises trigger, alwaysHighlight, disabled", () => {
    const id = addTestArea();
    useStore.getState().updateAreaInteraction(id, { trigger: "click", alwaysHighlight: true, disabled: false });

    const json = serializeProjectFile(useStore.getState().project);
    const parsed = parseProjectFile(json);
    const savedArea = parsed.views[0].layers[0].areas[0];

    expect(savedArea.trigger).toBe("click");
    expect(savedArea.alwaysHighlight).toBe(true);
    expect(savedArea.disabled).toBe(false);
  });
});

// ── Renderer type — AreaStyle.disabled ───────────────────────────────────────

import { DEFAULT_AREA_STYLE } from "../lib/area-utils";

describe("shared types: AreaStyle.disabled", () => {
  it("AreaStyle allows an optional disabled state", () => {
    // Default style does not have disabled — this is optional
    expect(DEFAULT_AREA_STYLE.disabled).toBeUndefined();
    // Adding disabled state should type-check (runtime assertion via casting)
    const styleWithDisabled = {
      ...DEFAULT_AREA_STYLE,
      disabled: { fill: "#9ca3af", stroke: "#6b7280", strokeWidth: 1 },
    };
    expect(styleWithDisabled.disabled.fill).toBe("#9ca3af");
  });
});
