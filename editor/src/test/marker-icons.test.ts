// Waypoint icons, uploads and marker scaling (#219).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  MARKER_PIN,
  decodeDefinition,
  markerBox,
  markerIcon,
  markerTransform,
  parsePathData,
  pathSegmentsBounds,
  pruneUnusedIcons,
  shapeBounds,
  usedIconKeys,
  validateProject,
  type Area,
  type ClickMapDefinition,
  type MarkerGeometry,
  type MarkerIcon,
} from "@svg-mapper/shared";
import { create, __setInlinedCSS } from "../../../renderer/src/renderer";
import { createMarkerArea, resizeMarker } from "../lib/area-utils";
import { buildExportManifest, zipExportManifestSync } from "../lib/export-package";
import { GALLERY_ICONS, findGalleryIcon, galleryIconEntry, importIconFile, parseTransformList, searchGalleryIcons, svgToIconPath } from "../lib/marker-icons";
import { createNewProject, toDefinition } from "../lib/project";
import { useStore } from "../store";

const TOILET = galleryIconEntry(findGalleryIcon("maki-toilet")!);
const PNG_ICON: MarkerIcon = { name: "Logo", width: 40, height: 20, assetId: "logo_png" };
const PNG_ASSET = { id: "logo_png", type: "image/png" as const, name: "logo.png", src: "data:image/png;base64,iVBORw0KGgo=", width: 40, height: 20, inline: true };

function marker(id: string, geometry: Partial<MarkerGeometry> = {}): Area {
  const area = createMarkerArea(100, 200);
  area.id = id;
  area.name = id;
  area.geometry = { type: "marker", x: 100, y: 200, anchor: "bottom-center", ...geometry };
  return area;
}

function projectWith(areas: Area[], icons?: Record<string, MarkerIcon>) {
  const project = createNewProject("Icons");
  project.views[0]!.layers = [{ id: "layer", name: "Layer", visible: true, locked: false, opacity: 1, areas }];
  if (icons) project.icons = icons;
  return project;
}

/** Where the icon-space point (u, v) lands in canvas units under an SVG transform string. */
function apply(transform: string, u: number, v: number): [number, number] {
  const match = /^translate\(([^,]+),([^)]+)\) scale\(([^)]+)\)$/.exec(transform)!;
  const [tx, ty, k] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return [tx + u * k, ty + v * k];
}

describe("marker icon schema", () => {
  it("accepts icons, size and scale mode, and keeps files without them valid", () => {
    const definition = toDefinition(projectWith([marker("a", { icon: "maki-toilet", size: 48, scaleMode: "screen" }), marker("b")], { "maki-toilet": TOILET }));
    expect(decodeDefinition(definition).ok).toBe(true);
    expect(decodeDefinition(toDefinition(projectWith([marker("legacy")]))).ok).toBe(true);
  });

  it("rejects malformed icon and marker fields with their JSON path", () => {
    const bad = (mutate: (definition: ClickMapDefinition) => void) => {
      const definition = structuredClone(toDefinition(projectWith([marker("a", { icon: "i" })], { i: TOILET })));
      mutate(definition);
      const result = decodeDefinition(definition);
      return result.ok ? null : result.path;
    };
    expect(bad((d) => { (d.views[0]!.layers[0]!.areas[0]!.geometry as MarkerGeometry).size = 0; })).toBe("$.views[0].layers[0].areas[0].geometry.size");
    expect(bad((d) => { (d.views[0]!.layers[0]!.areas[0]!.geometry as unknown as { scaleMode: string }).scaleMode = "zoom"; })).toBe("$.views[0].layers[0].areas[0].geometry.scaleMode");
    expect(bad((d) => { d.icons!.i = { ...TOILET, assetId: "x" }; })).toBe("$.icons.i");
    expect(bad((d) => { d.icons!.i = { name: "none", width: 15, height: 15 }; })).toBe("$.icons.i");
    expect(bad((d) => { d.icons!.i = { ...TOILET, width: 0 }; })).toBe("$.icons.i.width");
  });
});

describe("marker geometry", () => {
  it("places the icon box by its anchor, at the default or authored size, keeping the aspect ratio", () => {
    expect(markerBox({ x: 100, y: 200, anchor: "bottom-center" }, MARKER_PIN)).toEqual({ x: 88, y: 168, width: 24, height: 32 });
    expect(markerBox({ x: 100, y: 200, anchor: "center", size: 30 }, TOILET)).toEqual({ x: 85, y: 185, width: 30, height: 30 });
    expect(markerBox({ x: 100, y: 200, anchor: "top-left", size: 40 }, PNG_ICON)).toEqual({ x: 100, y: 200, width: 40, height: 20 });
    expect(markerBox({ x: 100, y: 200, anchor: "middle-right", size: 48 }, MARKER_PIN)).toEqual({ x: 52, y: 168, width: 48, height: 64 });
  });

  it("falls back to the pin for an omitted or unknown icon, and bounds use the icon box", () => {
    expect(markerIcon({ icon: "missing" }, { other: TOILET })).toBe(MARKER_PIN);
    expect(markerIcon({ icon: "toString" }, {})).toBe(MARKER_PIN);
    expect(markerIcon({ icon: "t" }, { t: TOILET })).toBe(TOILET);
    const geometry = { type: "marker" as const, x: 10, y: 10, anchor: "bottom-center" as const, icon: "t", size: 30 };
    expect(shapeBounds(geometry, { t: TOILET })).toEqual({ x: -5, y: -20, width: 30, height: 30 });
    // Without the icon list the pin's aspect ratio is assumed.
    expect(shapeBounds(geometry)).toEqual({ x: -5, y: -30, width: 30, height: 40 });
  });

  it("maps the icon box onto the marker box at map scale", () => {
    const geometry: MarkerGeometry = { x: 100, y: 200, anchor: "bottom-center", size: 30 };
    const transform = markerTransform(geometry, TOILET);
    expect(apply(transform, 0, 0)).toEqual([85, 170]);
    expect(apply(transform, 15, 15)).toEqual([115, 200]);
    // A map-scaled marker ignores the camera.
    expect(markerTransform(geometry, TOILET, 0.25)).toBe(transform);
  });

  it("scales a screen marker by the camera about its anchor point, so its on-screen size is constant", () => {
    for (const anchor of ["bottom-center", "center", "top-left", "middle-right"] as const) {
      const geometry: MarkerGeometry = { x: 100, y: 200, anchor, size: 30, scaleMode: "screen" };
      const box = markerBox(geometry, TOILET);
      // The anchor point, in icon units.
      const u = ((geometry.x - box.x) / box.width) * 15;
      const v = ((geometry.y - box.y) / box.height) * 15;
      for (const zoom of [1, 2, 4, 0.5]) {
        const transform = markerTransform(geometry, TOILET, 1 / zoom);
        const [ax, ay] = apply(transform, u, v);
        expect(ax).toBeCloseTo(100, 9);
        expect(ay).toBeCloseTo(200, 9);
        const [x0] = apply(transform, 0, 0);
        const [x1] = apply(transform, 15, 0);
        // Canvas width shrinks with zoom: zoom × width in canvas units is the same on screen.
        expect((x1 - x0) * zoom).toBeCloseTo(30, 9);
      }
    }
  });

  it("resizes by a corner handle about the anchor, keeping the aspect ratio", () => {
    const geometry = { type: "marker" as const, x: 100, y: 200, anchor: "bottom-center" as const, icon: "t" };
    expect(resizeMarker(geometry, { t: TOILET }, "se", 12, 2).size).toBe(36);
    expect(resizeMarker(geometry, { t: TOILET }, "nw", -6, -30).size).toBe(54);
    expect(resizeMarker(geometry, { t: TOILET }, "se", -100, -100).size).toBe(4);
    expect(resizeMarker(geometry, { t: TOILET }, "se", 0, 0)).toMatchObject({ x: 100, y: 200, anchor: "bottom-center" });
  });
});

describe("icon gallery", () => {
  it("has unique ids and well-formed single-colour path data inside the 15 × 15 box (Maki's own overshoot aside)", () => {
    expect(new Set(GALLERY_ICONS.map((icon) => icon.id)).size).toBe(GALLERY_ICONS.length);
    expect(GALLERY_ICONS.length).toBeGreaterThan(100);
    for (const icon of GALLERY_ICONS) {
      const bounds = pathSegmentsBounds(parsePathData(icon.d))!;
      expect(bounds.x, icon.id).toBeGreaterThanOrEqual(-0.1);
      expect(bounds.y, icon.id).toBeGreaterThanOrEqual(-0.1);
      expect(bounds.x + bounds.width, icon.id).toBeLessThanOrEqual(15.1);
      expect(bounds.y + bounds.height, icon.id).toBeLessThanOrEqual(15.1);
    }
  });

  it("covers the common wayfinding needs and searches by name, keyword and category", () => {
    for (const id of ["maki-marker", "maki-circle", "badge-1", "badge-a", "maki-information", "maki-entrance-alt1", "exit", "maki-toilet", "maki-wheelchair", "maki-elevator", "stairs", "maki-parking", "maki-cafe", "maki-restaurant", "maki-hospital"]) {
      expect(findGalleryIcon(id), id).toBeDefined();
    }
    expect(searchGalleryIcons("wc").map((icon) => icon.id)).toContain("maki-toilet");
    expect(searchGalleryIcons("lift").map((icon) => icon.id)).toContain("maki-elevator");
    expect(searchGalleryIcons("", "Badges")).toHaveLength(36);
    expect(searchGalleryIcons("coffee", "Wayfinding")).toHaveLength(0);
  });
});

describe("icon uploads", () => {
  it("reduces a single-colour SVG of basic shapes to path data in a box at the origin", () => {
    const icon = svgToIconPath(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 10 20 20"><g fill="#123" transform="translate(2 0)">' +
      '<rect x="10" y="10" width="4" height="4"/><circle cx="20" cy="20" r="2"/><polygon points="20,10 24,10 24,14"/></g></svg>',
    )!;
    expect(icon).toMatchObject({ width: 20, height: 20 });
    const bounds = pathSegmentsBounds(parsePathData(icon.d))!;
    expect(bounds.x).toBeCloseTo(2, 6);
    expect(bounds.y).toBeCloseTo(0, 6);
    expect(bounds.x + bounds.width).toBeCloseTo(16, 6);
    expect(bounds.y + bounds.height).toBeCloseTo(12, 6);
  });

  it("keeps multi-colour, stroked, styled or gradient SVGs as images", () => {
    const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`;
    expect(svgToIconPath(svg('<rect width="5" height="5" fill="red"/><rect x="5" width="5" height="5" fill="blue"/>'))).toBeNull();
    expect(svgToIconPath(svg('<path d="M0 0L10 10" fill="none" stroke="black"/>'))).toBeNull();
    expect(svgToIconPath(svg('<rect width="5" height="5" style="fill:red"/>'))).toBeNull();
    expect(svgToIconPath(svg('<rect width="5" height="5" fill="url(#g)"/>'))).toBeNull();
    expect(svgToIconPath(svg('<text>A</text>'))).toBeNull();
    expect(svgToIconPath(svg('<path d="M0 0H10V10Z" fill-rule="evenodd"/>'))).toBeNull();
  });

  it("parses SVG transform lists and refuses ones it cannot read", () => {
    expect(parseTransformList("translate(5) scale(2)")).toEqual([2, 0, 0, 2, 5, 0]);
    expect(parseTransformList("rotate(90, 5, 5)")!.map((n) => Math.round(n * 1e9) / 1e9)).toEqual([0, 1, -1, 0, 10, 0]);
    expect(parseTransformList("matrix(1 0 0 1 3 4)")).toEqual([1, 0, 0, 1, 3, 4]);
    expect(parseTransformList("translate(1) bogus")).toBeNull();
  });

  it("sanitises an uploaded SVG with the artwork profile before reducing it", async () => {
    const file = new File([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><path d="M0 0H10V10Z" onclick="x()"/></svg>',
    ], "evil-pin.svg", { type: "image/svg+xml" });
    const { icon, asset } = await importIconFile(file);
    expect(asset).toBeUndefined();
    expect(icon).toEqual({ name: "evil-pin", width: 10, height: 10, d: "M0 0 L10 0 L10 10 Z" });
  });

  it("stores an SVG it cannot reduce as a sanitised asset the icon references", async () => {
    const file = new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><script>alert(1)</script><rect width="5" height="5" fill="red"/><rect x="5" width="5" height="5" fill="blue" onclick="x()"/></svg>',
    ], "flag.svg", { type: "image/svg+xml" });
    const { icon, asset } = await importIconFile(file);
    expect(asset).toBeDefined();
    expect(icon).toEqual({ name: "flag", width: 20, height: 10, assetId: asset!.id });
    const markup = decodeURIComponent(asset!.src.split(",")[1]!);
    expect(markup).not.toMatch(/script|onclick/i);
    expect(markup).toContain('fill="blue"');
  });

  it("refuses other file types", async () => {
    await expect(importIconFile(new File(["x"], "icon.gif", { type: "image/gif" }))).rejects.toThrow(/SVG, PNG or WebP/);
  });
});

describe("validation and export", () => {
  it("reports missing icons, missing icon assets and malformed icon path data", () => {
    const definition = toDefinition(projectWith(
      [marker("a", { icon: "nope" }), marker("b", { icon: "png" }), marker("c", { icon: "bad" })],
      { png: PNG_ICON, bad: { name: "Bad", width: 10, height: 10, d: "M0 0 L" } },
    ));
    const codes = validateProject(definition).filter((result) => result.severity === "error").map((result) => result.code);
    expect(codes).toEqual(expect.arrayContaining(["MISSING_ICON", "MISSING_ICON_ASSET", "INVALID_ICON"]));
  });

  it("publishes only used icons, and drops assets only unused icons referenced", () => {
    const project = projectWith([marker("a", { icon: "maki-toilet" }), marker("b", { icon: "maki-toilet" })], {
      "maki-toilet": TOILET,
      "maki-cafe": galleryIconEntry(findGalleryIcon("maki-cafe")!),
      png: PNG_ICON,
    });
    project.assets.push(PNG_ASSET);
    const definition = toDefinition(project);
    expect(usedIconKeys(definition)).toEqual(new Set(["maki-toilet"]));
    expect(Object.keys(definition.icons!)).toEqual(["maki-toilet"]);
    expect(definition.assets).toEqual([]);

    // An image icon in use keeps its asset; an asset used elsewhere is never dropped.
    const used = projectWith([marker("a", { icon: "png" })], { png: PNG_ICON, spare: { ...PNG_ICON, name: "Spare" } });
    used.assets.push(PNG_ASSET);
    expect(toDefinition(used).assets.map((asset) => asset.id)).toEqual(["logo_png"]);
    expect(Object.keys(toDefinition(used).icons!)).toEqual(["png"]);
    const background = projectWith([], { png: PNG_ICON });
    background.assets.push(PNG_ASSET);
    background.views[0]!.background = { assetId: "logo_png", fit: "contain" };
    const published = toDefinition(background);
    expect(published.icons).toBeUndefined();
    expect(published.assets).toHaveLength(1);
  });

  it("returns the same definition when nothing is unused", () => {
    const definition = toDefinition(projectWith([marker("a", { icon: "t" })], { t: TOILET }));
    expect(pruneUnusedIcons(definition)).toBe(definition);
  });

  it("writes used icons into map.json and their image assets under assets/, and nothing unused", () => {
    const project = projectWith([marker("a", { icon: "maki-toilet" }), marker("b", { icon: "png" })], {
      "maki-toilet": TOILET,
      "maki-cafe": galleryIconEntry(findGalleryIcon("maki-cafe")!),
      png: PNG_ICON,
      spare: { name: "Spare", width: 10, height: 10, assetId: "spare_png" },
    });
    project.assets.push(PNG_ASSET, { ...PNG_ASSET, id: "spare_png", name: "spare.png" });
    const manifest = buildExportManifest(toDefinition(project), "/* js */", "/* css */", { inlineAssets: false });
    const map = JSON.parse(manifest.mapJson) as ClickMapDefinition;
    expect(Object.keys(map.icons!).sort()).toEqual(["maki-toilet", "png"]);
    expect(map.icons!["maki-toilet"]!.d).toBe(TOILET.d);
    const files = Object.keys(unzipSync(zipExportManifestSync(manifest)));
    expect(files).toContain("assets/logo.png");
    expect(files).not.toContain("assets/spare.png");
    expect(strFromU8(unzipSync(zipExportManifestSync(manifest))["map.json"]!)).not.toContain("maki-cafe");
  });
});

describe("store", () => {
  beforeEach(() => {
    useStore.getState().newProject();
  });

  it("adds a gallery icon on first use, applies it to selected markers in one undo step, and undo restores icons", () => {
    useStore.setState((s) => {
      s.project.views[0]!.layers = [{ id: "layer", name: "Layer", visible: true, locked: false, opacity: 1, areas: [marker("m1"), marker("m2")] }];
    });
    useStore.getState().setMarkerIcon(["m1", "m2"], { key: "maki-toilet", entry: TOILET });
    const state = useStore.getState();
    expect(state.project.icons).toEqual({ "maki-toilet": TOILET });
    const areas = state.project.views[0]!.layers[0]!.areas;
    expect(areas.map((area) => (area.geometry as MarkerGeometry).icon)).toEqual(["maki-toilet", "maki-toilet"]);
    useStore.getState().undo();
    expect(useStore.getState().project.icons).toBeUndefined();
    expect((useStore.getState().project.views[0]!.layers[0]!.areas[0]!.geometry as MarkerGeometry).icon).toBeUndefined();
  });

  it("sets size and scale mode, clears them back to defaults, and skips markers in locked layers", () => {
    useStore.setState((s) => {
      s.project.views[0]!.layers = [{ id: "layer", name: "Layer", visible: true, locked: false, opacity: 1, areas: [marker("m1")] }];
      s.project.views[0]!.layers.push({ id: "locked", name: "Locked", visible: true, locked: true, opacity: 1, areas: [marker("m2")] });
    });
    useStore.getState().updateMarkers(["m1", "m2"], { size: 40, scaleMode: "screen" });
    const geometry = (id: string) => useStore.getState().project.views[0]!.layers.flatMap((layer) => layer.areas).find((area) => area.id === id)!.geometry as MarkerGeometry;
    expect(geometry("m1")).toMatchObject({ size: 40, scaleMode: "screen" });
    expect(geometry("m2").size).toBeUndefined();
    expect(useStore.getState().lockNotice).toMatch(/locked/i);
    useStore.getState().updateMarkers(["m1"], { size: undefined, scaleMode: undefined });
    expect(geometry("m1")).not.toHaveProperty("size");
    expect(geometry("m1")).not.toHaveProperty("scaleMode");
  });

  it("keeps uploaded icons in the project library so other markers can reuse them", () => {
    useStore.getState().addIcon("icon_up", PNG_ICON, PNG_ASSET);
    expect(useStore.getState().project.icons).toEqual({ icon_up: PNG_ICON });
    expect(useStore.getState().project.assets.map((asset) => asset.id)).toEqual(["logo_png"]);
  });
});

describe("renderer", () => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }
  beforeEach(() => {
    __setInlinedCSS(".clickmap-root { position: relative; }");
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    document.body.innerHTML = '<div id="map"></div>';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  const el = (id: string) => document.querySelector<SVGGElement>(`[data-area-id="${id}"]`)!;
  /** The inner group in icon units, which carries the transform. */
  const art = (id: string) => el(id).firstElementChild as SVGGElement;

  it("draws a path icon in its box with the style's fill, strokes kept in canvas units, and a box hit area", () => {
    const area = marker("wc", { icon: "t", size: 30 });
    area.style = { ...area.style, default: { fill: "#ff0000", stroke: "#00ff00", strokeWidth: 2 } };
    create({ container: "#map", definition: toDefinition(projectWith([area], { t: TOILET })) });
    const group = el("wc");
    expect(group.tagName).toBe("g");
    expect(group.getAttribute("fill")).toBe("#ff0000");
    expect(Number(group.getAttribute("stroke-width"))).toBeCloseTo(1, 9);
    expect(art("wc").getAttribute("transform")).toBe(markerTransform(area.geometry as MarkerGeometry, TOILET));
    expect(group.querySelector("path")!.getAttribute("d")).toBe(TOILET.d);
    const box = group.querySelector("rect")!;
    expect([box.getAttribute("width"), box.getAttribute("height"), box.getAttribute("fill"), box.getAttribute("stroke")]).toEqual(["15", "15", "transparent", "none"]);
    expect(group).toHaveAttribute("role", "button");
    expect(group).toHaveAttribute("tabindex", "0");
  });

  it("draws an image icon with its asset and outlines it with the style's stroke", () => {
    const project = projectWith([marker("logo", { icon: "png", size: 40 })], { png: PNG_ICON });
    project.assets.push(PNG_ASSET);
    create({ container: "#map", definition: toDefinition(project) });
    const group = el("logo");
    expect(group.querySelector("image")!.getAttribute("href")).toBe(PNG_ASSET.src);
    expect(group.querySelector("path")).toBeNull();
    expect(group.querySelector("rect")!.hasAttribute("stroke")).toBe(false);
  });

  it("honours the active and disabled states on icons", () => {
    const area = marker("wc", { icon: "t" });
    const disabled = marker("off", { icon: "t" });
    disabled.disabled = true;
    disabled.style = { ...disabled.style, disabled: { fill: "#999999", stroke: "#666666", strokeWidth: 1 } };
    const map = create({ container: "#map", definition: toDefinition(projectWith([area, disabled], { t: TOILET })) });
    map.select("wc");
    expect(el("wc").getAttribute("fill")).toBe(area.style.active.fill);
    expect(el("off").getAttribute("fill")).toBe("#999999");
    expect(el("off")).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps screen markers anchored and their on-screen size constant through zoom, and map markers scaling", () => {
    const project = projectWith([marker("screen", { icon: "t", size: 30, scaleMode: "screen" }), marker("map", { icon: "t", size: 30 })], { t: TOILET });
    project.views[0]!.viewport = { ...project.views[0]!.viewport, minZoom: 1, maxZoom: 4, zoomEnabled: true, panEnabled: true };
    project.settings.zoomControls = { enabled: true };
    create({ container: "#map", definition: toDefinition(project) });
    const svg = document.querySelector<SVGSVGElement>(".clickmap-areas")!;
    const mapTransform = art("map").getAttribute("transform");
    expect(art("screen").getAttribute("transform")).toBe(mapTransform);
    document.querySelector<HTMLButtonElement>(".clickmap-zoom-in")!.click();
    document.querySelector<HTMLButtonElement>(".clickmap-zoom-in")!.click();
    const width = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
    expect(width).toBeLessThan(1600);
    const scale = width / 1600;
    expect(art("screen").getAttribute("transform")).toBe(markerTransform({ x: 100, y: 200, anchor: "bottom-center", size: 30, scaleMode: "screen" }, TOILET, scale));
    expect(art("map").getAttribute("transform")).toBe(mapTransform);
    document.querySelector<HTMLButtonElement>(".clickmap-zoom-reset")!.click();
    expect(art("screen").getAttribute("transform")).toBe(mapTransform);
  });
});
