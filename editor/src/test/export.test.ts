import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { generateExportPackage } from "../lib/export-package";
import { createNewProject, toDefinition } from "../lib/project";

const STUB_JS = "/* renderer */";
const STUB_CSS = "/* styles */";

function makePackage(overrides?: {
  inlineAssets?: boolean;
  minifyRenderer?: boolean;
}) {
  const project = createNewProject("Test Map");
  const def = toDefinition(project);
  return {
    pkg: generateExportPackage(def, STUB_JS, STUB_CSS, {
      inlineAssets: overrides?.inlineAssets ?? true,
      minifyRenderer: overrides?.minifyRenderer ?? false,
    }),
    def,
  };
}

describe("generateExportPackage", () => {
  it("returns a valid ZIP containing required files", () => {
    const { pkg } = makePackage();
    expect(pkg.zip).toBeInstanceOf(Uint8Array);
    expect(pkg.zip.length).toBeGreaterThan(0);

    const files = unzipSync(pkg.zip);
    const names = Object.keys(files);

    expect(names).toContain("map.json");
    expect(names).toContain("clickmap-renderer.js");
    expect(names).toContain("clickmap-renderer.css");
    expect(names).toContain("index.html");
    expect(names).toContain("embed.html");
    expect(names).toContain("README.txt");
  });

  it("map.json contains the definition without editor fields", () => {
    const { pkg, def } = makePackage();
    const files = unzipSync(pkg.zip);
    const mapJson = JSON.parse(strFromU8(files["map.json"]!)) as Record<string, unknown>;

    expect(mapJson).not.toHaveProperty("editor");
    expect(mapJson).toHaveProperty("views");
    expect(mapJson).toHaveProperty("settings");
    expect((mapJson["settings"] as Record<string, unknown>)["initialViewId"]).toBe(
      def.settings.initialViewId,
    );
  });

  it("index.html embeds the renderer JS and map definition", () => {
    const { pkg } = makePackage();
    const files = unzipSync(pkg.zip);
    const html = strFromU8(files["index.html"]!);

    expect(html).toContain(STUB_JS);
    expect(html).toContain(STUB_CSS);
    expect(html).toContain("ClickMapRenderer.create");
  });

  it("embed.html contains the script and link tags", () => {
    const { pkg } = makePackage();
    const files = unzipSync(pkg.zip);
    const html = strFromU8(files["embed.html"]!);

    expect(html).toContain("clickmap-renderer.js");
    expect(html).toContain("clickmap-renderer.css");
    expect(html).toContain("ClickMapRenderer.create");
  });

  it("README.txt mentions the project name", () => {
    const { pkg } = makePackage();
    const files = unzipSync(pkg.zip);
    const readme = strFromU8(files["README.txt"]!);
    expect(readme).toContain("Test Map");
  });

  it("embedSnippet and mapJson are returned as strings", () => {
    const { pkg } = makePackage();
    expect(typeof pkg.embedSnippet).toBe("string");
    expect(pkg.embedSnippet).toContain("ClickMapRenderer.create");
    expect(typeof pkg.mapJson).toBe("string");
    const parsed = JSON.parse(pkg.mapJson) as Record<string, unknown>;
    expect(parsed).toHaveProperty("views");
  });

  it("non-inline mode rewrites asset paths to relative paths in map.json", () => {
    const project = createNewProject("Asset Map");
    project.assets.push({
      id: "asset_1",
      type: "image/png",
      name: "My Campus",
      src: "data:image/png;base64,abc=",
      width: 100,
      height: 100,
      inline: false,
    });
    const def = toDefinition(project);
    const pkg = generateExportPackage(def, STUB_JS, STUB_CSS, {
      inlineAssets: false,
      minifyRenderer: false,
    });
    const files = unzipSync(pkg.zip);
    const mapJson = JSON.parse(strFromU8(files["map.json"]!)) as {
      assets: Array<{ src: string; inline: boolean }>;
    };
    const asset = mapJson.assets[0]!;
    expect(asset.src).not.toContain("data:");
    expect(asset.src).toMatch(/^assets\//);
    expect(asset.inline).toBe(false);
    // Asset file should exist in ZIP.
    const assetKeys = Object.keys(files).filter((k) => k.startsWith("assets/"));
    expect(assetKeys.length).toBe(1);
  });
});
