import { describe, it, expect } from "vitest";
import { validateProject, hasBlockingErrors } from "@svg-mapper/shared";
import type { Area, ClickMapDefinition } from "@svg-mapper/shared";
import { createNewProject, toDefinition } from "../lib/project";
import { createRectArea } from "../lib/area-utils";

function baseDef(): ClickMapDefinition {
  return toDefinition(createNewProject());
}

function addAreaToFirstLayer(def: ClickMapDefinition, area: Area) {
  const view = def.views[0];
  if (view.layers.length === 0) {
    view.layers.push({
      id: "layer_1",
      name: "Layer 1",
      visible: true,
      locked: false,
      opacity: 1,
      areas: [],
    });
  }
  view.layers[0].areas.push(area);
}

function codes(def: ClickMapDefinition): string[] {
  return validateProject(def).map((r) => r.code);
}

describe("validateProject — errors", () => {
  it("flags a missing initialViewId", () => {
    const def = baseDef();
    def.settings.initialViewId = "view_does_not_exist";
    const results = validateProject(def);
    expect(results.some((r) => r.code === "BAD_INITIAL_VIEW")).toBe(true);
    expect(hasBlockingErrors(results)).toBe(true);
  });

  it("flags a broken goToView target", () => {
    const def = baseDef();
    const area = createRectArea(0, 0, 50, 50);
    area.action = { type: "goToView", targetViewId: "view_missing" };
    addAreaToFirstLayer(def, area);
    const results = validateProject(def);
    const broken = results.find((r) => r.code === "BROKEN_GOTOVIEW");
    expect(broken).toBeDefined();
    expect(broken!.ref?.areaId).toBe(area.id);
  });

  it("flags a javascript: URL action", () => {
    const def = baseDef();
    const area = createRectArea(0, 0, 50, 50);
    area.action = { type: "url", href: "javascript:alert(1)", target: "_blank" };
    addAreaToFirstLayer(def, area);
    expect(codes(def)).toContain("INVALID_URL");
  });

  it("flags invalid geometry (zero-size rect)", () => {
    const def = baseDef();
    const area = createRectArea(0, 0, 50, 50);
    (area.geometry as { width: number }).width = 0;
    addAreaToFirstLayer(def, area);
    expect(codes(def)).toContain("INVALID_GEOMETRY");
  });

  it("flags duplicate IDs", () => {
    const def = baseDef();
    const a1 = createRectArea(0, 0, 10, 10);
    const a2 = createRectArea(20, 20, 10, 10);
    a2.id = a1.id; // force a duplicate
    addAreaToFirstLayer(def, a1);
    addAreaToFirstLayer(def, a2);
    expect(codes(def)).toContain("DUPLICATE_ID");
  });

  it("flags a missing referenced asset", () => {
    const def = baseDef();
    def.views[0].background = { assetId: "asset_missing", fit: "contain" };
    expect(codes(def)).toContain("MISSING_ASSET");
  });

  it("flags a project with no Views", () => {
    const def = baseDef();
    def.views = [];
    const results = validateProject(def);
    expect(results.some((r) => r.code === "NO_VIEWS")).toBe(true);
  });

  it("flags invalid canvas dimensions on the affected view", () => {
    const def = baseDef();
    def.views[0].canvas.width = 0;
    const result = validateProject(def).find((entry) => entry.code === "INVALID_CANVAS_SIZE");
    expect(result?.ref?.viewId).toBe(def.views[0].id);
  });
});

describe("validateProject — warnings", () => {
  it("warns about an Area with no action", () => {
    const def = baseDef();
    const area = createRectArea(0, 0, 50, 50); // default action is "none"
    addAreaToFirstLayer(def, area);
    const results = validateProject(def);
    expect(results.some((r) => r.code === "AREA_NO_ACTION")).toBe(true);
    expect(hasBlockingErrors(results)).toBe(false);
  });

  it("warns about an unreachable View", () => {
    const def = baseDef();
    def.views.push({
      ...def.views[0],
      id: "view_orphan",
      name: "Orphan",
      slug: "orphan",
      layers: [],
    });
    expect(codes(def)).toContain("UNREACHABLE_VIEW");
  });

  it("warns when a disabled Area retains an action", () => {
    const def = baseDef();
    const area = createRectArea(0, 0, 50, 50);
    area.disabled = true;
    area.action = { type: "url", href: "https://example.com", target: "_blank" };
    addAreaToFirstLayer(def, area);

    const results = validateProject(def);
    const warning = results.find((r) => r.code === "DISABLED_AREA_HAS_ACTION");
    expect(warning).toMatchObject({ severity: "warning", ref: { areaId: area.id } });
    expect(hasBlockingErrors(results)).toBe(false);
  });
});

describe("validateProject — clean project", () => {
  it("returns no results for a fresh single-view project with a linked area", () => {
    const def = baseDef();
    // A fresh project's single View is the initial view and reachable; with no
    // areas there are no warnings either.
    const results = validateProject(def);
    expect(results).toHaveLength(0);
  });
});
