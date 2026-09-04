import { describe, expect, it } from "vitest";
import type { ClickMapDefinition } from "@svg-mapper/shared";
import { validateProject } from "@svg-mapper/shared";
import fitAndActionsJson from "../../../examples/qa-gallery/fixtures/fit-and-actions.json?raw";
import externalAndBrokenJson from "../../../examples/qa-gallery/fixtures/external-and-broken.json?raw";

function fixture(name: string): ClickMapDefinition {
  const source = name === "fit-and-actions.json" ? fitAndActionsJson : externalAndBrokenJson;
  return JSON.parse(source) as ClickMapDefinition;
}

describe("canonical QA fixtures", () => {
  it("keeps every current background fit, geometry, and action represented", () => {
    const project = fixture("fit-and-actions.json");
    const areas = project.views.flatMap((view) =>
      view.layers.flatMap((layer) => layer.areas),
    );

    expect(new Set(project.views.map((view) => view.background?.fit))).toEqual(
      new Set(["contain", "cover", "fill", "none"]),
    );
    expect(new Set(areas.map((area) => area.geometry.type))).toEqual(
      new Set(["rect", "circle", "polygon", "path", "marker"]),
    );
    expect(new Set(areas.map((area) => area.action.type))).toEqual(
      new Set(["none", "url", "goToView", "popup", "toggleLayer", "customEvent"]),
    );
    expect(project.assets.every((asset) => asset.inline)).toBe(true);
    expect(validateProject(project).filter((result) => result.severity === "error")).toEqual([]);
  });

  it("keeps mixed-aspect external and intentionally broken assets represented", () => {
    const project = fixture("external-and-broken.json");
    const dimensions = project.assets.map((asset) => [asset.width, asset.height]);
    const errors = validateProject(project).filter((result) => result.severity === "error");

    expect(project.assets.every((asset) => !asset.inline)).toBe(true);
    expect(dimensions.some(([width, height]) => width > height)).toBe(true);
    expect(dimensions.some(([width, height]) => height > width)).toBe(true);
    expect(project.assets.some((asset) => asset.src.includes("intentionally-missing"))).toBe(true);
    expect(errors.map((result) => result.code)).toContain("MISSING_ASSET");
  });
});
