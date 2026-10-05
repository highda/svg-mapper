import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import {
  CURRENT_SCHEMA_VERSION,
  decodeDefinition,
  type ClickMapDefinition,
} from "@svg-mapper/shared";
import schemaJson from "../../../shared/schema/clickmap-definition.schema.json?raw";
import campusJson from "../../../examples/campus/map.json?raw";
import fitAndActionsJson from "../../../examples/qa-gallery/fixtures/fit-and-actions.json?raw";
import externalAndBrokenJson from "../../../examples/qa-gallery/fixtures/external-and-broken.json?raw";
import { alphaBytesToHitMask } from "../lib/alpha-mask";
import { createRectArea } from "../lib/area-utils";
import { createNewProject, toDefinition } from "../lib/project";
import { STARTER_PROJECTS, createStarterProject } from "../lib/starter-projects";

// The published JSON Schema (#196) is generated from the Valibot schema that
// the renderer and editor decode with; `npm run schema:check --prefix shared`
// guards the file against drift. These tests pin what the contract means to a
// producer that only has the JSON Schema.

const schema = JSON.parse(schemaJson) as Record<string, unknown>;
// strictTuples off: like the decoder, polygon points tolerate trailing items.
const ajv = new Ajv({ allErrors: true, strict: true, strictTuples: false });
const validate = ajv.compile(schema);

function errorsOf(value: unknown): string[] {
  return validate(value) ? [] : (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`);
}

const shipped: Record<string, string> = {
  "examples/campus/map.json": campusJson,
  "examples/qa-gallery/fixtures/fit-and-actions.json": fitAndActionsJson,
  "examples/qa-gallery/fixtures/external-and-broken.json": externalAndBrokenJson,
};

function sample(mutate?: (def: ClickMapDefinition) => void): ClickMapDefinition {
  const project = createNewProject();
  const area = { ...createRectArea(0, 0, 16, 8), id: "area_a", name: "A" };
  project.views[0]!.layers = [{ id: "layer_a", name: "L", visible: true, locked: false, opacity: 1, areas: [area] }];
  const def = structuredClone(toDefinition(project));
  mutate?.(def);
  return def;
}

describe("published JSON Schema", () => {
  it("is a draft-07 schema describing the current version", () => {
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(String(schema.description)).toContain(`schemaVersion ${CURRENT_SCHEMA_VERSION}`);
    expect(String(schema.$comment)).toContain("validateProject");
  });

  it.each(Object.keys(shipped))("validates the shipped %s", (name) => {
    const value: unknown = JSON.parse(shipped[name]!);
    expect(errorsOf(value)).toEqual([]);
    expect(decodeDefinition(value).ok).toBe(true);
  });

  it.each(STARTER_PROJECTS.map((starter) => starter.id))("validates the exported %s starter", (id) => {
    expect(errorsOf(toDefinition(createStarterProject(id)))).toEqual([]);
  });

  it("validates a new project and an editor project file with its editor block", () => {
    const project = createNewProject();
    expect(errorsOf(project)).toEqual([]);
    expect(errorsOf(toDefinition(project))).toEqual([]);
  });

  it("fails a deliberately malformed file with a path-specific message", () => {
    const malformed = sample((def) => {
      (def.views[0]!.layers[0]!.areas[0]!.geometry as { width: unknown }).width = "wide";
    });
    expect(validate(malformed)).toBe(false);
    expect(validate.errors?.map((error) => error.instancePath)).toContain("/views/0/layers/0/areas/0/geometry/width");
    expect(decodeDefinition(malformed)).toMatchObject({ ok: false, path: "$.views[0].layers[0].areas[0].geometry.width" });
  });

  it("accepts any 1.x.y schemaVersion and rejects other majors", () => {
    expect(errorsOf(sample((def) => { def.schemaVersion = "1.4.2"; }))).toEqual([]);
    for (const version of ["2.0.0", "0.9.0", "1.0", "v1.0.0"]) {
      expect(errorsOf({ ...sample(), schemaVersion: version })).toEqual([expect.stringMatching(/^\/schemaVersion /)]);
    }
  });

  it("allows extension fields, as the decoder does", () => {
    const extended = { ...sample(), "x-cms": { id: 4 } };
    expect(errorsOf(extended)).toEqual([]);
    expect(decodeDefinition(extended).ok).toBe(true);
  });

  it("leaves cross-references to semantic validation", () => {
    const broken = sample((def) => {
      def.settings.initialViewId = "missing";
      def.views[0]!.layers[0]!.areas[0]!.action = { type: "goToView", targetViewId: "missing" };
    });
    expect(errorsOf(broken)).toEqual([]);
    expect(decodeDefinition(broken).ok).toBe(true);
  });

  // Structural verdicts agree between the JSON Schema and the runtime decoder.
  const cases: Array<[string, (def: ClickMapDefinition) => void]> = [
    ["missing settings", (def) => { Reflect.deleteProperty(def, "settings"); }],
    ["negative radius", (def) => { def.views[0]!.layers[0]!.areas[0]!.geometry = { type: "circle", cx: 0, cy: 0, r: -1 }; }],
    ["unknown geometry", (def) => { (def.views[0]!.layers[0]!.areas[0]!.geometry as { type: string }).type = "ellipse"; }],
    ["unknown action", (def) => { (def.views[0]!.layers[0]!.areas[0]!.action as { type: string }).type = "script"; }],
    ["opacity above 1", (def) => { def.views[0]!.layers[0]!.opacity = 1.5; }],
    ["zero canvas", (def) => { def.views[0]!.canvas.width = 0; }],
    ["bad asset type", (def) => { def.assets.push({ id: "a", type: "image/gif" as "image/png", name: "a", src: "a.gif", width: 1, height: 1, inline: false }); }],
    ["bad sizing mode", (def) => { (def.settings as { sizingMode: string }).sizingMode = "stretch"; }],
    ["fractional mask", (def) => {
      const mask = alphaBytesToHitMask("asset", new Uint8ClampedArray(16 * 8 * 4).fill(255), 16, 8, 0.5);
      def.views[0]!.layers[0]!.areas[0]!.image = { assetId: "asset", hitMask: { ...mask, width: 2.5 } };
    }],
    ["valid mask", (def) => {
      const mask = alphaBytesToHitMask("asset", new Uint8ClampedArray(16 * 8 * 4).fill(255), 16, 8, 0.5);
      def.views[0]!.layers[0]!.areas[0]!.image = { assetId: "asset", hitMask: mask };
    }],
    ["popup with all fields", (def) => {
      def.views[0]!.layers[0]!.areas[0]!.action = { type: "popup", content: { title: "t", body: "b", linkHref: "https://x.test", linkLabel: "x" }, position: "top" };
    }],
  ];

  it.each(cases)("agrees with the decoder: %s", (_name, mutate) => {
    const value = sample(mutate);
    expect(validate(value)).toBe(decodeDefinition(value).ok);
  });
});
