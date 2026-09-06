import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { JSDOM } from "jsdom";
import { generateExportPackage, generateExportPreview } from "../lib/export-package";
import { createRectArea } from "../lib/area-utils";
import { createNewProject, toDefinition } from "../lib/project";
import type { Asset } from "@svg-mapper/shared";

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

  it("generates matching nested paths, unique containers, sizing, and README guidance", () => {
    const project = createNewProject("Directory A");
    const options = {
      inlineAssets: true,
      basePath: "/sites/campus/maps/directory-a/",
      containerId: "campus-map-a",
      containerWidth: "800px",
      containerHeight: "600px",
    };
    const pkg = generateExportPackage(toDefinition(project), STUB_JS, STUB_CSS, options);
    const files = unzipSync(pkg.zip);
    const embed = strFromU8(files["embed.html"]!);
    const readme = strFromU8(files["README.txt"]!);

    expect(pkg.embedSnippet).toContain('id="campus-map-a"');
    expect(pkg.embedSnippet).toContain('container: "#campus-map-a"');
    expect(pkg.embedSnippet).toContain("/sites/campus/maps/directory-a/map.json");
    expect(pkg.embedSnippet).toContain("width: 800px; height: 600px");
    expect(embed).toContain("/sites/campus/maps/directory-a/clickmap-renderer.js");
    expect(readme).toContain("/sites/campus/maps/directory-a");
    expect(readme).toContain('id="campus-map-a"');

    const second = generateExportPackage(toDefinition(createNewProject("Directory B")), STUB_JS, STUB_CSS, {
      ...options,
      basePath: "/sites/campus/maps/directory-b",
      containerId: "campus-map-b",
    });
    expect(second.embedSnippet).toContain('container: "#campus-map-b"');
    expect(second.embedSnippet).not.toContain("campus-map-a");
  });

  it("keeps configured paths inert in embed script and HTML contexts", () => {
    const project = createNewProject("Safe Embed");
    const pkg = generateExportPackage(toDefinition(project), STUB_JS, STUB_CSS, {
      inlineAssets: true,
      basePath: '/maps/"><script>window.__embedProbe=1</script>',
      containerId: "safe-map",
    });
    const embed = strFromU8(unzipSync(pkg.zip)["embed.html"]!);
    expect(embed).not.toContain('<script>window.__embedProbe=1</script>');
    expect(embed).toContain("&quot;&gt;&lt;script&gt;");
    expect(embed).toContain("\\u003cscript>window.__embedProbe=1\\u003c/script>");
  });

  it("previews a large image-heavy package without creating a ZIP", () => {
    const project = createNewProject("Large Map");
    const payload = "A".repeat(512 * 1024);
    project.assets = Array.from({ length: 4 }, (_, index) => ({
      id: `asset_${index}`,
      type: "image/png",
      name: `image-${index}`,
      src: `data:image/png;base64,${payload}`,
      width: 1000,
      height: 1000,
      inline: false,
    }));
    const preview = generateExportPreview(toDefinition(project), STUB_JS, STUB_CSS, {
      inlineAssets: false,
      basePath: "/nested/maps/large",
      containerId: "large-map",
    });

    expect(preview).not.toHaveProperty("zip");
    expect(preview.assetFileCount).toBe(4);
    expect(preview.assetBytes).toBeGreaterThan(1_000_000);
    expect(preview.mapJson).toContain("assets/image-0.png");
    expect(preview.estimatedUncompressedBytes).toBeGreaterThan(preview.assetBytes);
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

  it("writes comma-containing raw SVG as UTF-8 with the canonical extension", () => {
    const project = createNewProject("Raw SVG");
    const rawSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0,0 L10,10"/></svg>';
    project.assets = [{ id: "raw", type: "image/svg+xml", name: "floor.plan.svg", src: rawSvg, width: 10, height: 10, inline: true }];

    const pkg = generateExportPackage(toDefinition(project), STUB_JS, STUB_CSS, { inlineAssets: false });
    const files = unzipSync(pkg.zip);
    const parsed = JSON.parse(pkg.mapJson) as { assets: Asset[] };

    expect(parsed.assets[0]?.src).toBe("assets/floor.plan.svg");
    expect(strFromU8(files["assets/floor.plan.svg"]!)).toBe(rawSvg);
  });

  it("decodes percent and base64 data URIs and assigns MIME-based extensions", () => {
    const project = createNewProject("Encoded assets");
    project.assets = [
      { id: "svg", type: "image/svg+xml", name: "marker", src: "data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E", width: 1, height: 1, inline: true },
      { id: "jpg", type: "image/jpeg", name: "photo.jpeg", src: "data:image/jpeg;base64,SGk=", width: 1, height: 1, inline: true },
      { id: "webp", type: "image/webp", name: "photo", src: "data:image/webp;base64,V2VicA==", width: 1, height: 1, inline: true },
    ];

    const files = unzipSync(generateExportPackage(toDefinition(project), STUB_JS, STUB_CSS, { inlineAssets: false }).zip);
    expect(strFromU8(files["assets/marker.svg"]!)).toBe("<svg></svg>");
    expect(strFromU8(files["assets/photo.jpg"]!)).toBe("Hi");
    expect(strFromU8(files["assets/photo.webp"]!)).toBe("Webp");
  });

  it("deduplicates packaged filenames without rewriting external references", () => {
    const project = createNewProject("Mixed assets");
    project.assets = [
      { id: "one", type: "image/png", name: "plan.png", src: "data:image/png;base64,QQ==", width: 1, height: 1, inline: true },
      { id: "two", type: "image/png", name: "plan.png", src: "data:image/png;base64,Qg==", width: 1, height: 1, inline: true },
      { id: "remote", type: "image/png", name: "remote.png", src: "https://cdn.example.test/map.png", width: 1, height: 1, inline: false },
      { id: "relative", type: "image/png", name: "relative.png", src: "../shared/map.png", width: 1, height: 1, inline: false },
    ];

    const pkg = generateExportPackage(toDefinition(project), STUB_JS, STUB_CSS, { inlineAssets: false });
    const files = unzipSync(pkg.zip);
    const parsed = JSON.parse(pkg.mapJson) as { assets: Asset[] };
    expect(parsed.assets.map((asset) => asset.src)).toEqual([
      "assets/plan.png",
      "assets/plan-1.png",
      "https://cdn.example.test/map.png",
      "../shared/map.png",
    ]);
    expect(Object.keys(files).filter((path) => path.startsWith("assets/"))).toEqual(["assets/plan.png", "assets/plan-1.png"]);
    expect(strFromU8(files["README.txt"]!)).toContain("https://cdn.example.test/map.png");
    expect(strFromU8(files["README.txt"]!)).toContain("../shared/map.png");
  });

  it("reports preserved dependencies and rejects malformed embedded data", () => {
    const project = createNewProject("Dependencies");
    project.assets = [{ id: "remote", type: "image/png", name: "remote", src: "https://cdn.example.test/map.png", width: 1, height: 1, inline: false }];
    const preview = generateExportPreview(toDefinition(project), STUB_JS, STUB_CSS, { inlineAssets: false });
    expect(preview.assetFileCount).toBe(0);
    expect(preview.assetBytes).toBe(0);
    expect(preview.externalDependencies).toEqual(["https://cdn.example.test/map.png"]);

    project.assets[0] = { ...project.assets[0]!, src: "data:image/png;base64,%%%" };
    expect(() => generateExportPackage(toDefinition(project), STUB_JS, STUB_CSS, { inlineAssets: false }))
      .toThrow("Malformed base64 asset data URI");
  });
});
