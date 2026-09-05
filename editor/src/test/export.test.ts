import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { JSDOM } from "jsdom";
import { generateExportPackage } from "../lib/export-package";
import { createRectArea } from "../lib/area-utils";
import { createNewProject, toDefinition } from "../lib/project";

const STUB_JS = "/* renderer */";
const STUB_CSS = "/* styles */";

function makePackage(overrides?: { inlineAssets?: boolean }) {
  const project = createNewProject("Test Map");
  const def = toDefinition(project);
  return {
    pkg: generateExportPackage(def, STUB_JS, STUB_CSS, {
      inlineAssets: overrides?.inlineAssets ?? true,
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

  it("round-trips templates, metadata, rich tooltips, and popups in map.json", () => {
    const project = createNewProject("Content Map");
    project.settings.contentTemplate = "<h3>{{name}}</h3><p>{{metadata.price}}</p>";
    const richArea = createRectArea(0, 0, 10, 10);
    richArea.metadata = { price: "€12", available: true };
    richArea.tooltip = { enabled: true, body: "<b>Rich</b>", imageUrl: "thumb.png" };
    richArea.action = {
      type: "popup",
      content: { title: "Info", body: "<em>Details</em>", imageUrl: "hero.png", linkHref: "/more" },
      position: "left",
    };
    project.views[0].layers = [{ id: "layer_content", name: "Content", visible: true, locked: false, opacity: 1, areas: [richArea] }];

    const pkg = generateExportPackage(toDefinition(project), STUB_JS, STUB_CSS, {
      inlineAssets: true,
    });
    const parsed = JSON.parse(pkg.mapJson) as typeof project;
    const exported = parsed.views[0].layers[0].areas[0];
    expect(parsed.settings.contentTemplate).toBe(project.settings.contentTemplate);
    expect(exported.metadata).toEqual(richArea.metadata);
    expect(exported.tooltip).toEqual(richArea.tooltip);
    expect(exported.action).toEqual(richArea.action);
  });

  it("round-trips exact CSS color strings for every area state", () => {
    const project = createNewProject("Color Map");
    const area = createRectArea(0, 0, 10, 10);
    area.style = {
      default: { fill: "rebeccapurple", stroke: "#abcdef80", strokeWidth: 2 },
      hover: { fill: "rgba(1,2,3,0.25)", stroke: "transparent", strokeWidth: 3 },
      active: { fill: "hsl(120 100% 50% / 40%)", stroke: "rgb(10 20 30)", strokeWidth: 4 },
      disabled: { fill: "#0000", stroke: "rgba(5,6,7,0.8)", strokeWidth: 1 },
    };
    project.views[0].layers = [{ id: "layer_colors", name: "Colors", visible: true, locked: false, opacity: 1, areas: [area] }];

    const pkg = generateExportPackage(toDefinition(project), STUB_JS, STUB_CSS, { inlineAssets: true });
    const parsed = JSON.parse(pkg.mapJson) as typeof project;
    expect(parsed.views[0].layers[0].areas[0].style).toEqual(area.style);
  });

  it("preserves per-view CSS in the exported definition", () => {
    const project = createNewProject("Styled Map");
    project.views[0].customCss = ".clickmap-bg { filter: grayscale(1); }";
    const pkg = generateExportPackage(toDefinition(project), STUB_JS, STUB_CSS, { inlineAssets: true });
    const parsed = JSON.parse(pkg.mapJson) as typeof project;
    expect(parsed.views[0].customCss).toBe(project.views[0].customCss);
  });

  it("index.html embeds the renderer JS and map definition", () => {
    const { pkg } = makePackage();
    const files = unzipSync(pkg.zip);
    const html = strFromU8(files["index.html"]!);

    expect(html).toContain(STUB_JS);
    expect(html).toContain(STUB_CSS);
    expect(html).toContain("ClickMapRenderer.create");
  });

  it.each([true, false])(
    "keeps script end-tag variants inert in index.html (inlineAssets=%s)",
    (inlineAssets) => {
      const project = createNewProject('</ScRiPt ><script>window.__probe=1</script >');
      const area = createRectArea(0, 0, 10, 10);
      area.metadata = { hostile: "</SCRIPT\t><script>window.__probe=2</script >" };
      area.tooltip = { enabled: true, body: "<b>Normal rich content</b>" };
      project.views[0].layers = [{ id: "layer_hostile", name: "Hostile", visible: true, locked: false, opacity: 1, areas: [area] }];

      const pkg = generateExportPackage(toDefinition(project), STUB_JS, STUB_CSS, {
        inlineAssets,
      });
      const html = strFromU8(unzipSync(pkg.zip)["index.html"]!);

      expect(html).not.toContain("</ScRiPt >");
      expect(html).not.toContain("</SCRIPT\\t>");
      expect(html).not.toContain("<b>Normal rich content</b>");
      expect(html).toContain("\\u003c/ScRiPt >");
      expect(html).toContain("\\u003cb>Normal rich content\\u003c/b>");
      expect(JSON.parse(pkg.mapJson).project.name).toBe(project.project.name);
      expect(JSON.parse(pkg.mapJson).views[0].layers[0].areas[0].tooltip.body)
        .toBe("<b>Normal rich content</b>");
    },
  );

  it.each([true, false])(
    "browser parsing preserves hostile and rich text without executing it (inlineAssets=%s)",
    (inlineAssets) => {
      const project = createNewProject('</script ><script>window.__reviewProbe=1</script >');
      const area = createRectArea(0, 0, 10, 10);
      area.tooltip = { enabled: true, body: "<strong>Hours & details</strong>" };
      area.metadata = { variant: "</ScRiPt\n><script>window.__reviewProbe=2</script >" };
      project.views[0].layers = [{ id: "layer_browser", name: "Browser", visible: true, locked: false, opacity: 1, areas: [area] }];
      const renderer = `window.ClickMapRenderer={create:function(options){window.__definition=options.definition;}};`;
      const pkg = generateExportPackage(toDefinition(project), renderer, STUB_CSS, {
        inlineAssets,
      });
      const html = strFromU8(unzipSync(pkg.zip)["index.html"]!);
      const dom = new JSDOM(html, { runScripts: "dangerously" });
      const browserWindow = dom.window as unknown as {
        __reviewProbe?: number;
        __definition?: typeof project;
      };

      expect(browserWindow.__reviewProbe).toBeUndefined();
      expect(browserWindow.__definition?.project.name).toBe(project.project.name);
      expect(browserWindow.__definition?.views[0].layers[0].areas[0].tooltip?.body)
        .toBe("<strong>Hours & details</strong>");
      dom.window.close();
    },
  );

  it("embed.html contains the script and link tags", () => {
    const { pkg } = makePackage();
    const files = unzipSync(pkg.zip);
    const html = strFromU8(files["embed.html"]!);

    expect(html).toContain("clickmap-renderer.js");
    expect(html).toContain("clickmap-renderer.css");
    expect(html).toContain("ClickMapRenderer.create");
    expect(html).toContain("shadowDom: true");
    expect(html).toContain("css: \"");
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
    expect(pkg.embedSnippet).toContain("shadowDom: true");
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
