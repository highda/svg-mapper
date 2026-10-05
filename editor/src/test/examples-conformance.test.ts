import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { decodeDefinition, validateProject, type ClickMapDefinition } from "@svg-mapper/shared";
import { EXPECTED_SEMANTIC_ERRORS, REPO_ROOT, exampleMaps, relativeAssetSources } from "./example-maps";

// Conformance of the hand-authored maps in examples/ (#197): each one is what a
// renderer-only integrator would write, so it must pass the published JSON
// Schema, the runtime decoder, and the builder's semantic validation. The
// browser half lives in e2e/renderer-standalone.spec.ts.

const schema = JSON.parse(readFileSync(join(REPO_ROOT, "shared/schema/clickmap-definition.schema.json"), "utf8")) as object;
const validate = new Ajv({ allErrors: true, strict: true, strictTuples: false }).compile(schema);
const maps = exampleMaps();

describe("hand-authored example maps", () => {
  it("are discovered, including the minimal and campus examples", () => {
    const paths = maps.map((map) => map.path);
    expect(paths).toEqual(expect.arrayContaining(["examples/minimal/map.json", "examples/campus/map.json"]));
    for (const path of Object.keys(EXPECTED_SEMANTIC_ERRORS)) expect(paths).toContain(path);
  });

  it.each(maps.map((map) => [map.path, map] as const))("%s passes schema, decoder and semantic checks", (path, map) => {
    const value: unknown = JSON.parse(map.text);

    expect(validate(value) ? [] : validate.errors).toEqual([]);
    const decoded = decodeDefinition(value);
    expect(decoded).toMatchObject({ ok: true });

    const definition = value as ClickMapDefinition;
    const errors = validateProject(definition).filter((result) => result.severity === "error");
    const expected = EXPECTED_SEMANTIC_ERRORS[path];
    if (expected) {
      // Deliberately broken QA fixture: exactly the documented failures.
      expect([...new Set(errors.map((error) => error.code))].sort()).toEqual([...expected].sort());
      return;
    }
    expect(errors.map((error) => `${error.code}: ${error.message}`)).toEqual([]);

    // Relative asset files ship beside the map's host page.
    for (const src of relativeAssetSources(definition)) {
      expect(existsSync(join(REPO_ROOT, map.assetBase, src)), `${map.assetBase}${src}`).toBe(true);
    }
  });
});

describe("docs/renderer-standalone.md", () => {
  const guide = readFileSync(join(REPO_ROOT, "docs/renderer-standalone.md"), "utf8");
  const blocks = (lang: string) =>
    [...guide.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map((match) => match[1]!);

  it("shows examples/minimal/map.json verbatim", () => {
    const file = readFileSync(join(REPO_ROOT, "examples/minimal/map.json"), "utf8");
    expect(blocks("json")).toContain(file);
  });

  it("shows examples/minimal/index.html verbatim", () => {
    const file = readFileSync(join(REPO_ROOT, "examples/minimal/index.html"), "utf8");
    expect(blocks("html")).toContain(file);
  });
});
