import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeDefinition, decodeProjectFile, type ClickMapDefinition } from "@svg-mapper/shared";
import { create, __setInlinedCSS } from "../../../renderer/src/renderer";
import { alphaBytesToHitMask } from "../lib/alpha-mask";
import { createRectArea } from "../lib/area-utils";
import { createNewProject, toDefinition } from "../lib/project";

// One shared structural decoder; invalid input never mounts a partial map,
// and every load failure is visible and observable (#169).

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
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function definition(mutate?: (def: ClickMapDefinition) => void): ClickMapDefinition {
  const project = createNewProject();
  const area = { ...createRectArea(0, 0, 16, 8), id: "area_a", name: "A" };
  project.views[0]!.layers = [{ id: "layer_a", name: "L", visible: true, locked: false, opacity: 1, areas: [area] }];
  const def = toDefinition(project);
  mutate?.(def);
  return def;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const host = () => document.querySelector("#map")!;

describe("shared structural decoder", () => {
  it("reports the exact path of a structural error", () => {
    const result = decodeDefinition(definition((def) => { (def.views[0]!.canvas as { width: unknown }).width = "wide"; }));
    expect(result).toMatchObject({ ok: false, path: "$.views[0].canvas.width" });
    expect(!result.ok && result.message).toMatch(/^Invalid map\.json at \$\.views\[0\]\.canvas\.width: expected/);
  });

  it("rejects non-finite geometry", () => {
    const result = decodeDefinition(definition((def) => { def.views[0]!.layers[0]!.areas[0]!.geometry = { type: "rect", x: Infinity, y: 0, width: 1, height: 1 }; }));
    expect(result).toMatchObject({ ok: false, path: "$.views[0].layers[0].areas[0].geometry.x" });
  });

  it("accepts a generated mask and rejects fractional, oversized and truncated ones", () => {
    const valid = alphaBytesToHitMask("asset", new Uint8ClampedArray(16 * 8 * 4).fill(255), 16, 8, 0.5);
    const withMask = (mask: object) => definition((def) => {
      def.assets.push({ id: "asset", type: "image/png", name: "a.png", src: "data:image/png;base64,AAAA", width: 16, height: 8, inline: true });
      def.views[0]!.layers[0]!.areas[0]!.image = { assetId: "asset", hitMask: { ...valid, ...mask } as never };
    });
    expect(decodeDefinition(withMask({})).ok).toBe(true);
    const maskPath = "$.views[0].layers[0].areas[0].image.hitMask";
    expect(decodeDefinition(withMask({ width: 2.5 }))).toMatchObject({ ok: false, path: `${maskPath}.width` });
    expect(decodeDefinition(withMask({ width: 129 }))).toMatchObject({ ok: false, path: `${maskPath}.width` });
    expect(decodeDefinition(withMask({ data: valid.data.slice(0, -4) }))).toMatchObject({ ok: false, path: `${maskPath}.data` });
  });

  it("keeps metadata, payloads and editor state untouched and leaves broken references to semantic validation", () => {
    const def = definition((d) => {
      d.views[0]!.layers[0]!.areas[0]!.metadata = { nested: { anything: [1, "two"] } };
      d.views[0]!.layers[0]!.areas[0]!.action = { type: "goToView", targetViewId: "missing-view" };
    });
    const result = decodeDefinition(def);
    expect(result.ok && result.value).toBe(def);
    expect(decodeProjectFile({ ...def, editor: { zoom: 1, pan: { x: 0, y: 0 }, grid: { enabled: false, size: 10 }, guides: [], history: [] } }).ok).toBe(true);
  });
});

describe("renderer initialization failures", () => {
  it("shows and reports an invalid inline definition without mounting a map", async () => {
    const added = vi.spyOn(window, "addEventListener");
    const instance = create({ container: "#map", definition: definition((def) => { (def.views[0] as { layers: unknown }).layers = "none"; }) });
    const errors: unknown[] = [];
    instance.on("error", (event) => errors.push(event));
    await flush();

    expect(errors).toEqual([{ type: "error", code: "INVALID_DEFINITION", message: expect.stringContaining("$.views[0].layers") }]);
    const status = host().querySelector(".clickmap-root--error[role='alert']");
    expect(status?.textContent).toContain("$.views[0].layers");
    expect(host().querySelector("svg")).toBeNull();
    expect(added).not.toHaveBeenCalled();
    instance.destroy();
    expect(host().children).toHaveLength(0);
  });

  it("unwinds partial DOM and listeners when construction fails", async () => {
    vi.stubGlobal("ResizeObserver", class { constructor() { throw new Error("observer unavailable"); } });
    const added: string[] = [];
    const removed: string[] = [];
    vi.spyOn(window, "addEventListener").mockImplementation(function (this: Window, type: string) { added.push(type); });
    vi.spyOn(window, "removeEventListener").mockImplementation(function (this: Window, type: string) { removed.push(type); });

    const instance = create({ container: "#map", definition: definition((def) => { def.settings.enableHistory = true; }) });
    const errors: Array<{ code: string }> = [];
    instance.on("error", (event) => errors.push(event));
    await flush();

    expect(errors.map((event) => event.code)).toEqual(["LOAD_FAILED"]);
    expect(host().querySelectorAll(".clickmap-root")).toHaveLength(1);
    expect(host().querySelector(".clickmap-root--error")).not.toBeNull();
    for (const type of added) expect(removed).toContain(type);
  });

  it("delivers construction-time errors to an immediate subscriber, then ready exactly once", async () => {
    const instance = create({ container: "#map", definition: definition((def) => { def.views[0]!.customCss = ".a { background: url(x.png) }"; }) });
    const events: string[] = [];
    instance.on("error", (event) => events.push(event.code));
    instance.on("ready", () => events.push("ready"));
    await flush();
    await flush();
    expect(events).toEqual(["INVALID_VIEW_CSS", "ready"]);
  });

  it("reports images that fail to load", async () => {
    const instance = create({ container: "#map", definition: definition((def) => {
      def.assets.push({ id: "bg", type: "image/png", name: "plan.png", src: "missing/plan.png", width: 10, height: 10, inline: false });
      def.views[0]!.background = { assetId: "bg", fit: "contain" };
    }) });
    const errors: Array<{ code: string; message: string }> = [];
    instance.on("error", (event) => errors.push(event));
    await flush();
    host().querySelector(".clickmap-bg-img")!.dispatchEvent(new Event("error"));
    expect(errors).toEqual([{ type: "error", code: "ASSET_LOAD_FAILED", message: 'Image "plan.png" could not be loaded.' }]);
  });
});

describe("fetched definitions", () => {
  function respond(body: unknown, status = 200) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      await gate;
      return { ok: status < 400, status, url: "https://maps.test/map.json", json: async () => body } as Response;
    }));
    return release;
  }

  it("shows loading, then a path-specific error for an invalid file", async () => {
    const release = respond(definition((def) => { def.views[0]!.layers[0]!.areas[0]!.geometry = { type: "circle", cx: 0, cy: 0, r: -1 }; }));
    const instance = create({ container: "#map", definitionUrl: "map.json" });
    const errors: Array<{ code: string; message: string }> = [];
    instance.on("error", (event) => errors.push(event));
    expect(host().querySelector(".clickmap-root--loading[role='status'][aria-busy='true']")).not.toBeNull();

    release();
    await flush();
    expect(errors).toEqual([{ type: "error", code: "INVALID_DEFINITION", message: expect.stringContaining("$.views[0].layers[0].areas[0].geometry.r") }]);
    expect(host().querySelector(".clickmap-root--loading")).toBeNull();
    expect(host().querySelector(".clickmap-root--error[role='alert']")).not.toBeNull();
    expect(host().querySelector("svg")).toBeNull();
  });

  it("shows HTTP failures and mounts valid files after loading", async () => {
    respond({}, 404)();
    const failed = create({ container: "#map", definitionUrl: "missing.json" });
    const codes: string[] = [];
    failed.on("error", (event) => codes.push(event.code));
    await flush();
    expect(codes).toEqual(["LOAD_FAILED"]);
    expect(host().querySelector(".clickmap-root--error")?.textContent).toContain("HTTP 404");
    failed.destroy();
    expect(host().children).toHaveLength(0);

    respond(definition())();
    const loaded = create({ container: "#map", definitionUrl: "map.json" });
    let ready = 0;
    loaded.on("ready", () => { ready += 1; });
    await flush();
    await flush();
    expect(ready).toBe(1);
    expect(host().querySelector(".clickmap-root--loading, .clickmap-root--error")).toBeNull();
    expect(host().querySelector("svg")).not.toBeNull();
  });
});
