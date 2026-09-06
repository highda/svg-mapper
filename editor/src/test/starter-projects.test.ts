import { describe, expect, it } from "vitest";
import { validateProject } from "@svg-mapper/shared";
import { createStarterProject, STARTER_PROJECTS } from "../lib/starter-projects";

describe("starter projects", () => {
  it.each(STARTER_PROJECTS)("creates an editable, export-valid $name sample", ({ id }) => {
    const sample = createStarterProject(id);
    expect(validateProject(sample).filter((result) => result.severity === "error")).toEqual([]);
    expect(sample.assets.every((asset) => asset.inline && asset.type === "image/svg+xml")).toBe(true);
    expect(sample.views.every((view) => view.layers[0].areas.length >= 2)).toBe(true);
    expect(sample.views.flatMap((view) => view.layers[0].areas).every((area) => area.accessibility?.ariaLabel)).toBe(true);
  });
});
