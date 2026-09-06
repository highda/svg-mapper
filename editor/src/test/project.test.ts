import { describe, it, expect } from "vitest";
import {
  createNewProject,
  parseProjectFile,
  serializeProjectFile,
  toDefinition,
} from "../lib/project";

describe("createNewProject", () => {
  it("creates a project with one default view", () => {
    const p = createNewProject("Test Map");
    expect(p.schemaVersion).toBe("1.0.0");
    expect(p.project.name).toBe("Test Map");
    expect(p.views).toHaveLength(1);
    expect(p.settings.initialViewId).toBe(p.views[0].id);
    expect(p.editor).toBeDefined();
  });

  it("uses 'Untitled Map' when no name provided", () => {
    const p = createNewProject();
    expect(p.project.name).toBe("Untitled Map");
  });
});

describe("parseProjectFile", () => {
  it("parses valid JSON back into a ProjectFile", () => {
    const original = createNewProject("Roundtrip");
    const json = JSON.stringify(original);
    const parsed = parseProjectFile(json);
    expect(parsed.project.name).toBe("Roundtrip");
    expect(parsed.views).toHaveLength(1);
  });

  it("accepts a renderer export without editor-only state", () => {
    const exported = toDefinition(createNewProject("Exported"));
    expect(parseProjectFile(JSON.stringify(exported)).editor).toBeUndefined();
  });

  it("throws on missing required fields", () => {
    expect(() => parseProjectFile('{"foo":"bar"}')).toThrow();
    expect(() => parseProjectFile('{"schemaVersion":"1.0.0"}')).toThrow();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseProjectFile("not-json")).toThrow("not valid JSON");
  });

  it.each(["null", "[]", '"map"'])("rejects a non-object root: %s", (json) => {
    expect(() => parseProjectFile(json)).toThrow("at $");
  });

  it("rejects unsupported versions and reports the field path", () => {
    const project = createNewProject();
    expect(() => parseProjectFile(JSON.stringify({ ...project, schemaVersion: "2.0.0" }))).toThrow(
      "$.schemaVersion",
    );
  });

  it("rejects missing and wrong nested fields with precise paths", () => {
    const missingSettings = createNewProject();
    Reflect.deleteProperty(missingSettings, "settings");
    expect(() => parseProjectFile(JSON.stringify(missingSettings))).toThrow("$.settings");

    const wrongGeometry = createNewProject();
    wrongGeometry.views[0]!.layers = [
      {
        id: "layer",
        name: "Layer",
        visible: true,
        locked: false,
        opacity: 1,
        areas: [
          {
            id: "area",
            name: "Area",
            geometry: { type: "rect", x: 0, y: 0, width: Number.NaN, height: 10 },
            style: {
              default: { fill: "red", stroke: "red", strokeWidth: 1 },
              hover: { fill: "red", stroke: "red", strokeWidth: 1 },
              active: { fill: "red", stroke: "red", strokeWidth: 1 },
            },
            action: { type: "none" },
          },
        ],
      },
    ];
    const serialized = JSON.stringify(wrongGeometry).replace('"width":null', '"width":"wide"');
    expect(() => parseProjectFile(serialized)).toThrow(
      "$.views[0].layers[0].areas[0].geometry.width",
    );
  });

  it("validates discriminated actions without rejecting repairable references", () => {
    const project = createNewProject();
    project.views[0]!.layers = [
      {
        id: "layer",
        name: "Layer",
        visible: true,
        locked: false,
        opacity: 1,
        areas: [
          {
            id: "area",
            name: "Area",
            geometry: { type: "circle", cx: 2, cy: 2, r: 1 },
            style: {
              default: { fill: "red", stroke: "red", strokeWidth: 1 },
              hover: { fill: "red", stroke: "red", strokeWidth: 1 },
              active: { fill: "red", stroke: "red", strokeWidth: 1 },
            },
            action: { type: "goToView", targetViewId: "missing-view" },
          },
        ],
      },
    ];
    expect(parseProjectFile(JSON.stringify(project)).views[0]!.layers[0]!.areas[0]!.action).toEqual(
      { type: "goToView", targetViewId: "missing-view" },
    );
    const invalid = JSON.stringify(project).replace('"type":"goToView"', '"type":"teleport"');
    expect(() => parseProjectFile(invalid)).toThrow(".action.type");
  });

  it("rejects non-finite/out-of-range numbers and malformed data URIs", () => {
    const project = createNewProject();
    project.views[0]!.layers = [
      { id: "layer", name: "Layer", visible: true, locked: false, opacity: 2, areas: [] },
    ];
    expect(() => parseProjectFile(JSON.stringify(project))).toThrow("$.views[0].layers[0].opacity");
    project.views[0]!.layers = [];
    project.assets.push({
      id: "bad",
      name: "Bad",
      type: "image/png",
      src: "data:image/png;base64,%",
      width: 1,
      height: 1,
      inline: true,
    });
    expect(() => parseProjectFile(JSON.stringify(project))).toThrow("$.assets[0].src");
  });
});

describe("serializeProjectFile / round-trip", () => {
  it("serializes to valid JSON that parses back identically", () => {
    const p = createNewProject("Save Test");
    const json = serializeProjectFile(p);
    const parsed = parseProjectFile(json);
    expect(parsed.project.name).toBe("Save Test");
    expect(parsed.views[0].id).toBe(p.views[0].id);
  });

  it("updates updatedAt on serialize", () => {
    const p = createNewProject();
    const before = p.project.updatedAt;
    // Ensure time changes
    const json = serializeProjectFile(p);
    const parsed = parseProjectFile(json);
    // updatedAt is >= original
    expect(new Date(parsed.project.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
  });
});

describe("toDefinition", () => {
  it("strips editor-only fields from the exported definition", () => {
    const p = createNewProject();
    const def = toDefinition(p);
    expect("editor" in def).toBe(false);
    expect(def.schemaVersion).toBe("1.0.0");
  });
});
