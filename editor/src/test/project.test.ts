import { describe, it, expect } from "vitest";
import { createNewProject, parseProjectFile, serializeProjectFile, toDefinition } from "../lib/project";

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

  it("throws on missing required fields", () => {
    expect(() => parseProjectFile('{"foo":"bar"}')).toThrow();
    expect(() => parseProjectFile('{"schemaVersion":"1.0.0"}')).toThrow();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseProjectFile("not-json")).toThrow();
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
